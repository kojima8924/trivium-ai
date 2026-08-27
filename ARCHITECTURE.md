# ARCHITECTURE.md — Trivium の構造

> **"AI does not do the work for you. It helps you take the next step."**
> AI は課題を代わりに完成させない。原則として一度に一段のヒント・問い返しだけを出す。

## 全体の流れ

```
LINE / Web
   ↓
LEADER（リード）              … 学習者全体を見る案内役（global learner model）
   ↓
READ / WRITE / LOGIC          … 系統ごとの課題を 1 問ずつ（skills are local）。人格: アオイ / フミ / ケイ
   ↓
learning events               … 生ログ（episodic memory）。難易度ベクトル {read, write, code} 付き
   ↓
到達レベル・観点別の証拠        … 決定論（src/lib/scoring.ts）
XP・ミッション・streak・ランク  … 決定論（src/lib/xp.ts）
   ↓
domain profiles / agent memory … 系統ごとの寸評（見せる）と観察メモ（見せない）
   ↓
leader profile / leader memory … 総合寸評と、4 つのメモを束ねた案内役の記憶
   ↓
next learning recommendation   … Web の「次の一歩」、LINE の出題・会話・総評
```

**skills are local, learner is global.** 各系統は自分の学習記録・到達レベル・観点別の証拠・観察メモだけを持つ。LEADER は各系統の要約とメモだけを読み、学習者全体の傾向と次の一歩を判断する。LEADER が個々の課題の採点に口を出すことはない。

## 運営設定は 1 か所: `src/config/trivium.config.ts`

秘密情報以外の「運営の判断」はこのファイルに集約し、コードは定数として参照する。ユーザーごとの上書き（人格）は DB に保存され、こちらより優先される。

| 定数 | 内容 | 参照するコード |
|---|---|---|
| `MODELS` | 役割別モデル（evaluate / interpret / leader / chat は `gpt-5.4-mini`、generate は `gpt-5.5`）と推論の深さ | `src/lib/ai/openai.ts` |
| `TONE_PRESETS` / `PERSONA_DEFAULTS` | 口調 12 種、4 人格の既定（名前・口調・一人称・補足・呼びかけの別名） | `src/lib/persona.ts` |
| `SCORING` / `TASK_TYPES` | 到達レベルのしきい値・証拠量・半減期・ヒント基礎点・失敗の帰属幅、課題 7 類型 | `src/lib/scoring.ts` |
| `XP` | 課題 XP・ヒント倍率・ミッション・streak・ランク | `src/lib/xp.ts` |
| `RECOMMENDATIONS` | 系統別の書籍・サイト | `src/lib/recommend.ts` |
| `EXTERNAL` | 現在日時の付与、Web 検索を許す経路、会話の記憶往復数、メモの上限 | `src/lib/ai/openai.ts`, `src/lib/line/chat.ts`, `src/lib/memory.ts` |

## メモリの層

| 層 | テーブル | 中身 | 性質 |
|---|---|---|---|
| **episodic memory** | `LearningEvent` | 1 回の取り組みの生ログ（domain, task, difficulty, axisRead/Write/Code, answer, success, hintCount, latency, skillTags, generated, createdAt） | 追記のみ。事実 |
| **semantic memory (local)** | `DomainProfile` | 系統ごとの score / subskills / confidence / evidence、AI 寸評、観察、次のおすすめ | 生ログから**再計算可能**な推定（見せる） |
| **agent memory (local)** | `AgentMemory` | 各人格が書く担当系統の観察メモ（400 字以内・数値は書かない） | 本人には見せない。会話と寸評の材料 |
| **semantic memory (global)** | `LeaderProfile` / `AgentMemory(LEADER)` | 総合寸評・おすすめ、4 つのメモを束ねた案内役の記憶 | 再計算・書き直し可能 |
| **conversation memory** | `ChatTurn` | LINE の会話（人格ごとに直近 10 往復を prompt に渡す） | 人格ごとに独立 |
| **time series** | `ProfileSnapshot` | 再計算のたびに 3 系統の score を 1 行 | グラフは今後（Issue #1） |
| **in-progress state** | `TaskAttempt` / `LineUser.state` | 進行中の挑戦（ヒント回数の正本）、LINE の出題中タスク | 決着で消える |

推定はいつでも生ログから作り直せる（`recomputeAll()`）。証拠が少ないときは `confidence: low` として「分析中」と表示する。

## 数値 = evidence、文章 = AI interpretation

能力の数値は **LLM に決めさせない**。`src/lib/scoring.ts` が `LearningEvent` から決定論的に集計する。

```
難易度      : 系統ごとに 1〜10。課題は難易度ベクトル axes = {read, write, code}（0 = 無関係）
成功        : 関与する全系統に「その難易度以下は解ける」証拠（重み = 新しさ × ヒント基礎点）
失敗        : ボトルネック系統（課題難易度 − 到達レベルの差が最大）だけに否定証拠（難易度 ±1 の窓）
到達レベル L: pos(d)/(pos+neg) ≥ 0.7 かつ 証拠量 ≥ 1.5 を満たす最大の d
              pos(d) = 成功で d_S ≥ d、neg(d) = 失敗で d_F ≤ d + 1
score       : L × 10 + 次のレベルの正答率 × 10（0〜100）
subskills   : 観点別の証拠バー = ヒント基礎点(1.0/0.8/0.6/0.5/失敗 0.2) × 難易度重み(1→0.7 … 10→1.3) × 新しさ重み(半減期 14 日) の平均
confidence  : evidence < 3: low / < 8: medium / それ以上: high
次の難易度  : L + 1（直近 3 件中 2 件失敗なら据え置き）
```

失敗の帰属は 2 パス（1 回目は絶対難易度で暫定レベルを出し、2 回目でレベル差の最大の系統に帰属）。複合課題 `(read 3, write 2, logic 8)` を落としても READ / WRITE は下がらない。

LLM が担当するのは **解釈と生成**だけ:

- 回答へのフィードバックと「一段だけ」のヒント（`evaluate`）
- 系統の寸評・観察・次のおすすめ（`interpretDomain`）と観察メモ（`updateMemory`）
- 総合寸評・次に取り組む系統（`leader`）
- 人格としての会話（`chat`。現在日時を知り、許可された経路では Web 検索を使う）
- 作問（`generateTask`。系統・形式・難易度・LOGIC のスタイルはコード側が決定論で決める）

決定論採点が正誤を確定している課題（選択式・短答）では、LLM が `success` と言ってもコード側で結果を上書きする（安全弁）。自由記述はルーブリックのヒューリスティックを参考情報として LLM に渡す。

## XP（行動の積み上げ）— `src/lib/xp.ts`

三角形（能力の証拠。下がることもある）とは別に、減らない指標として XP を持つ。すべて `LearningEvent` から決定論で導く。

```
課題 XP     = perDifficultyPoint(10) × 難易度ベクトルの合計 × ヒント倍率(1.0/0.8/0.6/0.5、失敗 0.25) × 生成課題 1.2
系統別 XP   = 難易度比で按分（端数は最も難しい系統へ。無関係な系統には入らない）
ミッション  = JST の同日に READ / WRITE / LOGIC すべてに決着 → +50
streak      = ミッションの連続日数 × 10（上限 100）
ランク      = 総合 XP のしきい値（Novice / Apprentice / Grammarian / Logician / Rhetor / Trivium Master）
```

Web は Dashboard の `XpCard`、LINE は Flex カード（`src/lib/line/flex.ts`）で表示する。ミッション達成時は総評と「今日の 1 冊」（`RECOMMENDATIONS` からコード側が選ぶ。LLM に書名を作らせない）を LINE に push する。

## 学習ループのサービス層（Web と LINE で共通）— `src/lib/learn/service.ts`

```
Web (/api/learn/*)  ─┐
                     ├─→ service.ts ─→ LearningEvent → 到達レベル / XP → profiles / memory → leader
LINE webhook        ─┘     │
                           ├─ resolveTask   : 静的タスク（src/lib/tasks/*）または LLM 生成タスク（GeneratedTask）
                           ├─ nextTask      : 弱い観点を優先して次の課題を選ぶ（推薦文と出題を整合させる）
                           ├─ submitAnswer  : 決定論採点 → AI 講評/一段ヒント（選択式はキャッシュ）→ 決着時に記録
                           │                  deferFinalize=true なら先に返信し、集計は後で（LINE）
                           └─ finalize      : profile / leader 再計算・achievement・ProfileSnapshot・観察メモ更新・今日の 3 問通知
```

- **課題**（`src/lib/tasks/`）: 単独 51 問（read / write / code）＋複合 12 問（`composite.ts`、`mix-001`〜。2〜3 系統の難易度ベクトルを持つ）。7 類型は `TASK_TYPES`
- **作問**（`src/lib/learn/generate.ts`）: 自由文 → 系統 / 形式 / 難易度 / LOGIC のスタイル（Python か論理パズルか）を決定論で決めてから LLM に作らせ、`GeneratedTask` に保存。通常の学習ループで解ける
- **人格**（`src/lib/persona.ts`）: 4 人格。prompt にだけ効き、採点には影響しない。`detectAddressedAgent` が「ケイ、〜」のような呼びかけを判定
- **講評キャッシュ**（`TaskFeedbackCache`）: 選択式は (task, 回答, ヒント段階, 人格) で保存。`npm run warm-cache` / `POST /api/demo/warm` で事前生成
- **ヒント回数**は `TaskAttempt`（サーバ側）が正本。クライアントの申告は表示にしか使わない
- **リセット**（`POST /api/demo/reset`）: 学習状態を初期化。人格と LINE 連携は残す

## AI レイヤーの抽象化 — `src/lib/ai/`

`LearningAIService`（`index.ts`）が provider を束ね、primary が失敗したら `MockProvider` に落とす。`/api/health` の `ai.lastUsed` / `ai.lastError` で状態が見える。

| provider | ファイル | 備考 |
|---|---|---|
| `OpenAIProvider`（既定） | `openai.ts` | OpenAI Responses API。zod structured outputs で JSON を固定。**instructions（system）= ポリシー 7 か条＋役割＋人格、input（user）= 課題・回答・記録・現在日時・会話履歴** と分離。役割ごとに `MODELS` のモデルと推論深度。chat / generate だけ `web_search` ツールを許可 |
| `DifyProvider` | `dify.ts` | Dify Workflow API。`dify/*.yml`（3 本、LLM は OpenAI）が対応する DSL。作問は `DIFY_GENERATE_API_KEY` |
| `AnthropicProvider` | `anthropic.ts` | Claude API。任意・非推奨（Issue #7 で整理予定） |
| `MockProvider` | `mock.ts` | ルールベース。常にフォールバック先。定型の作問も持つ |

正答後は系統の寸評（interpretDomain）と LEADER を **並列** に生成する（LEADER の数値は events から決定論的に再計算するので保存順に依存しない）。

## LOGIC 領域について

内部キーは `CODE` のまま（DB の enum を変えない）、表示名は **LOGIC / 論理**。Python の読解と、手順・条件・推論の問題（非 Python）の両方を含む。subskill は tracing=手順の追跡 / debugging=誤りの発見 / algorithms=手順の設計 / design=構造化・言語化。URL は `/learn/logic`（`parseDomain("logic")` が `CODE` に写す）。

## LINE — 入口と、4 人格との会話 — `src/lib/line/`

```
message / postback（署名検証 → LineUser upsert）
  ├─ 「今日の学習」/「1問」/「READで1問」 … quiz.ts: LEADER の推薦系統で選択式を Quick Reply 出題（連携必須）
  ├─ 選択肢タップ                          … quiz.ts: 決定論採点 → 講評 reply → after() で finalize → Lv / +XP / 一言を push
  ├─ 「論理パズル出して」                  … generate.ts: 「作っています…」→ after() で作問 → 出題（short/free は Web へ）
  ├─ 「連携」/「連携解除」                  … link.ts: ワンタイム URL（単回・15 分）
  ├─ PROFILE                              … flex.ts: 到達レベル・XP・ミッション・streak の Flex カード
  └─ それ以外の自由文                      … chat.ts: 呼びかけで人格を判定（無ければ LEADER）→ メモ・記録・10 往復・現在日時を渡して会話
今日の 3 問がそろった瞬間                 … digest.ts: 総評＋XP＋今日の 1 冊を push（DailyDigest で 1 日 1 回）
```

- LINE の応答期限が短いので、時間のかかる処理（作問・集計・会話生成）は先に短い reply を返し、Next.js の `after()` で続きを push する
- LINE 側へ渡すのは学習記録の集計値と人格の文体だけ。氏名・メールは読まない

## LINE ↔ Web アカウント連携

```
LINE「連携」 → LineLinkToken を発行（単回・15 分）→ /link/<token> を返信
            → Web で Google ログイン → 「連携する」（POST）で消費 → LineUser.userId = users.id
```

GET では消費しない（プレビュー取得やクローラで無効化されないため）。消費は `updateMany(count === 1)` でアトミック。結果画面は DB で裏を取る。「連携解除」で `LineUser.userId` を外す（学習記録は Web 側に残る）。

## 主要ファイル

| パス | 役割 |
|---|---|
| `src/config/trivium.config.ts` | 運営設定（モデル・人格・採点・XP・推薦・外部情報） |
| `prisma/schema.prisma` | DB スキーマ（User / LearningEvent / DomainProfile / LeaderProfile / AgentPersona / AgentMemory / ChatTurn / GeneratedTask / TaskAttempt / TaskFeedbackCache / DailyDigest / ProfileSnapshot / Achievement / LineUser / LineLinkToken） |
| `src/lib/domain.ts` | READ / WRITE / CODE(LOGIC) の定義、subskill、表示メタ |
| `src/lib/scoring.ts` / `src/lib/xp.ts` | 到達レベルと観点別の証拠 / XP・ミッション・streak・ランク |
| `src/lib/tasks/{read,write,code,composite}.ts` / `index.ts` | 課題集（段階ヒント・解説・skill tags・難易度ベクトル）、決定論採点、正規化 |
| `src/lib/learn/{service,generate,digest}.ts` | 学習ループ、作問、今日の 3 問通知 |
| `src/lib/ai/*` | provider 抽象化（openai / dify / anthropic / mock）と型・ポリシー |
| `src/lib/persona.ts` / `src/lib/memory.ts` | 人格の既定と上書き、観察メモ |
| `src/lib/profile.ts` | events → profiles → leader の再計算、Dashboard 用データ |
| `src/lib/line/*` | webhook の会話ロジック、出題、会話、連携、Flex、push |
| `src/lib/http.ts` | クロスサイト POST の拒否とレート制限 |
| `src/auth.ts` | Auth.js v5（Google OAuth + env でゲートしたデモログイン） |
| `src/app/api/**` | health / learn（next・submit・generate）/ profile / demo（seed・reset・warm）/ line webhook / auth |
| `src/app/{dashboard,learn,settings,link,login}` | 画面 |
| `scripts/*` | seed / warm-cache / preflight / Rich Menu / ブランド素材。開発用は `scripts/dev/`（README あり） |
| `dify/*` | Dify Workflow DSL（任意） |
| `Dockerfile` / `docker-entrypoint.sh` / `.github/workflows/*` | CI（実ビルド＋起動スモーク）→ GHCR → Coolify |

## セキュリティ方針（要約）

- API key（OpenAI / Dify / LINE / Google）は **server-side env のみ**。`NEXT_PUBLIC_` を付けるのは公開 URL だけ
- `.env` は git 管理外。`.env.example` にキー名のみ
- PostgreSQL は Coolify 内部ネットワークのみ。5432 を public に出さない
- LINE Webhook は `x-line-signature` を HMAC-SHA256 で検証。不一致は 401
- Google からは `openid email profile` だけ取得し、保存は表示名・メール・アイコン URL のみ
- LLM へ PII を送らない（内部 ID のみ）
- DB アクセスは Prisma 経由（生 SQL はヘルスチェックの `SELECT 1` のみ）
- 状態を変える API はクロスサイト POST を拒否（Content-Type / Sec-Fetch-Site / Origin）し、ユーザー単位のレート制限を持つ
- ヒント回数はサーバ側（`TaskAttempt`）が正本。`/login?next=` は自サイト内パスのみ
- 本番でデバッグ用の秘密を表示しない（`/api/health` は provider 名・疎通・伏字のエラー要約だけ）
- デモ用ログイン・seed・reset・warm は env でゲートし、**ログイン中ユーザー自身のデータにしか触れない**
