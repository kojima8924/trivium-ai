# -*- coding: utf-8 -*-
"""Dify DSL（Workflow 3 本 + Chatflow 1 本）と src/lib/ai/dify.ts の契約が一致しているか検査する。

  python dify/validate.py

Workflow 3 本（trivium-domain / trivium-leader / trivium-generate）の検査項目:
  1. YAML としてパースできる
  2. Start ノードの変数名が dify.ts の run() に渡す inputs のキーと完全一致（不足・余剰を検出）
  3. End ノードの出力変数名が result で、value_selector が実在する LLM ノードの text を指す
  4. edges の source / target が実在ノード、IF/ELSE の sourceHandle が cases の id か false、全ノードに入るエッジがある
  5. プロンプト内の {{#node.var#}} 参照が Start の変数（または実在ノードの出力）に存在する
  6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて含まれる
  7. LLM ノードのプロバイダが OpenAI（langgenius/openai/openai）で統一されている
  8. http-request が {{#env.XXX#}} を参照するなら、その環境変数が environment_variables に宣言されている
  9. code ノードの variables が実在ノードの出力を指し、outputs が下流の参照名と一致する

Chatflow（trivium-chat）の検査項目:
  A. app.mode が advanced-chat で、End ノードが無い
  B. Answer ノードがあり、参照先の LLM ノードが実在する
  C. question-classifier の class id と、そこから出る edge の sourceHandle が 1 対 1 で対応する
  D. すべての {{#env.XXX#}} が environment_variables に、{{#conversation.x#}} が conversation_variables に宣言済み
  E. code ノードの main 引数が variables と一致し、下流が参照する出力がすべて outputs にある
  F. http-request の URL が {{#env.XXX#}} か許可した外部 API（OpenAI Responses）で、Bearer トークンが env 参照である
  G. プロンプト・条件の {{#node.var#}} 参照がすべて実在（{{#sys.x#}} は許可リストで検査）
  H. Answer は LLM の text か code ノードの出力を参照する（後処理を挟む分岐があるため）
  I. NEED_SEARCH の印で分岐する if-else は、その印を出力するよう指示された LLM を参照している
  J. 外部 API を叩く http-request は、body を code ノードが組み立てている（プロンプト直書きを防ぐ）
"""
from __future__ import annotations

import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIFY_TS = os.path.join(ROOT, "src", "lib", "ai", "dify.ts")

# dify.ts の呼び出しごとの inputs キーを正規表現で抽出する。
#   this.run(env.ai.<key>, { ...inputs... }, input.learnerRef)   → key
#   this.run(apiKey, { ...inputs... }, input.learnerRef)          → difyGenerateApiKey（generateTask）
RUN_RE = re.compile(r"this\.run\(\s*(env\.ai\.(\w+)|apiKey),\s*\{(.*?)\},\s*input\.learnerRef", re.S)
KEY_RE = re.compile(r"^\s*([a-z_]+):", re.M)
SCHEMA_RE = re.compile(r"const (\w+Schema) = z\.object\(\{(.*?)\n\}\);", re.S)
REF_RE = re.compile(r"\{\{#([\w-]+)\.([\w-]+)#\}\}")
ENV_REF_RE = re.compile(r"\{\{#env\.([\w-]+)#\}\}")

OPENAI_PROVIDER = "langgenius/openai/openai"

# http-request が env 参照なしで叩いてよい外部 API（Web 検索に使う）
EXTERNAL_APIS = {"https://api.openai.com/v1/responses"}


def inputs_from_ts() -> dict[str, set[str]]:
    src = open(DIFY_TS, encoding="utf-8").read()
    out: dict[str, set[str]] = {}
    for _whole, env_key, body in RUN_RE.findall(src):
        key = env_key or "difyGenerateApiKey"
        out.setdefault(key, set()).update(KEY_RE.findall(body))
    return out


def schema_keys_from_ts() -> dict[str, set[str]]:
    src = open(DIFY_TS, encoding="utf-8").read()
    out: dict[str, set[str]] = {}
    for name, body in SCHEMA_RE.findall(src):
        out[name] = set(KEY_RE.findall(body))
    return out


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ノード種別ごとの「参照できる出力名」
def node_outputs(n: dict) -> set[str]:
    t = n["data"]["type"]
    if t == "llm":
        return {"text"}
    if t == "tool":
        return {"text", "files", "json"}
    if t == "code":
        return set(n["data"].get("outputs", {}).keys())
    if t == "http-request":
        return {"body", "status_code", "headers", "files"}
    if t == "start":
        return {v["variable"] for v in n["data"]["variables"]}
    if t == "knowledge-retrieval":
        return {"result"}
    if t == "question-classifier":
        return {"class_name"}
    if t == "answer":
        return {"answer"}
    return set()


# Chatflow で使える {{#sys.x#}}
SYS_VARS = {"query", "files", "conversation_id", "user_id", "dialogue_count", "app_id", "workflow_id", "workflow_run_id"}


def check(path: str, expected_inputs: set[str], expected_schema_keys: list[set[str]]) -> list[str]:
    errors: list[str] = []
    doc = load(path)
    graph = doc["workflow"]["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    by_type: dict[str, list[dict]] = {}
    for n in graph["nodes"]:
        by_type.setdefault(n["data"]["type"], []).append(n)

    if doc.get("app", {}).get("mode") != "workflow":
        errors.append("app.mode が workflow ではない")

    # 2. Start 変数
    starts = by_type.get("start", [])
    if len(starts) != 1:
        errors.append(f"start ノードが {len(starts)} 個")
    start_vars = {v["variable"] for v in starts[0]["data"]["variables"]} if starts else set()
    missing = expected_inputs - start_vars
    extra = start_vars - expected_inputs
    if missing:
        errors.append(f"Start に無い変数（dify.ts は送る）: {sorted(missing)}")
    if extra:
        errors.append(f"Start にだけある変数（dify.ts は送らない）: {sorted(extra)}")

    # 3. End 出力
    llm_ids = {n["id"] for n in by_type.get("llm", [])}
    for e in by_type.get("end", []):
        outs = e["data"].get("outputs", [])
        if [o["variable"] for o in outs] != ["result"]:
            errors.append(f"End {e['id']} の出力変数が result だけではない: {[o['variable'] for o in outs]}")
        for o in outs:
            sel = o["value_selector"]
            if sel[0] not in llm_ids or sel[1] != "text":
                errors.append(f"End {e['id']} の value_selector が LLM の text を指していない: {sel}")
    if not by_type.get("end"):
        errors.append("End ノードが無い")

    # 4. edges
    for ed in graph["edges"]:
        if ed["source"] not in nodes:
            errors.append(f"edge {ed['id']}: source {ed['source']} が存在しない")
        if ed["target"] not in nodes:
            errors.append(f"edge {ed['id']}: target {ed['target']} が存在しない")
        src = nodes.get(ed["source"])
        if src and src["data"]["type"] == "if-else":
            case_ids = {c["case_id"] for c in src["data"]["cases"]} | {"false"}
            if ed.get("sourceHandle") not in case_ids:
                errors.append(f"edge {ed['id']}: if-else の sourceHandle {ed.get('sourceHandle')} が cases に無い")
        elif ed.get("sourceHandle") != "source":
            errors.append(f"edge {ed['id']}: sourceHandle は source であるべき")
        if ed.get("targetHandle") != "target":
            errors.append(f"edge {ed['id']}: targetHandle は target であるべき")
        if src and ed["data"].get("sourceType") != src["data"]["type"]:
            errors.append(f"edge {ed['id']}: data.sourceType が実際のノード種別と違う")
        tgt = nodes.get(ed["target"])
        if tgt and ed["data"].get("targetType") != tgt["data"]["type"]:
            errors.append(f"edge {ed['id']}: data.targetType が実際のノード種別と違う")
    targets = {ed["target"] for ed in graph["edges"]}
    for n in graph["nodes"]:
        if n["data"]["type"] != "start" and n["id"] not in targets:
            errors.append(f"ノード {n['id']} に入るエッジが無い")

    # 5. {{#node.var#}} 参照（LLM プロンプト・http の body/headers・if-else 条件）
    def check_ref(where: str, node_id: str, var: str) -> None:
        if node_id == "env":
            return  # 8 で検査
        if node_id not in nodes:
            errors.append(f"{where} が存在しないノード {node_id} を参照")
            return
        if var not in node_outputs(nodes[node_id]):
            errors.append(f"{where} が {node_id} に無い出力 {var} を参照")

    for n in by_type.get("llm", []):
        for p in n["data"]["prompt_template"]:
            for node_id, var in REF_RE.findall(p["text"]):
                check_ref(f"LLM {n['id']} の {p['role']}", node_id, var)
        if not any(p["role"] == "system" for p in n["data"]["prompt_template"]):
            errors.append(f"LLM {n['id']} に system プロンプトが無い")
        if "{{#start.policy#}}" not in "".join(p["text"] for p in n["data"]["prompt_template"]):
            errors.append(f"LLM {n['id']} が policy 変数を使っていない")
        # 7. プロバイダ統一
        model = n["data"].get("model", {})
        if model.get("provider") != OPENAI_PROVIDER:
            errors.append(f"LLM {n['id']} のプロバイダが OpenAI ではない: {model.get('provider')}")
        if not model.get("name"):
            errors.append(f"LLM {n['id']} にモデル名が無い")

    for n in by_type.get("http-request", []):
        texts = [n["data"].get("headers", ""), n["data"].get("url", ""), n["data"].get("params", "")]
        texts += [d.get("value", "") for d in n["data"].get("body", {}).get("data", [])]
        for node_id, var in REF_RE.findall("\n".join(texts)):
            check_ref(f"http {n['id']}", node_id, var)
        # 8. env 参照の宣言
        declared = {e["name"] for e in doc["workflow"].get("environment_variables", [])}
        for name in ENV_REF_RE.findall("\n".join(texts)):
            if name not in declared:
                errors.append(f"http {n['id']} が未宣言の環境変数 {name} を参照")

    # 9. code ノードの入出力
    for n in by_type.get("code", []):
        for v in n["data"].get("variables", []):
            sel = v["value_selector"]
            check_ref(f"code {n['id']} の変数 {v['variable']}", sel[0], sel[1])
        if not n["data"].get("outputs"):
            errors.append(f"code {n['id']} に outputs が無い")
        if n["data"].get("code_language") != "python3":
            errors.append(f"code {n['id']} の言語が python3 ではない")
        code = n["data"].get("code", "")
        if "def main(" not in code:
            errors.append(f"code {n['id']} に main 関数が無い")
        # main の引数名が variables と一致する
        m = re.search(r"def main\(([^)]*)\)", code)
        if m:
            args = {a.split(":")[0].strip() for a in m.group(1).split(",") if a.strip()}
            declared_vars = {v["variable"] for v in n["data"].get("variables", [])}
            if args != declared_vars:
                errors.append(f"code {n['id']} の main 引数 {sorted(args)} と variables {sorted(declared_vars)} が不一致")

    # 6. 出力キーがプロンプトに含まれる（LLM ノードの数と schema の数が一致する前提で順に照合）
    llms = by_type.get("llm", [])
    if len(llms) != len(expected_schema_keys):
        errors.append(f"LLM ノード数 {len(llms)} と期待 schema 数 {len(expected_schema_keys)} が不一致")
    for n, keys in zip(llms, expected_schema_keys):
        system = next((p["text"] for p in n["data"]["prompt_template"] if p["role"] == "system"), "")
        lacking = [k for k in sorted(keys) if f'"{k}"' not in system]
        if lacking:
            errors.append(f"LLM {n['id']} の system に出力キーが無い: {lacking}")

    # IF/ELSE の分岐変数が Start に存在する
    for n in by_type.get("if-else", []):
        for c in n["data"]["cases"]:
            for cond in c["conditions"]:
                sel = cond["variable_selector"]
                check_ref(f"if-else {n['id']}", sel[0], sel[1])

    # tool ノード（現在日時）の設定
    for n in by_type.get("tool", []):
        d = n["data"]
        if d.get("provider_id") != "time" or d.get("tool_name") != "current_time":
            errors.append(f"tool {n['id']} は time/current_time を想定")
        tz = d.get("tool_configurations", {}).get("timezone", {}).get("value")
        if tz != "Asia/Tokyo":
            errors.append(f"tool {n['id']} の timezone が Asia/Tokyo ではない: {tz}")
    return errors


def check_chat(path: str, expected_start_vars: set[str]) -> list[str]:
    """Chatflow（advanced-chat）の検査。Workflow 用の check() とは別の契約なので分けている。"""
    errors: list[str] = []
    doc = load(path)
    graph = doc["workflow"]["graph"]
    nodes = {n["id"]: n for n in graph["nodes"]}
    by_type: dict[str, list[dict]] = {}
    for n in graph["nodes"]:
        by_type.setdefault(n["data"]["type"], []).append(n)

    declared_env = {e["name"] for e in doc["workflow"].get("environment_variables", [])}
    declared_conv = {c["name"] for c in doc["workflow"].get("conversation_variables", [])}

    # A. mode と End の不在
    if doc.get("app", {}).get("mode") != "advanced-chat":
        errors.append(f"app.mode が advanced-chat ではない: {doc.get('app', {}).get('mode')}")
    if by_type.get("end"):
        errors.append("Chatflow に End ノードがある（Answer ノードで返すべき）")

    # Start 変数
    starts = by_type.get("start", [])
    if len(starts) != 1:
        errors.append(f"start ノードが {len(starts)} 個")
    start_vars = {v["variable"] for v in starts[0]["data"]["variables"]} if starts else set()
    if start_vars != expected_start_vars:
        errors.append(f"Start 変数が想定と違う: {sorted(start_vars)} != {sorted(expected_start_vars)}")

    # B/H. Answer ノード（LLM の text か、後処理の code ノードの出力を参照する）
    llm_ids = {n["id"] for n in by_type.get("llm", [])}
    code_ids = {n["id"] for n in by_type.get("code", [])}
    answers = by_type.get("answer", [])
    if not answers:
        errors.append("Answer ノードが無い")
    for a in answers:
        refs = REF_RE.findall(a["data"].get("answer", ""))
        if not refs:
            errors.append(f"Answer {a['id']} が変数を参照していない")
        for node_id, var in refs:
            if node_id in llm_ids:
                if var != "text":
                    errors.append(f"Answer {a['id']} が LLM の text 以外を参照: {node_id}.{var}")
            elif node_id in code_ids:
                if var not in nodes[node_id]["data"].get("outputs", {}):
                    errors.append(f"Answer {a['id']} が code の未定義出力を参照: {node_id}.{var}")
            else:
                errors.append(f"Answer {a['id']} が LLM / code 以外を参照している: {node_id}.{var}")

    # 参照チェックの共通処理
    def check_ref(where: str, node_id: str, var: str) -> None:
        if node_id == "env":
            if var not in declared_env:
                errors.append(f"{where} が未宣言の環境変数 {var} を参照")
            return
        if node_id == "conversation":
            if var not in declared_conv:
                errors.append(f"{where} が未宣言の会話変数 {var} を参照")
            return
        if node_id == "sys":
            if var not in SYS_VARS:
                errors.append(f"{where} が不明な sys 変数 {var} を参照")
            return
        if node_id not in nodes:
            errors.append(f"{where} が存在しないノード {node_id} を参照")
            return
        if var not in node_outputs(nodes[node_id]):
            errors.append(f"{where} が {node_id} に無い出力 {var} を参照")

    # C. question-classifier の class id と edge の対応
    for n in by_type.get("question-classifier", []):
        class_ids = [c["id"] for c in n["data"].get("classes", [])]
        if len(class_ids) != len(set(class_ids)):
            errors.append(f"classifier {n['id']} の class id が重複")
        if not n["data"].get("instruction"):
            errors.append(f"classifier {n['id']} に instruction が無い")
        handles = [ed.get("sourceHandle") for ed in graph["edges"] if ed["source"] == n["id"]]
        for cid in class_ids:
            if cid not in handles:
                errors.append(f"classifier {n['id']} の class {cid} から出るエッジが無い")
        for h in handles:
            if h not in class_ids:
                errors.append(f"classifier {n['id']} の edge sourceHandle {h} が class に無い")
        if n["data"].get("model", {}).get("provider") != OPENAI_PROVIDER:
            errors.append(f"classifier {n['id']} のプロバイダが OpenAI ではない")

    # edges（source/target の実在・型・入るエッジ）
    for ed in graph["edges"]:
        if ed["source"] not in nodes:
            errors.append(f"edge {ed['id']}: source {ed['source']} が存在しない")
            continue
        if ed["target"] not in nodes:
            errors.append(f"edge {ed['id']}: target {ed['target']} が存在しない")
            continue
        src, tgt = nodes[ed["source"]], nodes[ed["target"]]
        if ed["data"].get("sourceType") != src["data"]["type"]:
            errors.append(f"edge {ed['id']}: data.sourceType が実際のノード種別と違う")
        if ed["data"].get("targetType") != tgt["data"]["type"]:
            errors.append(f"edge {ed['id']}: data.targetType が実際のノード種別と違う")
        if src["data"]["type"] == "if-else":
            case_ids = {c["case_id"] for c in src["data"]["cases"]} | {"false"}
            if ed.get("sourceHandle") not in case_ids:
                errors.append(f"edge {ed['id']}: if-else の sourceHandle {ed.get('sourceHandle')} が cases に無い")
        elif src["data"]["type"] != "question-classifier" and ed.get("sourceHandle") != "source":
            errors.append(f"edge {ed['id']}: sourceHandle は source であるべき")
        if ed.get("targetHandle") != "target":
            errors.append(f"edge {ed['id']}: targetHandle は target であるべき")
    targets = {ed["target"] for ed in graph["edges"]}
    for n in graph["nodes"]:
        if n["data"]["type"] != "start" and n["id"] not in targets:
            errors.append(f"ノード {n['id']} に入るエッジが無い")

    # G. LLM プロンプト（Chatflow は system のみ + memory で発話を渡す）
    for n in by_type.get("llm", []):
        texts = [p["text"] for p in n["data"]["prompt_template"]]
        for node_id, var in REF_RE.findall("\n".join(texts)):
            check_ref(f"LLM {n['id']} のプロンプト", node_id, var)
        if not any(p["role"] == "system" for p in n["data"]["prompt_template"]):
            errors.append(f"LLM {n['id']} に system プロンプトが無い")
        if "{{#code_context.policy_text#}}" not in "".join(texts):
            errors.append(f"LLM {n['id']} がポリシー（code_context.policy_text）を使っていない")
        if not n["data"].get("memory", {}).get("window", {}).get("enabled"):
            errors.append(f"LLM {n['id']} の会話メモリ（memory.window）が無効")
        if n["data"].get("model", {}).get("provider") != OPENAI_PROVIDER:
            errors.append(f"LLM {n['id']} のプロバイダが OpenAI ではない")
        ctx = n["data"].get("context", {})
        if ctx.get("enabled"):
            sel = ctx.get("variable_selector") or []
            if len(sel) != 2:
                errors.append(f"LLM {n['id']} の context.variable_selector が不正: {sel}")
            else:
                check_ref(f"LLM {n['id']} の context", sel[0], sel[1])
            if "{{#context#}}" not in "".join(texts):
                errors.append(f"LLM {n['id']} は context 有効だがプロンプトに {{{{#context#}}}} が無い")

    # F. http-request（URL / ヘッダの env 参照）
    for n in by_type.get("http-request", []):
        texts = [n["data"].get("headers", ""), n["data"].get("url", ""), n["data"].get("params", "")]
        texts += [d.get("value", "") for d in n["data"].get("body", {}).get("data", [])]
        joined = "\n".join(texts)
        for node_id, var in REF_RE.findall(joined):
            check_ref(f"http {n['id']}", node_id, var)
        for name in ENV_REF_RE.findall(joined):
            if name not in declared_env:
                errors.append(f"http {n['id']} が未宣言の環境変数 {name} を参照")
        url = n["data"].get("url", "")
        if "{{#env." not in url and url not in EXTERNAL_APIS:
            errors.append(f"http {n['id']} の URL が env 参照でも許可した外部 API でもない: {url}")
        if "Bearer {{#env." not in n["data"].get("headers", ""):
            errors.append(f"http {n['id']} の Authorization が env のトークンを使っていない")
        # J. 外部 API はリクエスト本文を code ノードが組み立てる（プロンプト直書き・改ざんを防ぐ）
        if url in EXTERNAL_APIS:
            body_refs = [
                (nid, var)
                for d in n["data"].get("body", {}).get("data", [])
                for nid, var in REF_RE.findall(d.get("value", ""))
            ]
            if not body_refs or any(nid not in code_ids for nid, _ in body_refs):
                errors.append(f"http {n['id']} の body が code ノードの出力ではない（外部 API は code で組み立てる）")

    # E. code ノード（main 引数 == variables、下流の参照が outputs に存在）
    for n in by_type.get("code", []):
        for v in n["data"].get("variables", []):
            sel = v["value_selector"]
            check_ref(f"code {n['id']} の変数 {v['variable']}", sel[0], sel[1])
        outputs = n["data"].get("outputs", {})
        if not outputs:
            errors.append(f"code {n['id']} に outputs が無い")
        if n["data"].get("code_language") != "python3":
            errors.append(f"code {n['id']} の言語が python3 ではない")
        code = n["data"].get("code", "")
        m = re.search(r"def main\(([^)]*)\)", code)
        if not m:
            errors.append(f"code {n['id']} に main 関数が無い")
        else:
            args = {a.split(":")[0].strip() for a in m.group(1).split(",") if a.strip()}
            declared_vars = {v["variable"] for v in n["data"].get("variables", [])}
            if args != declared_vars:
                errors.append(f"code {n['id']} の main 引数 {sorted(args)} と variables {sorted(declared_vars)} が不一致")
        # 生成コードが Python として妥当か
        try:
            compile(code, f"{n['id']}.py", "exec")
        except SyntaxError as e:
            errors.append(f"code {n['id']} の Python が構文エラー: {e}")
        # 宣言した outputs をすべて return しているか（キー名の取りこぼし検出）
        for name in outputs:
            if f'"{name}"' not in code:
                errors.append(f"code {n['id']} が outputs {name} を返していない可能性")

    # if-else / assigner の参照
    for n in by_type.get("if-else", []):
        for c in n["data"]["cases"]:
            for cond in c["conditions"]:
                sel = cond["variable_selector"]
                check_ref(f"if-else {n['id']}", sel[0], sel[1])
                # I. 印（NEED_SEARCH）で分岐するなら、参照先の LLM がその印を出すよう指示されていること
                val = str(cond.get("value") or "")
                if val.upper().startswith("NEED_SEARCH") and sel[0] in llm_ids:
                    system = "".join(p["text"] for p in nodes[sel[0]]["data"]["prompt_template"])
                    if "NEED_SEARCH" not in system:
                        errors.append(f"if-else {n['id']} は NEED_SEARCH で分岐するが、{sel[0]} の指示に NEED_SEARCH が無い")
    for n in by_type.get("assigner", []):
        for item in n["data"].get("items", []):
            sel = item.get("variable_selector") or []
            if len(sel) != 2:
                errors.append(f"assigner {n['id']} の variable_selector が不正: {sel}")
            else:
                check_ref(f"assigner {n['id']} の代入先", sel[0], sel[1])
            if item.get("input_type") == "variable":
                v = item.get("value") or []
                if len(v) != 2:
                    errors.append(f"assigner {n['id']} の value（変数）が不正: {v}")
                else:
                    check_ref(f"assigner {n['id']} の代入値", v[0], v[1])
            elif not item.get("value"):
                errors.append(f"assigner {n['id']} の定数値が空")

    # knowledge-retrieval
    for n in by_type.get("knowledge-retrieval", []):
        sel = n["data"].get("query_variable_selector") or []
        if len(sel) != 2:
            errors.append(f"knowledge {n['id']} の query_variable_selector が不正: {sel}")
        else:
            check_ref(f"knowledge {n['id']} の query", sel[0], sel[1])
        if n["data"].get("dataset_ids"):
            errors.append(f"knowledge {n['id']} に dataset_ids が埋め込まれている（環境ごとに違うので空にする）")
    return errors


def main() -> int:
    inputs = inputs_from_ts()
    schemas = schema_keys_from_ts()
    targets = [
        ("trivium-domain.yml", inputs["difyDomainApiKey"], [schemas["evalSchema"], schemas["interpretSchema"]]),
        ("trivium-leader.yml", inputs["difyLeaderApiKey"], [schemas["leaderSchema"]]),
        # generate は検索あり/なしの 2 つの LLM ノードが同じ schema を返す
        ("trivium-generate.yml", inputs["difyGenerateApiKey"], [schemas["generateSchema"], schemas["generateSchema"]]),
    ]
    ok = True
    for fname, expected, schema_keys in targets:
        path = os.path.join(HERE, fname)
        errors = check(path, expected, schema_keys)
        if errors:
            ok = False
            print(f"NG  {fname}")
            for e in errors:
                print(f"    - {e}")
        else:
            print(f"OK  {fname}  (start vars: {len(expected)}, output keys: {[len(k) for k in schema_keys]})")

    # Chatflow（アプリからは会話 API で呼ぶので dify.ts の inputs 契約とは別枠）
    chat_path = os.path.join(HERE, "trivium-chat.yml")
    if os.path.exists(chat_path):
        errors = check_chat(chat_path, {"learner_ref", "addressed_agent", "app_url"})
        if errors:
            ok = False
            print("NG  trivium-chat.yml")
            for e in errors:
                print(f"    - {e}")
        else:
            print("OK  trivium-chat.yml  (chatflow: 4 人格 + 教材おすすめ)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
