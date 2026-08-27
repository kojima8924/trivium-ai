# -*- coding: utf-8 -*-
"""Dify DSL と src/lib/ai/dify.ts の契約が一致しているか検査する。

  python dify/validate.py

検査項目:
  1. YAML としてパースできる
  2. Start ノードの変数名が dify.ts の run() に渡す inputs のキーと完全一致（不足・余剰を検出）
  3. End ノードの出力変数名が result で、value_selector が実在する LLM ノードの text を指す
  4. edges の source / target が実在ノード、IF/ELSE の sourceHandle が cases の id か false
  5. プロンプト内の {{#node.var#}} 参照が Start の変数（または実在ノード）に存在する
  6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて含まれる
"""
from __future__ import annotations

import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIFY_TS = os.path.join(ROOT, "src", "lib", "ai", "dify.ts")

# dify.ts の呼び出し（evaluate / interpretDomain / leader）ごとの inputs キーを正規表現で抽出する。
# 形: this.run(env.ai.<key>, { ...inputs... }, input.learnerRef)
RUN_RE = re.compile(r"this\.run\(\s*env\.ai\.(\w+),\s*\{(.*?)\},\s*input\.learnerRef", re.S)
KEY_RE = re.compile(r"^\s*([a-z_]+):", re.M)
SCHEMA_RE = re.compile(r"const (\w+Schema) = z\.object\(\{(.*?)\n\}\);", re.S)


def inputs_from_ts() -> dict[str, set[str]]:
    src = open(DIFY_TS, encoding="utf-8").read()
    out: dict[str, set[str]] = {}
    for api_key, body in RUN_RE.findall(src):
        keys = set(KEY_RE.findall(body))
        out.setdefault(api_key, set()).update(keys)
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
    # 到達性: すべての LLM/End に入るエッジがある
    targets = {ed["target"] for ed in graph["edges"]}
    for n in graph["nodes"]:
        if n["data"]["type"] != "start" and n["id"] not in targets:
            errors.append(f"ノード {n['id']} に入るエッジが無い")

    # 5. {{#node.var#}} 参照
    ref_re = re.compile(r"\{\{#([\w-]+)\.([\w-]+)#\}\}")
    for n in by_type.get("llm", []):
        for p in n["data"]["prompt_template"]:
            for node_id, var in ref_re.findall(p["text"]):
                if node_id == "start":
                    if var not in start_vars:
                        errors.append(f"LLM {n['id']} の {p['role']} が未定義の start.{var} を参照")
                elif node_id not in nodes:
                    errors.append(f"LLM {n['id']} の {p['role']} が存在しないノード {node_id} を参照")
        if not any(p["role"] == "system" for p in n["data"]["prompt_template"]):
            errors.append(f"LLM {n['id']} に system プロンプトが無い")
        if "{{#start.policy#}}" not in "".join(p["text"] for p in n["data"]["prompt_template"]):
            errors.append(f"LLM {n['id']} が policy 変数を使っていない")

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
                if sel[0] == "start" and sel[1] not in start_vars:
                    errors.append(f"if-else {n['id']} が未定義の start.{sel[1]} を参照")
    return errors


def main() -> int:
    inputs = inputs_from_ts()
    schemas = schema_keys_from_ts()
    targets = [
        ("trivium-domain.yml", inputs["difyDomainApiKey"], [schemas["evalSchema"], schemas["interpretSchema"]]),
        ("trivium-leader.yml", inputs["difyLeaderApiKey"], [schemas["leaderSchema"]]),
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
