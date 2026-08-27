# -*- coding: utf-8 -*-
"""Trivium 用 Dify Workflow DSL の生成スクリプト（OpenAI 版・3 本）。

  python dify/build_dsl.py     # trivium-domain.yml / trivium-leader.yml / trivium-generate.yml を書き出す

DSL を手で編集すると差分が追いにくいので、プロンプトや変数はここに集約し、
YAML はこのスクリプトから生成する。生成後は dify/validate.py で
src/lib/ai/dify.ts の inputs / 出力キーと整合しているか検査する。

構成:
  trivium-domain   Start → IF/ELSE(workflow==domain) → LLM(回答評価) / LLM(寸評生成) → End(result)
  trivium-leader   Start → 現在日時(組み込み time ツール, Asia/Tokyo) → LLM(総合寸評) → End(result)
  trivium-generate Start → IF/ELSE(use_search=="true")
                     ├ true : code(検索リクエスト組立) → HTTP(OpenAI Responses + web_search) → code(要約抽出) → LLM(作問) → End
                     └ false: LLM(作問) → End
LLM はすべて OpenAI（langgenius/openai/openai）。Web 検索も OpenAI Responses API の web_search ツールを HTTP ノードから呼ぶ。
"""
from __future__ import annotations

import os
import sys
from typing import Any

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- LLM の既定設定（インポート後に Dify 側で差し替え可能） ----
MODEL_NAME = "gpt-5.4-mini"  # アプリ側の直接呼び出し（OPENAI_MODEL の既定）と揃える
MODEL = {
    "provider": "langgenius/openai/openai",
    "name": MODEL_NAME,
    "mode": "chat",
    # 推論系モデルは temperature を受け付けないことがあるので空にしておく（Dify 側で必要なら追加）
    "completion_params": {},
}
# Dify Marketplace の OpenAI プラグイン。無ければインポート時に Dify が案内する
OPENAI_PLUGIN = "langgenius/openai:1.0.1@b513bf843af4619450bdc15f32e995f90ebdeee143b1cccef442a867099b3397"

# ---- Start ノード変数（src/lib/ai/dify.ts の inputs と完全一致させる） ----
# type: text-input（1行）/ paragraph（長文）/ number
DOMAIN_VARS: list[tuple[str, str, str, bool]] = [
    # (variable, label, type, required)
    ("workflow", "呼び出し種別（domain / interpret）", "text-input", True),
    ("mode", "read / write / code", "text-input", True),
    ("policy", "システムポリシー 7 箇条", "paragraph", True),
    ("persona", "AI の人格 JSON（name, tone, firstPerson, extra。無ければ空）", "paragraph", False),
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
    ("persona", "LEADER の人格 JSON（無ければ空）", "paragraph", False),
    ("domains", "3 domain の要約 JSON 配列", "paragraph", True),
    ("total_events", "学習記録の総数", "number", True),
    ("last_event", "直近の学習イベント JSON（無ければ空）", "paragraph", False),
    ("context", "「10分だけ」などの文脈（無ければ空）", "paragraph", False),
]

GENERATE_VARS: list[tuple[str, str, str, bool]] = [
    ("workflow", "常に generate", "text-input", True),
    ("policy", "システムポリシー 7 箇条", "paragraph", True),
    ("persona", "その domain の人格 JSON（無ければ空）", "paragraph", False),
    ("request", "学習者の依頼文（例: 論理パズルを1問）", "paragraph", True),
    ("domain", "READ / WRITE / CODE（CODE の表示名は LOGIC）", "text-input", True),
    ("kind", "choice / short / free", "text-input", True),
    ("difficulty", "1〜5", "number", True),
    ("allowed_skill_tags", "この domain の subskill 名（カンマ区切り）", "text-input", True),
    ("recent_titles", "直近の課題タイトル（改行区切り。同じ題材を避ける）", "paragraph", False),
    ("use_search", "時事ネタを使うなら true（Web 検索を挟む）", "text-input", False),
]

# ---- プロンプト ----
JSON_ONLY = (
    "出力は JSON オブジェクト 1 つだけ。前後の説明文・コードフェンス（```）・コメントは一切付けない。"
    "すべての文字列は日本語で、学習者に直接語りかける簡潔な文体。"
)

PERSONA_RULE = (
    "persona が空でなければ、その name を自分の名前、firstPerson を一人称、tone を口調、extra を補足として文体を一貫させる"
    "（名乗りは不要。設定を復唱しない）。persona が空なら丁寧で落ち着いた敬体。"
)

SYSTEM_EVAL = f"""あなたは学習サービス Trivium の READ / WRITE / LOGIC（内部キー CODE）の指導役です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: 学習者の回答を評価し、必要なら「一段だけ」のヒントを返します。完成した答え・完成コード・書き直した完成文章を渡してはいけません。
{PERSONA_RULE}

{JSON_ONLY}
キーは次の 6 つ（順不同・すべて必須）:
{{"status": "success | retry | needs_more", "feedback": "string", "hint": "string", "observations": ["string"], "skill_tags": ["string"], "recommended_next_difficulty": 1}}

判定ルール:
- deterministic_result が correct なら status は必ず "success"、hint は空文字。
- deterministic_result が incorrect なら status は "retry"。hint は task.hints 配列の hint_level 番目（0 始まり。範囲外なら最後）を選び、必要なら学習者の誤答に合わせて一言だけ言い換える。hints に無い新しい答えの手がかりを足さない。
- deterministic_result が unknown（自由記述）のときだけ内容を評価する。heuristic_result は参考情報で、最終判断は task.criteria に照らして行う。観点を満たしていれば "success"、足りなければ "needs_more" にして hint を一段だけ返す。
- feedback は 100 字以内・2 文以内。答えを書かない。問い返しを優先する。
- observations は「学習行動」についてだけ、各 40 字以内で最大 3 件（性格・能力の断定はしない）。証拠が足りなければ「まだ判断できない」と書く。
- skill_tags は task に関係する観点名だけ（英語の識別子。例: tracing, debugging, structure, inference）。分からなければ空配列。
- recommended_next_difficulty は 1〜5 の整数。ヒントなしで成功なら task.difficulty + 1、ヒント 2 回以上や未達なら据え置きか -1。"""

USER_EVAL = """## mode
{{#start.mode#}}

## persona（JSON。空なら既定の口調）
{{#start.persona#}}

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

SYSTEM_INTERPRET = f"""あなたは学習サービス Trivium の READ / WRITE / LOGIC（内部キー CODE）の指導役です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: 1 つの domain（mode）の集計値と直近の学習イベントを読み、学習者向けの短い寸評を書きます。数値は既に決定論的に集計済みです。あなたの仕事は「解釈」であり、数値を作り直したり上書きしたりしないでください。
{PERSONA_RULE}

{JSON_ONLY}
キーは次の 3 つ（すべて必須）:
{{"summary": "string", "observations": ["string"], "recommended_next": "string"}}

書き方:
- summary は 140 字以内・2〜3 文。subskills の高い観点・低い観点・未計測の観点に触れる。confidence が low なら「記録が少ないため暫定的」と必ず明記する。
- observations は行動の事実（ヒント回数・成功率・直近の失敗など）から言えることだけを 1〜3 件・各 40 字以内。性格の断定はしない。
- recommended_next は次に取り組む課題を 60 字以内で（未計測や低い観点を含む課題、または難易度を 1 段上げる提案）。"""

USER_INTERPRET = """## mode
{{#start.mode#}}

## persona（JSON。空なら既定の口調）
{{#start.persona#}}

## stats（JSON: score, subskills, confidence, evidenceCount, successRate, avgHints, avgDifficulty）
{{#start.stats#}}

## recent_events（JSON 配列: taskTitle, difficulty, success, hintCount, skillTags, daysAgo）
{{#start.recent_events#}}

上記を踏まえ、指定の JSON だけを出力してください。"""

SYSTEM_LEADER = f"""あなたは学習サービス Trivium の LEADER（global learner model）です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: READ / WRITE / LOGIC（内部キー CODE）それぞれの要約（数値は決定論的に集計済み）を横断して読み、学習者全体の傾向と「次の一歩」を決めます。各 domain の細かい評価は domain 側の仕事なので繰り返さず、横断的な見立てに集中してください。
{PERSONA_RULE}

現在日時（Asia/Tokyo）が now として渡されます。last_event.minutesAgo と合わせて「今日」「今週」「直近 7 日」の偏りを自然な言葉で述べてください（日時そのものを復唱しない）。

{JSON_ONLY}
キーは次の 6 つ（すべて必須）:
{{"summary": "string", "interests": ["string"], "preferences": {{"string": "string"}}, "observations": ["string"], "recommendation": "string", "recommended_domain": "READ | WRITE | CODE"}}

書き方:
- summary は 140 字以内・3 文以内。最も強い domain と、伸ばすと他の強みを活かしやすくなる domain を関係づけて述べる。last_event があれば「直近では…」と 1 文で触れる。evidenceCount が 0 の domain は「未計測」と明記し、全体像が暫定であることを添える。
- interests は domain ごとの取り組み傾向（例: "CODE: 週7件"）を短く。
- preferences は文字列→文字列のマップ（例: practiceFocus, preferredDifficulty）。分からなければ空オブジェクト。
- observations は直近 7 日の偏り・取り組みの空白など、行動の事実だけを 1〜3 件・各 40 字以内。
- recommendation は次に取り組む 1 課題を「DOMAIN: 内容」の形で 60 字以内。context（例: 「10分だけ」）があれば時間に合う提案にする。
- recommended_domain は recommendation と同じ domain を READ / WRITE / CODE のいずれかで返す（LOGIC は CODE と書く）。未計測の domain があればそれを優先する。"""

USER_LEADER = """## now（現在日時 Asia/Tokyo）
{{#now.text#}}

## persona（JSON。空なら既定の口調）
{{#start.persona#}}

## domains（JSON 配列: domain, score, subskills, confidence, evidenceCount, summary, observations, recommendedNext, eventsLast7Days）
{{#start.domains#}}

## total_events
{{#start.total_events#}}

## last_event（JSON。無ければ空）
{{#start.last_event#}}

## context（無ければ空）
{{#start.context#}}

上記を踏まえ、指定の JSON だけを出力してください。"""

SYSTEM_GENERATE = f"""あなたは学習サービス Trivium の作問担当です。次のポリシーを厳守してください。

{{{{#start.policy#}}}}

役割: 学習者の依頼にもとづき、指定の domain / kind / difficulty で課題を 1 問作ります。
- 問題は自己完結で、passage と prompt だけで解けること。実在の個人・時事の断定・医療/法律の助言を避ける。
- choice は選択肢 4 つ、正解は 1 つだけ、他は明確に誤り。short は表記ゆれを含む正解候補を複数。free は rubric を広めに。
- hints は 3 段。1 段目は問い返し、3 段目でも答えの値・完成文を書かない。
- domain が CODE（表示名 LOGIC）なら、Python の短いコード（出力予測・バグ発見）か、手順・条件・推論のパズルのどちらか。依頼に沿って選ぶ。
- recent_titles と重ならない題材にする。
- research（検索結果の要約）が渡された場合は、その内容を passage の題材にしてよい。出典 URL があれば passage の末尾に「出典: URL」を 1 行添える。無ければ使わない。
{PERSONA_RULE}

{JSON_ONLY}
キーは次の 13 個（すべて必須。該当しない項目は空配列・空文字・-1・0）:
{{"title": "string", "passage": "string", "prompt": "string", "choices": ["string"], "answer_index": 0, "short_answers": ["string"], "rubric_must_include": ["string"], "rubric_criteria": ["string"], "rubric_min_length": 0, "rubric_max_length": 0, "hints": ["string", "string", "string"], "explanation": "string", "skill_tags": ["string"]}}

制約:
- title は「種類: 題材」の形で 20 字以内。explanation は 120 字以内（答えを含んでよい）。
- kind=choice: choices は 4 件、answer_index は 0〜3。short_answers / rubric_* は空。
- kind=short: short_answers に正解候補を複数。choices は空、answer_index は -1。
- kind=free: rubric_must_include（8〜12 語）・rubric_criteria（2〜3 件）・rubric_min_length・rubric_max_length を埋める。choices は空、answer_index は -1。
- skill_tags は allowed_skill_tags の中から 1〜2 個。"""

USER_GENERATE_PLAIN = """## request
{{#start.request#}}

## domain
{{#start.domain#}}

## kind
{{#start.kind#}}

## difficulty
{{#start.difficulty#}}

## allowed_skill_tags
{{#start.allowed_skill_tags#}}

## recent_titles
{{#start.recent_titles#}}

## persona（JSON。空なら既定の口調）
{{#start.persona#}}

上記を踏まえ、指定の JSON だけを出力してください。"""

USER_GENERATE_SEARCH = USER_GENERATE_PLAIN.replace(
    "上記を踏まえ、指定の JSON だけを出力してください。",
    "## research（Web 検索の要約。題材に使ってよい）\n{{#parse_search.research#}}\n\n上記を踏まえ、指定の JSON だけを出力してください。",
)

# ---- generate 用 code ノード（Dify の Python サンドボックスで動く。標準ライブラリのみ） ----
CODE_BUILD_SEARCH = f'''import json

def main(request: str, domain: str) -> dict:
    """OpenAI Responses API + web_search で、依頼に合う一般向けの最近の話題を集めるリクエスト本文を組み立てる。"""
    q = (request or "").strip()[:200]
    ask = (
        "次の依頼に合う、最近の一般向けニュース・話題を日本語で 3 件、各 2 文で要約してください。"
        "各件の末尾に出典 URL を 1 つ付けてください。医療・法律・宗教・個人に関する内容、"
        "未確認の噂は避け、学習教材の題材として使える事実だけにしてください。"
        f"\\n依頼: {{q}}\\n領域: {{domain}}"
    )
    body = {{
        "model": "{MODEL_NAME}",
        "tools": [{{"type": "web_search"}}],
        "input": ask,
    }}
    return {{"body": json.dumps(body, ensure_ascii=False)}}
'''

CODE_PARSE_SEARCH = '''import json

def main(body: str, status_code: int) -> dict:
    """Responses API の応答から本文と引用 URL を取り出し、作問 LLM に渡す research 文字列にする。"""
    try:
        data = json.loads(body) if isinstance(body, str) else (body or {})
    except Exception:
        return {"research": ""}
    try:
        if int(status_code) != 200:
            return {"research": ""}
    except Exception:
        return {"research": ""}
    texts = []
    urls = []
    for item in data.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for c in item.get("content", []) or []:
            if c.get("type") == "output_text":
                texts.append(c.get("text", "") or "")
                for a in c.get("annotations", []) or []:
                    if a.get("type") == "url_citation" and a.get("url"):
                        urls.append(a["url"])
    research = "\\n".join(t for t in texts if t).strip()
    if urls:
        uniq = list(dict.fromkeys(urls))[:3]
        research = research + "\\n出典: " + " ".join(uniq)
    return {"research": research[:6000]}
'''


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


def time_node(node_id: str, x: int, y: int) -> dict[str, Any]:
    """Dify 組み込みの time ツール（current_time）。出力は {{#<id>.text#}}。"""
    data = {
        "title": "現在日時（Asia/Tokyo）",
        "type": "tool",
        "selected": False,
        "provider_id": "time",
        "provider_name": "time",
        "provider_type": "builtin",
        "plugin_id": None,
        "plugin_unique_identifier": "",
        "tool_name": "current_time",
        "tool_label": "Current Time",
        "is_team_authorization": True,
        "tool_configurations": {
            "format": {"type": "mixed", "value": "%Y-%m-%d %H:%M:%S (%A)"},
            "timezone": {"type": "constant", "value": "Asia/Tokyo"},
        },
        "tool_parameters": {},
        "params": {"format": "", "timezone": ""},
        "paramSchemas": [
            {
                "name": "format",
                "type": "string",
                "form": "form",
                "required": False,
                "default": "%Y-%m-%d %H:%M:%S",
                "label": {"en_US": "Format", "ja_JP": "Format"},
                "human_description": {"en_US": "Time format in strftime standard.", "ja_JP": "strftime 形式"},
                "llm_description": None,
                "options": [],
                "min": None,
                "max": None,
                "precision": None,
                "placeholder": None,
                "scope": None,
                "template": None,
                "auto_generate": None,
            },
            {
                "name": "timezone",
                "type": "string",
                "form": "form",
                "required": False,
                "default": "UTC",
                "label": {"en_US": "Timezone", "ja_JP": "Timezone"},
                "human_description": {"en_US": "Timezone", "ja_JP": "タイムゾーン"},
                "llm_description": None,
                "options": [],
                "min": None,
                "max": None,
                "precision": None,
                "placeholder": None,
                "scope": None,
                "template": None,
                "auto_generate": None,
            },
        ],
    }
    return node(node_id, "tool", data, x=x, y=y, w=244, h=90)


def code_node(node_id: str, title: str, desc: str, code: str, variables: list[tuple[str, list[str]]], outputs: dict[str, str], x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "code",
        "desc": desc,
        "selected": False,
        "code_language": "python3",
        "code": code,
        "variables": [{"variable": name, "value_selector": sel} for name, sel in variables],
        "outputs": {name: {"type": typ, "children": None} for name, typ in outputs.items()},
    }
    return node(node_id, "code", data, x=x, y=y, w=244, h=90)


def http_node(node_id: str, title: str, url: str, body_ref: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "http-request",
        "desc": "OpenAI Responses API を web_search ツール付きで呼ぶ。API キーは環境変数 OPENAI_API_KEY（secret）",
        "selected": False,
        "method": "post",
        "url": url,
        "authorization": {"type": "no-auth", "config": None},
        "headers": "Authorization: Bearer {{#env.OPENAI_API_KEY#}}\nContent-Type: application/json",
        "params": "",
        "body": {"type": "json", "data": [{"id": f"{node_id}-body", "key": "", "type": "text", "value": body_ref}]},
        "variables": [],
        "ssl_verify": True,
        "timeout": {"connect": 10, "read": 90, "write": 30, "max_connect_timeout": 300, "max_read_timeout": 600, "max_write_timeout": 600},
        "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
    }
    return node(node_id, "http-request", data, x=x, y=y, w=244, h=90)


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


def app_shell(
    name: str,
    description: str,
    icon: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    env_vars: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
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
                "value": {"marketplace_plugin_unique_identifier": OPENAI_PLUGIN, "version": None},
            }
        ],
        "workflow": {
            "conversation_variables": [],
            "environment_variables": env_vars or [],
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


OPENAI_ENV_VAR = {
    "id": "trivium-env-openai-api-key",
    "name": "OPENAI_API_KEY",
    "value": "sk-REPLACE_ME",
    "value_type": "secret",
    "selector": ["env", "OPENAI_API_KEY"],
    "description": "Web 検索（OpenAI Responses API）用。インポート後に実際のキーへ差し替えること",
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
        "Trivium: READ/WRITE/LOGIC の回答評価（一段ヒント）と domain 寸評。workflow=domain|interpret で分岐。出力は result（JSON 文字列）。",
        "📐",
        nodes,
        edges,
    )


def build_leader() -> dict[str, Any]:
    start = start_node("start", LEADER_VARS, y=200)
    now = time_node("now", x=420, y=200)
    llm = llm_node("llm_leader", "総合寸評（leader）", SYSTEM_LEADER, USER_LEADER, x=760, y=200)
    ends = end_node("end", ["llm_leader"], x=1100, y=200)
    nodes = [start, now, llm, *ends]
    edges = [
        edge("start", "now", "start", "tool"),
        edge("now", "llm_leader", "tool", "llm"),
        edge("llm_leader", ends[0]["id"], "llm", "end"),
    ]
    return app_shell(
        "trivium-leader",
        "Trivium: 3 domain の要約と現在日時から総合寸評と次のおすすめを出す LEADER。出力は result（JSON 文字列）。",
        "🧭",
        nodes,
        edges,
    )


def build_generate() -> dict[str, Any]:
    start = start_node("start", GENERATE_VARS, y=260)
    branch = ifelse_node("branch", "use_search で分岐", ["start", "use_search"], "true", x=420, y=320)
    build = code_node(
        "build_search",
        "検索リクエスト組立",
        "依頼文から OpenAI Responses API（web_search）の本文を作る",
        CODE_BUILD_SEARCH,
        [("request", ["start", "request"]), ("domain", ["start", "domain"])],
        {"body": "string"},
        x=760,
        y=120,
    )
    http = http_node("search", "Web 検索（OpenAI Responses）", "https://api.openai.com/v1/responses", "{{#build_search.body#}}", x=1100, y=120)
    parse = code_node(
        "parse_search",
        "検索結果の要約抽出",
        "output_text と url_citation を research 文字列にまとめる（失敗時は空）",
        CODE_PARSE_SEARCH,
        [("body", ["search", "body"]), ("status_code", ["search", "status_code"])],
        {"research": "string"},
        x=1440,
        y=120,
    )
    llm_search = llm_node("llm_generate_search", "作問（検索あり）", SYSTEM_GENERATE, USER_GENERATE_SEARCH, x=1780, y=120)
    llm_plain = llm_node("llm_generate", "作問", SYSTEM_GENERATE, USER_GENERATE_PLAIN, x=760, y=520)
    ends = end_node("end", ["llm_generate_search", "llm_generate"], x=2120, y=120)
    nodes = [start, branch, build, http, parse, llm_search, llm_plain, *ends]
    edges = [
        edge("start", "branch", "start", "if-else"),
        edge("branch", "build_search", "if-else", "code", source_handle="true"),
        edge("build_search", "search", "code", "http-request"),
        edge("search", "parse_search", "http-request", "code"),
        edge("parse_search", "llm_generate_search", "code", "llm"),
        edge("llm_generate_search", ends[0]["id"], "llm", "end"),
        edge("branch", "llm_generate", "if-else", "llm", source_handle="false"),
        edge("llm_generate", ends[1]["id"], "llm", "end"),
    ]
    return app_shell(
        "trivium-generate",
        "Trivium: 依頼文から READ/WRITE/LOGIC の課題を 1 問作る。use_search=true なら Web 検索（OpenAI web_search）で題材を集める。出力は result（JSON 文字列）。",
        "✏️",
        nodes,
        edges,
        env_vars=[OPENAI_ENV_VAR],
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
    write(os.path.join(HERE, "trivium-generate.yml"), build_generate())
    print("wrote dify/trivium-domain.yml, dify/trivium-leader.yml, dify/trivium-generate.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
