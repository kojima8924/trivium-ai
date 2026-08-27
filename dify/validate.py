# -*- coding: utf-8 -*-
"""Dify DSL（3 本）と src/lib/ai/dify.ts の契約が一致しているか検査する。

  python dify/validate.py

検査項目:
  1. YAML としてパースできる
  2. Start ノードの変数名が dify.ts の run() に渡す inputs のキーと完全一致（不足・余剰を検出）
  3. End ノードの出力変数名が result で、value_selector が実在する LLM ノードの text を指す
  4. edges の source / target が実在ノード、IF/ELSE の sourceHandle が cases の id か false、全ノードに入るエッジがある
  5. プロンプト内の {{#node.var#}} 参照が Start の変数（または実在ノードの出力）に存在する
  6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて含まれる
  7. LLM ノードのプロバイダが OpenAI（langgenius/openai/openai）で統一されている
  8. http-request が {{#env.XXX#}} を参照するなら、その環境変数が environment_variables に宣言されている
  9. code ノードの variables が実在ノードの出力を指し、outputs が下流の参照名と一致する
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
    return set()


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
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
