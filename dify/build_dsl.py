# -*- coding: utf-8 -*-
"""Trivium 用 Dify DSL の生成スクリプト（OpenAI 版・Workflow 3 本 + Chatflow 1 本）。

  python dify/build_dsl.py     # trivium-domain / trivium-leader / trivium-generate / trivium-chat を書き出す

DSL を手で編集すると差分が追いにくいので、プロンプトや変数はここに集約し、
YAML はこのスクリプトから生成する。生成後は dify/validate.py で
src/lib/ai/dify.ts の inputs / 出力キーと整合しているか検査する。

構成:
  trivium-domain   Start → IF/ELSE(workflow==domain) → LLM(回答評価) / LLM(寸評生成) → End(result)
  trivium-leader   Start → 現在日時(組み込み time ツール, Asia/Tokyo) → LLM(総合寸評) → End(result)
  trivium-generate Start → IF/ELSE(use_search=="true")
                     ├ true : code(検索リクエスト組立) → HTTP(OpenAI Responses + web_search) → code(要約抽出) → LLM(作問) → End
                     └ false: LLM(作問) → End
  trivium-chat     Chatflow（advanced-chat）。4 人格（ヨミ/フミ/ロゴス/ミチ）と教材おすすめを 1 本で扱う。
                   Start → HTTP(/api/agent/context) → code(文脈整形) → IF/ELSE(名前で呼ばれた？)
                     ├ true : assigner(担当を固定) ─────────────────┐
                     └ false: question-classifier ─ READ/WRITE/LOGIC/その他 → assigner ┤→ LLM(4 人格) → Answer
                                                    └ 教材 → knowledge-retrieval → LLM(ミチ) → Answer
                   会話履歴は 1 つの conversation で共有されるので、担当をまたいでも文脈が続く。
LLM はすべて OpenAI（langgenius/openai/openai）。Web 検索も OpenAI Responses API の web_search ツールを HTTP ノードから呼ぶ。
"""
from __future__ import annotations

import os
import sys
from typing import Any

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- LLM の既定設定（インポート後に Dify 側で差し替え可能） ----
MODEL_NAME = "gpt-5.6-luna"  # Dify のモデル一覧にあるもの。実測レイテンシが最も速い（意図判定 1.3s / 評価 2.5s）
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


def ifelse_node(
    node_id: str,
    title: str,
    variable_selector: list[str],
    value: str,
    x: int,
    y: int,
    operator: str = "is",
    desc: str | None = None,
) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "if-else",
        "desc": desc if desc is not None else f"{'.'.join(variable_selector)} が {value} なら true 側",
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
                        "comparison_operator": operator,
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
    mode: str = "workflow",
    conversation_vars: list[dict[str, Any]] | None = None,
    opening_statement: str = "",
    suggested_questions: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "version": "0.6.0",
        "kind": "app",
        "app": {
            "name": name,
            "description": description,
            "mode": mode,
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
            "conversation_variables": conversation_vars or [],
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
                "opening_statement": opening_statement,
                "retriever_resource": {"enabled": mode == "advanced-chat"},
                "sensitive_word_avoidance": {"enabled": False},
                "speech_to_text": {"enabled": False},
                "suggested_questions": suggested_questions or [],
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


# =====================================================================
# trivium-chat（Chatflow）: 4 人格 + 教材おすすめ
# =====================================================================

CHAT_VARS: list[tuple[str, str, str, bool]] = [
    ("learner_ref", "学習者の識別子（Trivium の userId。/api/agent/context の ref に渡す）", "text-input", True),
    ("addressed_agent", "名前で呼ばれた担当（READ / WRITE / CODE / LEADER / AUTO。空か AUTO なら自動判定）", "text-input", False),
    ("app_url", "Trivium の公開 URL（案内に使う。無くてもよい）", "text-input", False),
]

CHAT_ENV_VARS = [
    {
        "id": "trivium-env-api-base",
        "name": "TRIVIUM_API_BASE",
        "value": "https://trivium.example.com",
        "value_type": "string",
        "selector": ["env", "TRIVIUM_API_BASE"],
        "description": "Trivium アプリの公開 URL。/api/agent/context を呼ぶ。インポート後に実際の URL へ差し替える",
    },
    {
        "id": "trivium-env-agent-token",
        "name": "TRIVIUM_AGENT_TOKEN",
        "value": "REPLACE_ME",
        "value_type": "secret",
        "selector": ["env", "TRIVIUM_AGENT_TOKEN"],
        "description": "アプリ側の AGENT_API_TOKEN と同じ値。/api/agent/context の Bearer トークン",
    },
]

CHAT_CONVERSATION_VARS = [
    {
        "id": "trivium-conv-last-agent",
        "name": "last_agent",
        "value_type": "string",
        "value": "",
        "description": "いま話す担当（READ / WRITE / CODE / LEADER）。会話に残るので、担当をまたいでも文脈が続く",
        "selector": ["conversation", "last_agent"],
    }
]

# code ノード（Dify の Python サンドボックス。標準ライブラリのみ・raw 文字列で生成する）
CODE_CHAT_CONTEXT = r'''import json

AGENTS = ["READ", "WRITE", "CODE", "LEADER"]
LABEL = {"READ": "READ", "WRITE": "WRITE", "CODE": "LOGIC", "LEADER": "ADVISOR"}
UNKNOWN = "(取得できず)"
POLICY_FALLBACK = [
    "学習者の課題を代わりに完成させない（答え・完成コード・完成文を渡さない）。",
    "ヒントは一度に一段だけ。",
    "答えより問い返しを優先する。",
    "直前までの学習者の反応に合わせる。",
    "学習記録で裏づけられない資質の断定をしない。",
    "評するのは学習行動であって人格ではない。",
    "根拠が足りないときは、足りないと明言する。",
]


def _persona_line(key, p):
    p = p or {}
    name = p.get("name") or ""
    if not name:
        return LABEL[key] + " 担当: " + UNKNOWN
    line = "{0} 担当 {1}（一人称「{2}」／口調: {3}）".format(
        LABEL[key], name, p.get("firstPerson") or "私", p.get("toneDescription") or p.get("tone") or "ふつう"
    )
    extra = p.get("extra") or ""
    return line + " " + extra if extra else line


def main(body: str, addressed_agent: str) -> dict:
    """/api/agent/context の応答をプロンプト用の文字列に整える。取得できなくても例外を投げない。"""
    try:
        data = json.loads(body) if isinstance(body, str) else (body or {})
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}

    # 担当: アプリが名前呼びかけを検出したときだけ固定する（空なら質問分類に任せる）
    want = (addressed_agent or "").strip().upper()
    if want == "LOGIC":
        want = "CODE"
    if want == "ADVISOR":
        want = "LEADER"
    agent = want if want in AGENTS else ""

    personas = data.get("personas") or {}
    one = {}
    for key in AGENTS:
        one[key] = _persona_line(key, personas.get(key))
    personas_text = "\n".join("- " + one[k] for k in AGENTS)

    # 能力（集計値のみ。ここで数値を作り直さない）
    prof = data.get("profile") or {}
    rows = []
    for key in ["READ", "WRITE", "CODE"]:
        d = prof.get(key) or {}
        ev = d.get("evidenceCount") or 0
        if not ev:
            rows.append(LABEL[key] + " 未計測")
            continue
        row = "{0} Lv{1}（{2} / 根拠{3}件".format(LABEL[key], d.get("level", 0), d.get("score", 0), ev)
        weak = d.get("weakestSubskillLabel") or d.get("weakestSubskill") or ""
        if weak:
            row = row + "・弱点: " + str(weak)
        rows.append(row + "）")
    profile_text = " / ".join(rows) if rows else UNKNOWN
    tail = []
    xp = data.get("xp") or {}
    if xp.get("total") is not None:
        tail.append("XP {0}（{1}）".format(xp.get("total"), xp.get("rank") or ""))
    if xp.get("streak"):
        tail.append("連続 {0} 日".format(xp.get("streak")))
    rec = data.get("recommendedDomain")
    if rec:
        tail.append("次のおすすめ: {0} 難易度 {1}".format(LABEL.get(rec, rec), data.get("recommendedDifficulty") or "-"))
    if tail:
        profile_text = profile_text + "\n" + " / ".join(tail)

    # 直近の文脈（決着した課題 → 他の担当とのやり取り）
    ctx = []
    for e in (data.get("recentEvents") or [])[:3]:
        if not ctx:
            ctx.append("直近に決着した課題:")
        ctx.append("- {0}「{1}」（難易度 {2}）: {3}（ヒント {4} 回）".format(
            LABEL.get(e.get("domain"), e.get("domain") or "?"),
            e.get("title") or e.get("taskId") or "?",
            e.get("difficulty") or "-",
            "正解" if e.get("success") else "未達",
            e.get("hintCount") or 0,
        ))
    chat = data.get("recentChat") or []
    if chat:
        ctx.append("直近の会話（担当をまたいで共有）:")
        for c in chat[-6:]:
            if c.get("role") == "user":
                who = "learner"
            else:
                who = (personas.get(c.get("agent")) or {}).get("name") or LABEL.get(c.get("agent"), "AI")
            ctx.append("- {0}: {1}".format(who, str(c.get("text") or "")[:160]))
    context_text = "\n".join(ctx) if ctx else "(まだ記録が無い)"

    # 出題中の課題（答えは含まれない）
    t = data.get("currentTask")
    if isinstance(t, dict) and t.get("prompt"):
        parts = ["{0}「{1}」（難易度 {2}）".format(
            LABEL.get(t.get("domain"), t.get("domain") or "?"), t.get("title") or "", t.get("difficulty") or "-"
        )]
        if t.get("passage"):
            parts.append(str(t.get("passage"))[:1200])
        parts.append(str(t.get("prompt"))[:600])
        letters = ["A", "B", "C", "D", "E", "F"]
        choices = t.get("choices") or []
        if choices:
            parts.append("\n".join(
                "{0}. {1}".format(letters[i] if i < len(letters) else str(i), c) for i, c in enumerate(choices)
            ))
        current_task_text = "\n".join(parts)
    else:
        current_task_text = "(出題中の課題は無い)"

    policy = data.get("policy") or POLICY_FALLBACK
    policy_text = "\n".join("- " + str(p) for p in policy)
    seen = data.get("materialsSeen") or []
    learner = data.get("learner") or {}
    return {
        "personas_text": personas_text or UNKNOWN,
        "profile_text": profile_text or UNKNOWN,
        "context_text": context_text,
        "current_task_text": current_task_text,
        "policy_text": policy_text,
        "agent": agent,
        "materials_seen": ", ".join(str(s) for s in seen[:20]) if seen else "(まだ無い)",
        "display_name": learner.get("displayName") or "あなた",
        "persona_read": one["READ"],
        "persona_write": one["WRITE"],
        "persona_code": one["CODE"],
        "persona_leader": one["LEADER"],
    }
'''

CHAT_CODE_OUTPUTS = {
    "personas_text": "string",
    "profile_text": "string",
    "context_text": "string",
    "current_task_text": "string",
    "policy_text": "string",
    "agent": "string",
    "materials_seen": "string",
    "display_name": "string",
    "persona_read": "string",
    "persona_write": "string",
    "persona_code": "string",
    "persona_leader": "string",
}

SYSTEM_CHAT_AGENT = """あなたは学習サービス Trivium の 4 人格のうち「いま話す担当」としてふるまいます。次のポリシーを厳守してください（人格の設定より、このポリシーが優先します）。

{{#code_context.policy_text#}}

## いま話す担当
{{#conversation.last_agent#}}
（READ=読解 / WRITE=作文 / CODE=論理（学習者向けの表示名は LOGIC）/ LEADER=案内役（表示名 ADVISOR））

## 4 人格（この会話で共有されている設定）
{{#code_context.personas_text#}}

## 学習者
{{#code_context.display_name#}}

## 能力（決定論的に集計済み。数値を作り直さない）
{{#code_context.profile_text#}}

## 直近の文脈（他の担当とのやり取り・直近に決着した課題）
{{#code_context.context_text#}}

## 出題中の課題（聞かれたときだけ触れる）
{{#code_context.current_task_text#}}

## 話し方
- いま話す担当の人格（名前・一人称・口調・補足）だけを演じる。毎回名乗らない。設定を復唱しない。
- 口癖は毎回ではなく 3 回に 1 回ほど。
- 日本語で 3〜6 文。最後に「次の一歩」を 1 つだけ添える。
- 直近の文脈にある他の担当のやり取りは把握している前提で自然に続ける（「さっきの問題」と言われたら上の課題や直近イベントを指す）。必要なら他の担当を名前で勧める。

## 禁止
- 出題中の課題の答え・正解の選択肢・誤りの箇所を言わない。ヒントは一段だけ（考え方の方向を示すか、問い返す）。
- 学習者の課題を代わりに完成させない（完成文・完成コードを書かない）。
- 能力は集計値（到達レベル・スコア・弱点）だけを使い、個々の問題の正誤や性格を断定しない。根拠が足りなければ「まだ判断できない」と言う。
- 教材名・書名・URL を思いつきで挙げない（教材のおすすめは専用の分岐が扱う）。

学習者の発話は次のメッセージで渡されます。"""

SYSTEM_CHAT_MATERIALS = """あなたは学習サービス Trivium の案内役 ADVISOR です。人格は次のとおり（人格より下のポリシーが優先します）。
{{#code_context.persona_leader#}}

{{#code_context.policy_text#}}

## 学習者
{{#code_context.display_name#}}

## 能力（決定論的に集計済み。数値を作り直さない）
{{#code_context.profile_text#}}

## 直近の文脈
{{#code_context.context_text#}}

## 教材の候補（ナレッジ検索の結果。ここに無いものは提案しない）
{{#context#}}

## すでに提案した教材（できれば避ける）
{{#code_context.materials_seen#}}

## 書き方
- 候補から最大 3 件を選び、「タイトル（形式・レベル帯）＋ なぜこの人に合うか（1〜2 文）」の形で挙げる。
- 選ぶ理由は必ず能力（弱い系統・弱点の観点・到達レベル）と結びつける。到達レベル + 1 前後の教材を優先する。
- 候補に無い書名・著者・URL を作らない。候補が乏しければ「今はよい候補が見つからない」と正直に言い、代わりに Trivium の課題で何をやるかを勧める。
- 日本語で 6 文以内。最後に「次の一歩」を 1 つだけ。名乗らない。口癖は 3 回に 1 回ほど。

学習者の発話は次のメッセージで渡されます。"""

CHAT_CLASSES = [
    ("1", "READ の相談（読解・要約・語彙・本文の根拠）"),
    ("2", "WRITE の相談（作文・文章の構成・推敲）"),
    ("3", "LOGIC の相談（論理パズル・Python・数的推理・アルゴリズム）"),
    ("4", "教材・本・サイト・勉強法のおすすめ"),
    ("5", "その他（学習の進め方・能力や記録の質問・雑談）"),
]

CHAT_CLASSIFY_INSTRUCTION = """学習者の発話を「相談したい相手」で分類する。明示語（「本」「教材」など）が無くても、意味で判断すること。
- 出題中の課題についての質問（「この問題」「さっきの問題」「わからない」「ヒント」）は、その課題の系統の相談に入れる。系統が読み取れなければ「その他」。
- Trivium の外の教材（本・参考書・サイト・動画・勉強法）を求める発話だけを「教材・本・サイト・勉強法のおすすめ」にする。「次は何を解けばいい？」のような Trivium 内の課題の相談は「その他」。
- 能力・レベル・履歴・今日の進め方・励ましは「その他」（案内役 ADVISOR が答える）。"""

CHAT_OPENING = "こんにちは。Trivium の案内役、ミチよ。読解（ヨミ）・作文（フミ）・論理（ロゴス）の担当にも、名前で呼べば代わるわ。何から話す？"

CHAT_SUGGESTED = ["今の私の能力は？", "読解を伸ばす本を教えて", "さっきの問題のヒントがほしい"]


def http_get_node(node_id: str, title: str, desc: str, url: str, headers: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "http-request",
        "desc": desc,
        "selected": False,
        "method": "get",
        "url": url,
        "authorization": {"type": "no-auth", "config": None},
        "headers": headers,
        "params": "",
        "body": {"type": "none", "data": []},
        "variables": [],
        "ssl_verify": True,
        "timeout": {"connect": 10, "read": 10, "write": 10, "max_connect_timeout": 300, "max_read_timeout": 600, "max_write_timeout": 600},
        # チャットの応答が止まらないよう、失敗しても 1 回だけ再試行してすぐ諦める（code 側で欠損を吸収する）
        "retry_config": {"retry_enabled": True, "max_retries": 1, "retry_interval": 500},
    }
    return node(node_id, "http-request", data, x=x, y=y, w=244, h=90)


def chat_llm_node(node_id: str, title: str, system: str, x: int, y: int, context_selector: list[str] | None = None) -> dict[str, Any]:
    """Chatflow の LLM ノード。発話と履歴は memory 経由で渡す（system に文脈を積む）。"""
    data = {
        "title": title,
        "type": "llm",
        "selected": False,
        "model": dict(MODEL),
        "prompt_template": [{"id": f"{node_id}-system", "role": "system", "text": system}],
        "context": {"enabled": bool(context_selector), "variable_selector": context_selector or []},
        "memory": {
            "role_prefix": {"user": "", "assistant": ""},
            "window": {"enabled": True, "size": 12},
            "query_prompt_template": "{{#sys.query#}}",
        },
        "vision": {"enabled": False},
    }
    return node(node_id, "llm", data, x=x, y=y, w=244, h=98)


def answer_node(node_id: str, title: str, answer: str, x: int, y: int) -> dict[str, Any]:
    data = {"title": title, "type": "answer", "selected": False, "answer": answer, "variables": []}
    return node(node_id, "answer", data, x=x, y=y, w=244, h=104)


def assigner_node(node_id: str, title: str, *, constant: str | None = None, variable: list[str] | None = None, x: int, y: int) -> dict[str, Any]:
    """会話変数 last_agent に「いま話す担当」を書く（Chatflow の変数代入ノード v2）。"""
    item: dict[str, Any] = {
        "variable_selector": ["conversation", "last_agent"],
        "input_type": "variable" if variable else "constant",
        "operation": "over-write",
        "value": variable if variable else constant,
    }
    data = {"title": title, "type": "assigner", "version": "2", "selected": False, "items": [item]}
    return node(node_id, "assigner", data, x=x, y=y, w=244, h=88)


def classifier_node(node_id: str, title: str, classes: list[tuple[str, str]], instruction: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "question-classifier",
        "desc": "明示語ではなく意味で相談先を決める",
        "selected": False,
        "query_variable_selector": ["sys", "query"],
        "model": dict(MODEL),
        "classes": [{"id": cid, "name": name} for cid, name in classes],
        "instruction": instruction,
        "instructions": "",
        "memory": {
            "role_prefix": {"user": "", "assistant": ""},
            "window": {"enabled": True, "size": 6},
            "query_prompt_template": "{{#sys.query#}}",
        },
        "vision": {"enabled": False},
        "topics": [],
    }
    return node(node_id, "question-classifier", data, x=x, y=y, w=244, h=80 + 24 * len(classes))


def knowledge_node(node_id: str, title: str, x: int, y: int) -> dict[str, Any]:
    data = {
        "title": title,
        "type": "knowledge-retrieval",
        "desc": "教材ナレッジ（trivium-materials）。インポート後に Dify の UI でナレッジを選ぶ",
        "selected": False,
        "query_variable_selector": ["sys", "query"],
        "dataset_ids": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 5,
            "score_threshold": None,
            "score_threshold_enabled": False,
            "reranking_enable": False,
            "reranking_mode": "weighted_score",
            "reranking_model": {"provider": "", "model": ""},
            "weights": {
                "weight_type": "customized",
                "vector_setting": {"vector_weight": 0.7, "embedding_provider_name": "", "embedding_model_name": ""},
                "keyword_setting": {"keyword_weight": 0.3},
            },
        },
        "single_retrieval_config": {"model": dict(MODEL)},
    }
    return node(node_id, "knowledge-retrieval", data, x=x, y=y, w=244, h=98)


def build_chat() -> dict[str, Any]:
    start = start_node("start", CHAT_VARS, y=340)
    http = http_get_node(
        "http_context",
        "学習者の文脈を取得",
        "Trivium の /api/agent/context から人格・能力値・直近の文脈・出題中の課題を取る",
        "{{#env.TRIVIUM_API_BASE#}}/api/agent/context?ref={{#start.learner_ref#}}",
        "Authorization: Bearer {{#env.TRIVIUM_AGENT_TOKEN#}}\nAccept: application/json",
        x=400,
        y=340,
    )
    code = code_node(
        "code_context",
        "文脈の整形",
        "API 応答をプロンプト用の文字列にする（取得できなくても落ちない）",
        CODE_CHAT_CONTEXT,
        [("body", ["http_context", "body"]), ("addressed_agent", ["start", "addressed_agent"])],
        CHAT_CODE_OUTPUTS,
        x=700,
        y=340,
    )
    branch = ifelse_node(
        "if_addressed",
        "名前で呼ばれた？",
        ["code_context", "agent"],
        "",
        x=1000,
        y=340,
        operator="not empty",
        desc="code_context.agent が空でなければ、その担当に固定（true 側）",
    )
    classifier = classifier_node("classifier", "相談先の判定", CHAT_CLASSES, CHAT_CLASSIFY_INSTRUCTION, x=1300, y=440)
    assign_direct = assigner_node("assign_direct", "担当を固定（呼ばれた人）", variable=["code_context", "agent"], x=1300, y=180)
    assign_read = assigner_node("assign_read", "担当 = READ", constant="READ", x=1620, y=300)
    assign_write = assigner_node("assign_write", "担当 = WRITE", constant="WRITE", x=1620, y=400)
    assign_code = assigner_node("assign_code", "担当 = CODE", constant="CODE", x=1620, y=500)
    assign_leader = assigner_node("assign_leader", "担当 = LEADER", constant="LEADER", x=1620, y=600)
    knowledge = knowledge_node("knowledge", "教材ナレッジ検索", x=1620, y=760)
    llm_agent = chat_llm_node("llm_agent", "4 人格の応答", SYSTEM_CHAT_AGENT, x=1940, y=380)
    llm_materials = chat_llm_node("llm_materials", "教材のおすすめ（ADVISOR）", SYSTEM_CHAT_MATERIALS, x=1940, y=760, context_selector=["knowledge", "result"])
    answer_agent = answer_node("answer_agent", "返答", "{{#llm_agent.text#}}", x=2260, y=380)
    answer_materials = answer_node("answer_materials", "返答（教材）", "{{#llm_materials.text#}}", x=2260, y=760)

    nodes = [
        start, http, code, branch, classifier,
        assign_direct, assign_read, assign_write, assign_code, assign_leader,
        knowledge, llm_agent, llm_materials, answer_agent, answer_materials,
    ]
    edges = [
        edge("start", "http_context", "start", "http-request"),
        edge("http_context", "code_context", "http-request", "code"),
        edge("code_context", "if_addressed", "code", "if-else"),
        edge("if_addressed", "assign_direct", "if-else", "assigner", source_handle="true"),
        edge("if_addressed", "classifier", "if-else", "question-classifier", source_handle="false"),
        edge("classifier", "assign_read", "question-classifier", "assigner", source_handle="1"),
        edge("classifier", "assign_write", "question-classifier", "assigner", source_handle="2"),
        edge("classifier", "assign_code", "question-classifier", "assigner", source_handle="3"),
        edge("classifier", "knowledge", "question-classifier", "knowledge-retrieval", source_handle="4"),
        edge("classifier", "assign_leader", "question-classifier", "assigner", source_handle="5"),
        edge("assign_direct", "llm_agent", "assigner", "llm"),
        edge("assign_read", "llm_agent", "assigner", "llm"),
        edge("assign_write", "llm_agent", "assigner", "llm"),
        edge("assign_code", "llm_agent", "assigner", "llm"),
        edge("assign_leader", "llm_agent", "assigner", "llm"),
        edge("llm_agent", "answer_agent", "llm", "answer"),
        edge("knowledge", "llm_materials", "knowledge-retrieval", "llm"),
        edge("llm_materials", "answer_materials", "llm", "answer"),
    ]
    return app_shell(
        "trivium-chat",
        "Trivium: 4 人格（ヨミ/フミ/ロゴス/ミチ）と教材おすすめを 1 本で扱う Chatflow。能力値は /api/agent/context から取得し、会話履歴は担当をまたいで共有する。",
        "🔺",
        nodes,
        edges,
        env_vars=CHAT_ENV_VARS,
        mode="advanced-chat",
        conversation_vars=CHAT_CONVERSATION_VARS,
        opening_statement=CHAT_OPENING,
        suggested_questions=CHAT_SUGGESTED,
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
    write(os.path.join(HERE, "trivium-chat.yml"), build_chat())
    print("wrote dify/trivium-domain.yml, dify/trivium-leader.yml, dify/trivium-generate.yml, dify/trivium-chat.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
