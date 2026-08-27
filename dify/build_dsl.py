# -*- coding: utf-8 -*-
"""Trivium 用 Dify Workflow DSL の生成スクリプト。

  python dify/build_dsl.py        # dify/trivium-domain.yml と dify/trivium-leader.yml を書き出す

DSL を手で編集すると差分が追いにくいので、プロンプトや変数はここに集約し、
YAML はこのスクリプトから生成する。生成後は dify/validate.py で
src/lib/ai/dify.ts の inputs / 出力キーと整合しているか検査する。
"""
from __future__ import annotations

import os
import sys
from typing import Any

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- LLM の既定設定（インポート後に Dify 側で差し替え可能） ----
MODEL = {
    "provider": "langgenius/anthropic/anthropic",
    "name": "claude-sonnet-4-5",
    "mode": "chat",
    "completion_params": {"temperature": 0.3, "max_tokens": 1024},
}
ANTHROPIC_PLUGIN = "langgenius/anthropic:0.0.14@anthropic"  # インポート時に解決される目安。無ければ Dify が代替を案内する

# ---- Start ノード変数（src/lib/ai/dify.ts の inputs と完全一致させる） ----
# type: text-input（1行）/ paragraph（長文）/ number
DOMAIN_VARS: list[tuple[str, str, str, bool]] = [
    # (variable, label, type, required)
    ("workflow", "呼び出し種別（domain / interpret）", "text-input", True),
    ("mode", "read / write / code", "text-input", True),
    ("policy", "システムポリシー 7 箇条", "paragraph", True),
    ("task", "課題 JSON（domain 用）", "paragraph", False),
    ("learner_answer", "学習者の回答（domain 用）", "paragraph", False),
    ("deterministic_result", "correct / incorrect / unknown（domain 用）", "text-input", False),
    ("heuristic_result", "meets_rubric / below_rubric / n/a（domain 用）", "text-input", False),
    ("hint_level", "これまでに出したヒント数（domain 用）", "number", False),
    ("current_domain_profile", "domain profile JSON（domain 用）", "paragraph", False),
    ("recent_behavior", "直近の学習行動（改行区切り、domain 用）", "paragraph", False),
    ("stats", "集計値 JSON（interpret 用）", "paragraph", False),
    ("recent_events", "直近イベント JSON（interpret 用）", "paragraph", False),
]

LEADER_VARS: list[tuple[str, str, str, bool]] = [
    ("workflow", "常に leader", "text-input", True),
    ("policy", "システムポリシー 7 箇条", "paragraph", True),
    ("domains", "3 domain の要約 JSON 配列", "paragraph", True),
    ("total_events", "学習記録の総数", "number", True),
    ("last_event", "直近の学習イベント JSON（無ければ空）", "paragraph", False),
    ("context", "「10分だけ」などの文脈（無ければ空）", "paragraph", False),
]

# ---- プロンプト ----
JSON_ONLY = (
    "出力は JSON オブジェクト 1 つだけ。前後の説明文・コードフェンス（```）・コメントは一切付けない。"
    "すべての文字列は日本語で、学習者に直接語りかける丁寧で簡潔な文体（です・ます）。"
)

SYSTEM_EVAL = f"""あなたは学習サービス Trivium の READ / WRITE / CODE の指導役です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: 学習者の回答を評価し、必要なら「一段だけ」のヒントを返します。完成した答え・完成コード・書き直した完成文章を渡してはいけません。

{JSON_ONLY}
キーは次の 6 つ（順不同・すべて必須）:
{{"status": "success | retry | needs_more", "feedback": "string", "hint": "string", "observations": ["string"], "skill_tags": ["string"], "recommended_next_difficulty": 1}}

判定ルール:
- deterministic_result が correct なら status は必ず "success"、hint は空文字。
- deterministic_result が incorrect なら status は "retry"。hint は task.hints 配列の hint_level 番目（0 始まり。範囲外なら最後）を選び、必要なら学習者の誤答に合わせて一言だけ言い換える。hints に無い新しい答えの手がかりを足さない。
- deterministic_result が unknown（自由記述）のときだけ内容を評価する。heuristic_result は参考情報で、最終判断は task.criteria に照らして行う。観点を満たしていれば "success"、足りなければ "needs_more" にして hint を一段だけ返す。
- feedback は 2 文以内。答えを書かない。問い返しを優先する。
- observations は「学習行動」についてだけ（性格・能力の断定はしない）。証拠が足りなければ「まだ判断できない」と書く。
- skill_tags は task に関係する観点名だけ（英語の識別子。例: tracing, debugging, structure, inference）。分からなければ空配列。
- recommended_next_difficulty は 1〜5 の整数。ヒントなしで成功なら task.difficulty + 1、ヒント 2 回以上や未達なら据え置きか -1。"""

USER_EVAL = """## mode
{{#start.mode#}}

## task（JSON）
{{#start.task#}}

## learner_answer
{{#start.learner_answer#}}

## deterministic_result
{{#start.deterministic_result#}}

## heuristic_result
{{#start.heuristic_result#}}

## hint_level
{{#start.hint_level#}}

## current_domain_profile（JSON）
{{#start.current_domain_profile#}}

## recent_behavior
{{#start.recent_behavior#}}

上記を踏まえ、指定の JSON だけを出力してください。"""

SYSTEM_INTERPRET = f"""あなたは学習サービス Trivium の READ / WRITE / CODE の指導役です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: 1 つの domain（mode）の集計値と直近の学習イベントを読み、学習者向けの短い寸評を書きます。数値は既に決定論的に集計済みです。あなたの仕事は「解釈」であり、数値を作り直したり上書きしたりしないでください。

{JSON_ONLY}
キーは次の 3 つ（すべて必須）:
{{"summary": "string", "observations": ["string"], "recommended_next": "string"}}

書き方:
- summary は 2〜3 文。subskills の高い観点・低い観点・未計測の観点に触れる。confidence が low なら「記録が少ないため暫定的」と必ず明記する。
- observations は行動の事実（ヒント回数・成功率・直近の失敗など）から言えることだけを 1〜3 件。性格の断定はしない。
- recommended_next は次に取り組む課題を 1 文で（未計測や低い観点を含む課題、または難易度を 1 段上げる提案）。"""

USER_INTERPRET = """## mode
{{#start.mode#}}

## stats（JSON: score, subskills, confidence, evidenceCount, successRate, avgHints, avgDifficulty）
{{#start.stats#}}

## recent_events（JSON 配列: taskTitle, difficulty, success, hintCount, skillTags, daysAgo）
{{#start.recent_events#}}

上記を踏まえ、指定の JSON だけを出力してください。"""

SYSTEM_LEADER = f"""あなたは学習サービス Trivium の LEADER（global learner model）です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: READ / WRITE / CODE それぞれの要約（数値は決定論的に集計済み）を横断して読み、学習者全体の傾向と「次の一歩」を決めます。各 domain の細かい評価は domain 側の仕事なので繰り返さず、横断的な見立てに集中してください。

{JSON_ONLY}
キーは次の 6 つ（すべて必須）:
{{"summary": "string", "interests": ["string"], "preferences": {{"string": "string"}}, "observations": ["string"], "recommendation": "string", "recommended_domain": "READ | WRITE | CODE"}}

書き方:
- summary は 3 文以内。最も強い domain と、伸ばすと他の強みを活かしやすくなる domain を関係づけて述べる。last_event があれば「直近では…」と 1 文で触れる。evidenceCount が 0 の domain は「未計測」と明記し、全体像が暫定であることを添える。
- interests は domain ごとの取り組み傾向（例: "CODE: 週7件"）を短く。
- preferences は文字列→文字列のマップ（例: practiceFocus, preferredDifficulty）。分からなければ空オブジェクト。
- observations は直近 7 日の偏り・取り組みの空白など、行動の事実だけを 1〜3 件。
- recommendation は次に取り組む 1 課題を「DOMAIN: 内容」の形で 1 文。context（例: 「10分だけ」）があれば時間に合う提案にする。
- recommended_domain は recommendation と同じ domain を READ / WRITE / CODE のいずれかで返す。未計測の domain があればそれを優先する。"""

USER_LEADER = """## domains（JSON 配列: domain, score, subskills, confidence, evidenceCount, summary, observations, recommendedNext, eventsLast7Days）
{{#start.domains#}}

## total_events
{{#start.total_events#}}

## last_event（JSON。無ければ空）
{{#start.last_event#}}

## context（無ければ空）
{{#start.context#}}

上記を踏まえ、指定の JSON だけを出力してください。"""


# ---- DSL 組み立て ----
def start_node(node_id: str, variables: list[tuple[str, str, str, bool]], y: int) -> dict[str, Any]:
    vs = []
    for name, label, vtype, required in variables:
        v: dict[str, Any] = {"variable": name, "label": label, "type": vtype, "required": required, "options": []}
        if vtype in ("text-input", "paragraph"):
            v["max_length"] = 48000 if vtype == "paragraph" else 256
        vs.append(v)
    return node(node_id, "start", {"title": "開始", "type": "start", "variables": vs, "selected": False}, x=80, y=y, w=244, h=54 + 26 * len(vs))


def llm_node(node_id: str, title: str, system: str, user: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "llm",
        "selected": False,
        "model": dict(MODEL),
        "prompt_template": [
            {"id": f"{node_id}-system", "role": "system", "text": system},
            {"id": f"{node_id}-user", "role": "user", "text": user},
        ],
        "context": {"enabled": False, "variable_selector": []},
        "vision": {"enabled": False},
    }
    return node(node_id, "llm", data, x=x, y=y, w=244, h=98)


def ifelse_node(node_id: str, title: str, variable_selector: list[str], value: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "if-else",
        "desc": f"{'.'.join(variable_selector)} が {value} なら true 側",
        "selected": False,
        "cases": [
            {
                "case_id": "true",
                "id": "true",
                "logical_operator": "and",
                "conditions": [
                    {
                        "id": f"{node_id}-cond-1",
                        "variable_selector": variable_selector,
                        "varType": "string",
                        "comparison_operator": "is",
                        "value": value,
                    }
                ],
            }
        ],
    }
    return node(node_id, "if-else", data, x=x, y=y, w=244, h=126)


def end_node(node_id: str, source_llm_ids: list[str], x: int, y: int) -> list[dict[str, Any]]:
    # Dify の End ノードは 1 つの出力変数に 1 つの value_selector しか持てないため、
    # 分岐ごとに End ノードを用意する（出力変数名はどちらも result）。
    nodes = []
    for i, llm_id in enumerate(source_llm_ids):
        data = {
            "title": "終了" if len(source_llm_ids) == 1 else f"終了 ({llm_id})",
            "type": "end",
            "selected": False,
            "outputs": [{"variable": "result", "value_selector": [llm_id, "text"]}],
        }
        nodes.append(node(f"{node_id}-{i}" if len(source_llm_ids) > 1 else node_id, "end", data, x=x, y=y + i * 160, w=244, h=90))
    return nodes


def node(node_id: str, ntype: str, data: dict[str, Any], *, x: int, y: int, w: int, h: int) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "custom",
        "data": data,
        "position": {"x": x, "y": y},
        "positionAbsolute": {"x": x, "y": y},
        "width": w,
        "height": h,
        "selected": False,
        "sourcePosition": "right",
        "targetPosition": "left",
    }


def edge(source: str, target: str, source_type: str, target_type: str, source_handle: str = "source") -> dict[str, Any]:
    return {
        "id": f"{source}-{source_handle}-{target}",
        "type": "custom",
        "source": source,
        "sourceHandle": source_handle,
        "target": target,
        "targetHandle": "target",
        "data": {"sourceType": source_type, "targetType": target_type, "isInIteration": False},
        "zIndex": 0,
    }


def app_shell(name: str, description: str, icon: str, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "version": "0.6.0",
        "kind": "app",
        "app": {
            "name": name,
            "description": description,
            "mode": "workflow",
            "icon": icon,
            "icon_type": "emoji",
            "icon_background": "#EFF1F5",
            "use_icon_as_answer_icon": False,
        },
        "dependencies": [
            {
                "type": "marketplace",
                "current_identifier": None,
                "value": {"marketplace_plugin_unique_identifier": ANTHROPIC_PLUGIN, "version": None},
            }
        ],
        "workflow": {
            "conversation_variables": [],
            "environment_variables": [],
            "rag_pipeline_variables": [],
            "features": {
                "file_upload": {
                    "enabled": False,
                    "allowed_file_extensions": [],
                    "allowed_file_types": [],
                    "allowed_file_upload_methods": [],
                    "number_limits": 0,
                    "image": {"enabled": False, "number_limits": 0, "transfer_methods": []},
                },
                "opening_statement": "",
                "retriever_resource": {"enabled": False},
                "sensitive_word_avoidance": {"enabled": False},
                "speech_to_text": {"enabled": False},
                "suggested_questions": [],
                "suggested_questions_after_answer": {"enabled": False},
                "text_to_speech": {"enabled": False, "language": "", "voice": ""},
            },
            "graph": {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.8}},
        },
    }


def build_domain() -> dict[str, Any]:
    start = start_node("start", DOMAIN_VARS, y=200)
    branch = ifelse_node("branch", "workflow で分岐", ["start", "workflow"], "domain", x=420, y=260)
    llm_eval = llm_node("llm_eval", "回答評価（domain）", SYSTEM_EVAL, USER_EVAL, x=760, y=120)
    llm_interp = llm_node("llm_interpret", "寸評生成（interpret）", SYSTEM_INTERPRET, USER_INTERPRET, x=760, y=420)
    ends = end_node("end", ["llm_eval", "llm_interpret"], x=1100, y=120)
    nodes = [start, branch, llm_eval, llm_interp, *ends]
    edges = [
        edge("start", "branch", "start", "if-else"),
        edge("branch", "llm_eval", "if-else", "llm", source_handle="true"),
        edge("branch", "llm_interpret", "if-else", "llm", source_handle="false"),
        edge("llm_eval", ends[0]["id"], "llm", "end"),
        edge("llm_interpret", ends[1]["id"], "llm", "end"),
    ]
    return app_shell(
        "trivium-domain",
        "Trivium: READ/WRITE/CODE の回答評価（一段ヒント）と domain 寸評。workflow=domain|interpret で分岐。出力は result（JSON 文字列）。",
        "📐",
        nodes,
        edges,
    )


def build_leader() -> dict[str, Any]:
    start = start_node("start", LEADER_VARS, y=200)
    llm = llm_node("llm_leader", "総合寸評（leader）", SYSTEM_LEADER, USER_LEADER, x=420, y=200)
    ends = end_node("end", ["llm_leader"], x=760, y=200)
    nodes = [start, llm, *ends]
    edges = [edge("start", "llm_leader", "start", "llm"), edge("llm_leader", ends[0]["id"], "llm", "end")]
    return app_shell(
        "trivium-leader",
        "Trivium: 3 domain の要約から総合寸評と次のおすすめを出す LEADER。出力は result（JSON 文字列）。",
        "🧭",
        nodes,
        edges,
    )


class _Dumper(yaml.SafeDumper):
    pass


def _str_presenter(dumper: yaml.SafeDumper, data: str):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_Dumper.add_representer(str, _str_presenter)


def write(path: str, doc: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("# このファイルは dify/build_dsl.py から生成される。手で編集せず、スクリプトを直して再生成すること。\n")
        yaml.dump(doc, f, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=200)


def main() -> int:
    write(os.path.join(HERE, "trivium-domain.yml"), build_domain())
    write(os.path.join(HERE, "trivium-leader.yml"), build_leader())
    print("wrote dify/trivium-domain.yml, dify/trivium-leader.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
