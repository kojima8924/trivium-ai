# dify/ — Dify DSL（OpenAI 版・Workflow 3 本 + Chatflow 1 本）

Trivium の AI レイヤーを Dify で動かすためのアプリ定義（DSL）。
Dify Cloud / self-hosted の **Studio → Import DSL file** でそのまま取り込めます。LLM はすべて **OpenAI**（`langgenius/openai/openai`、既定モデル `gpt-5.6-luna`、作問ノードは `gpt-5.6-sol`。アプリ側の直接呼び出しは `src/config/trivium.config.ts` の `MODELS` で役割ごとに決まる）。

| ファイル | アプリ名 | 種別 | 役割 | 対応する環境変数 |
|---|---|---|---|---|
| `trivium-domain.yml` | `trivium-domain` | Workflow | `workflow=domain`: 回答評価＋一段ヒント / `workflow=interpret`: domain 寸評（IF/ELSE で分岐） | `DIFY_DOMAIN_API_KEY` |
| `trivium-leader.yml` | `trivium-leader` | Workflow | 現在日時（組み込み `time` ツール、Asia/Tokyo）→ 3 domain の要約から総合寸評・次のおすすめ（ADVISOR） | `DIFY_LEADER_API_KEY` |
| `trivium-generate.yml` | `trivium-generate` | Workflow | 依頼文から課題を 1 問作る。`use_search=true` のときだけ **Web 検索**（OpenAI Responses API の `web_search` を HTTP ノードから呼ぶ）で題材を集めてから作問 | `DIFY_GENERATE_API_KEY` |
| `trivium-chat.yml` | `trivium-chat` | **Chatflow** | 4 人格（ヨミ / フミ / ロゴス / ミチ）の会話と**教材おすすめ**を 1 本で扱う。能力値は Trivium の API から取得し、会話履歴は担当をまたいで共有 | `TRIVIUM_API_BASE` / `TRIVIUM_AGENT_TOKEN`（Dify 側）・`DIFY_CHAT_API_KEY`（アプリ側） |

Workflow 3 本は **End ノードの出力変数が `result`**（LLM が返す JSON 文字列）。アプリ側の `src/lib/ai/dify.ts` が `result` を JSON として解釈し、zod schema で検証します（choice なのに 4 択でない等は例外 → Mock にフォールバック）。Chatflow は JSON ではなく**そのまま LINE / Web に出せる日本語のテキスト**を Answer ノードで返します。

## `trivium-chat`（4 人格 + 教材おすすめを 1 本に）

```
Start（learner_ref / addressed_agent / app_url）
  → HTTP GET /api/agent/context（人格・能力値・直近の文脈・出題中の課題）
  → code（プロンプト用の文字列に整形。API が落ちても既定値で続行）
  → IF/ELSE（名前で呼ばれた？ = code_context.agent が空でない）
      ├ true  → assigner（会話変数 last_agent ← その担当）───────────────┐
      └ false → question-classifier（意味で相談先を判定）                  │
                  ├ READ / WRITE / LOGIC / その他 → assigner（担当を決める）┤→ LLM（4 人格の応答）→ Answer
                  └ 教材・本・サイト → knowledge-retrieval（trivium-materials）
                        → code（リンク整備: 公式 URL / Amazon 検索 URL）
                        → LLM（ミチ・下書き。最終行に NEED_SEARCH: true|false）
                        → IF/ELSE（NEED_SEARCH: true を含む？）
                            ├ true  → code（検索リクエスト）→ HTTP（OpenAI Responses + web_search・ドメイン限定）
                            │          → code（本文と出典を抽出）→ LLM（仕上げ）→ Answer
                            └ false → code（NEED_SEARCH の行を削る）→ Answer
```

設計上のポイント:

- **文脈の共有** — 1 つの Chatflow＝1 つの conversation なので、担当が代わっても Dify の会話履歴（memory window 12）がそのまま引き継がれます。「さっきの問題」がヨミにもロゴスにも通じます
- **能力値へのアクセス** — 毎ターン `GET {{TRIVIUM_API_BASE}}/api/agent/context?ref=<userId>` を Bearer トークン付きで呼び、到達レベル・スコア・弱点・XP・直近イベント・出題中の課題・4 人格の設定・提案済み教材を取得します。数値は Trivium 側で決定論的に集計済みで、LLM は解釈しかしません
- **人格の反映** — 人格（名前・一人称・口調・補足）は API から来るので、`/settings` でユーザーが変えた設定がそのまま Dify 側にも効きます。DSL に人格を焼き込んでいません
- **教材おすすめはミチ（ADVISOR）の発言** — ナレッジ検索の候補だけから 3 件選び、理由を能力値に結びつけます。候補外の書名・URL を作らない制約を System に明記
- **担当の決め方** — アプリが名前呼びかけ（「ロゴス、〜」）を検出したら `addressed_agent` で固定。無ければ question-classifier が**明示語ではなく意味で**振り分けます
- API が落ちても code ノードが既定値（ポリシー 7 か条のコピー・「未計測」）を返すので、会話は止まりません
- **教材のリンク（検索なしでも付く）** — `code_links` がナレッジのチャンクから id / 形式 / 公式 URL / レベル帯を抜き、書籍には `https://www.amazon.co.jp/s?k=<タイトル>` の**検索 URL**を作ります。商品ページ（ASIN 付き URL）は実在しないものを作らないため生成しません
- **Web 検索は「必要なときだけ」** — 下書き LLM が最終行に `NEED_SEARCH: true|false` を出し、IF/ELSE がそれで分岐します。true になるのは (1) 価格・購入方法・入手方法・最新情報・在庫・具体的な URL を聞かれた (2) 挙げた書籍に公式 URL が無い (3) 候補が乏しい、のいずれか。false のときは `code_strip` が印の行を落としてそのまま返すので、余計な API 呼び出しもレイテンシも増えません
- **検索の安全弁** — 検索は OpenAI Responses API の `web_search` を `allowed_domains`（Amazon・honto・主要出版社・python.org / atcoder.jp / paiza.jp / nhk.or.jp / aozora.gr.jp）に限定し、`code_search_out` が本文と出典 URL だけを取り出します。非 200・パース失敗時は空文字を返し、仕上げ LLM が「検索できなかった」旨を添えて下書きだけで答えます（会話は止まりません）
- **リクエスト本文は code ノードが組み立てる** — 外部 API を叩く HTTP ノードの body は必ず code ノードの出力を参照します（プロンプトから直接 JSON を書かせない）。`validate.py` がこれを検査します

## 教材ナレッジ（`materials/`）

`materials/*.md` は `src/lib/materials/catalog.ts`（教材カタログ）から `scripts/dify/export_materials.mts` が書き出した Dify ナレッジ用の Markdown（1 教材 1 ファイル、生成物なので手で編集しない）。`scripts/dify/upload_materials.mts` が Dataset API で Dataset `trivium-materials` に投入する（手順は DEPLOY.md 5.6）。 無料プランはドキュメント数の上限と「1 ファイルずつ」の制約があるので、`--single`（`export_materials.mts --single` → `ALL.md` を 1 ドキュメントで投入。区切り線 `---` でチャンク分割）を使う。アプリ側は `DIFY_DATASET_API_KEY` / `DIFY_MATERIALS_DATASET_ID` があるときだけナレッジ検索を推薦スコアに加え、無ければカタログだけで動く。

## 生成と検証

DSL は手で編集せず、`build_dsl.py` から生成します（プロンプト・変数・ノード構成を 1 か所に集約するため）。

```bash
python dify/build_dsl.py     # 4 本を再生成
python dify/validate.py      # src/lib/ai/dify.ts との契約を検査（CI では実行しない。手動）
```

`validate.py` が Workflow 3 本について検査すること:

1. YAML としてパースできる
2. Start ノードの変数名が `dify.ts` の `run()` に渡す `inputs` のキーと**完全一致**（不足・余剰を検出）
3. End の出力変数が `result` で、実在する LLM ノードの `text` を指している
4. edges の source / target が実在ノードで、IF/ELSE の `sourceHandle` が cases の id か `false`。全ノードに入るエッジがある。edge の sourceType/targetType が実ノード種別と一致
5. プロンプト・HTTP・IF/ELSE・code ノードの `{{#node.var#}}` 参照が、Start の変数か実在ノードの出力に存在する
6. System プロンプトに出力 JSON のキー（zod schema と同じ）がすべて書かれている
7. LLM ノードのプロバイダが OpenAI で統一されている
8. HTTP ノードが `{{#env.XXX#}}` を参照するなら、その環境変数が `environment_variables` に宣言されている
9. code ノードの `main` 引数が `variables` と一致し、`outputs` が定義されている。`time` ツールのタイムゾーンが Asia/Tokyo

Chatflow（`trivium-chat.yml`）については別関数 `check_chat()` が検査します:

- `app.mode` が `advanced-chat` で End ノードが無い（Answer ノードで返す）
- Answer ノードが実在する LLM の `text` を参照している
- question-classifier の class id と、そこから出る edge の `sourceHandle` が 1 対 1
- `{{#env.X#}}` が `environment_variables` に、`{{#conversation.x#}}` が `conversation_variables` に、`{{#sys.x#}}` が既知の system 変数に宣言済み
- code ノードの `main` 引数が `variables` と一致し、Python として構文が通り、宣言した `outputs` をすべて返している
- HTTP ノードの URL が `{{#env.TRIVIUM_API_BASE#}}` を使い、Authorization が env のトークン（ハードコード禁止）
- LLM ノードがポリシー（`code_context.policy_text`）と会話メモリを使い、context 有効なら `{{#context#}}` がプロンプトにある
- knowledge-retrieval に `dataset_ids` が焼き込まれていない（環境ごとに違うため）

`dify.ts` の inputs や schema を変えたら、`build_dsl.py` を直して再生成し、`validate.py` を通してください。

## インポート後に必ず手で行うこと

1. **OpenAI プラグインとモデル** — ワークスペースに OpenAI プロバイダ（Marketplace の `langgenius/openai`）を入れて API キーを設定。各 LLM ノード（domain 2・leader 1・generate 2・chat 2＋分類 1）のモデルが選べる状態になっていることを確認（`gpt-5.6-luna` / `gpt-5.6-sol` が無ければ使えるモデルに差し替え）
2. **`trivium-generate` の環境変数** — アプリの環境変数 `OPENAI_API_KEY`（secret）を実際のキーに差し替える。Web 検索の HTTP ノードがこれを `Authorization: Bearer` に使う（LLM ノードのキーとは別管理）
3. **`trivium-leader` の time ツール** — 組み込みツール（`time` / `current_time`）なので認証は不要。インポート時に警告が出たらノードを一度開いて保存する
4. **`trivium-chat` の設定（3 つ）**
   - 環境変数 `TRIVIUM_API_BASE`（例 `https://trivium.153.126.213.251.sslip.io`）と `TRIVIUM_AGENT_TOKEN`（secret。アプリの `AGENT_API_TOKEN` と同じ値）を差し替える
   - **ナレッジ検索ノード「教材ナレッジ検索」を開き、ナレッジ `trivium-materials` を選ぶ**（`dataset_ids` は環境ごとに違うので DSL には入れていない。未選択だと教材ブランチが候補ゼロになる）
   - 「相談先の判定」（question-classifier）のモデルを確認する
   - 環境変数 `OPENAI_API_KEY`（secret）を入れる。**教材ブランチの Web 検索**（`http_search`）が `Authorization: Bearer` に使う。空のままでも会話・教材おすすめは動くが、`NEED_SEARCH: true` になったときの検索が失敗し、「検索できなかった」旨を添えた回答になる
5. **公開と API key 発行** — 各アプリを Publish → API Access → API Key。`DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` / `DIFY_GENERATE_API_KEY` / `DIFY_CHAT_API_KEY` として Coolify（本番）や `.env`（ローカル）に設定し、`AI_PROVIDER=dify` にする
6. **動作確認** — Workflow は Dify の「実行」で `workflow=domain` / `interpret` / `leader` / `generate`（`use_search` 両方）を試し、`result` にコードフェンス無しの JSON が入ることを見る。Chatflow は「デバッグとプレビュー」で `learner_ref` に実在の userId を入れ、
   - 「僕の能力は？」→ ミチが集計値を踏まえて答える
   - `addressed_agent=CODE` で「さっきの問題のヒント」→ ロゴスが答えを言わずに一段だけ導く
   - 「読解を伸ばす本は？」→ ナレッジの候補から 3 件（候補外の書名が出ないこと・書籍に Amazon 検索リンクが付くこと・`NEED_SEARCH` の行が表に出ないこと）
   - 「その本いくらで買える？」→ `NEED_SEARCH: true` 側に入り、`http_search` が動いて価格・入手方法と出典 URL が添えられること（`OPENAI_API_KEY` 未設定なら「検索できなかった」旨になる）
   アプリ側は `/api/health` の `ai.lastUsed` が `dify` なら成功

## 設計メモ

- Dify の End ノードは 1 出力変数につき 1 つの `value_selector` しか持てないため、分岐がある domain / generate は分岐ごとに End ノードを置いています（出力変数名はどれも `result`）
- `hint_level` / `total_events` / `difficulty` は数値で送られるので Start の型は `number`。それ以外は文字列（長文は `paragraph`）
- システムポリシー 7 箇条（`src/lib/ai/types.ts` の `AI_SYSTEM_POLICY`）は毎回 `policy` 変数として渡し、LLM の System 先頭に展開します。DSL 側にコピーを持たないので、コードを直せば Dify 側も追随します
- **人格**（`persona`）は JSON 文字列で渡し、空なら既定の口調。名前・一人称・口調・補足を文体に反映させる（名乗りはしない）
- 決定論採点（choice / short）が確定しているときは、LLM が何を返してもアプリ側で `status` を上書きします（LLM の気分で正誤が変わらない安全弁）
- Web 検索は **依頼文に「ニュース / 時事 / 最近の / 今日の / 話題 / 最新」等が含まれるときだけ**（`dify.ts` の `wantsSearch`）`use_search=true` になります。検索は遅く（＋5〜10 秒）費用もかかるので既定は使いません。検索が失敗しても `research` が空になるだけで作問は続きます
- 検索の要約に医療・法律・宗教・個人の話題を避ける指示を code ノードの依頼文に入れています。作問 LLM 側でも同じ制約を System に書いています
- Chatflow の LLM ノードは **System プロンプトだけ**を持ち、学習者の発話と履歴は `memory`（`query_prompt_template` = `{{#sys.query#}}`、window 12）で渡します。user ロールに `{{#sys.query#}}` を重ねると発話が二重に入るためです
- 4 人格を 1 つの LLM ノードで扱い、「いま話す担当」は会話変数 `last_agent`（assigner で書き込み）で示します。人格ごとに LLM ノードを分けるより、共有文脈と禁止事項の記述が 1 か所で済みます
- `last_agent` は会話に残るので、次のターンで担当が変わったかどうかも LLM から見えます

## モデルと推論の深さ（effort）

DSL の LLM ノードは `completion_params: {}`（＝プラグイン既定）で出しています。**モデル名と推論の深さは Dify の UI（各 LLM ノード → モデル → パラメータ）で設定してください**。プラグインによってパラメータ名（`reasoning_effort` など）が違うため、DSL には焼き込んでいません。

| アプリ / ノード | モデル | reasoning effort | 理由 |
|---|---|---|---|
| `trivium-chat` の「4 人格の応答」「教材のおすすめ」「相談先の判定」 | `gpt-5.6-luna` | **low** | 返信の速さが体感に直結（実測: 意図判定 1.3s / 会話 1.7s） |
| `trivium-domain`（評価・寸評） | `gpt-5.6-luna` | **low** | 同上（評価 2.6s） |
| `trivium-leader`（総合寸評） | `gpt-5.6-luna` | **low** | 1 日 1 回・push なので低めで十分 |
| `trivium-generate`（作問） | `gpt-5.6-sol` | **medium**（質優先なら high） | 実測 low 16s / medium 23s / high 47s。push で後追い配信なので medium まで許容 |

**注意**: 推論トークンも出力上限に含まれます。effort を上げるノードは `max_tokens` も上げてください（作問は 8000 以上）。上限が足りないと出力が途中で切れ、アプリ側の JSON 検証に落ちて Mock にフォールバックします。

アプリ側（Dify を使わない直接呼び出し）の対応する設定は `src/config/trivium.config.ts` の `MODELS` / `MODELS.reasoningEffort` です。
