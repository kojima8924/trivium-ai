# ARCHITECTURE.md — Trivium の構造

> **"AI does not do the work for you. It helps you take the next step."**
> AI は課題を代わりに完成させない。原則として一度に一段のヒント・問い返しだけを出す。

## 全体の流れ

```
LINE/Web
   ↓
Leader                      … 学習者全体を見る（global learner model）
   ↓
READ / WRITE / CODE         … 各 domain の課題を 1 問ずつ（skills are local）
   ↓
learning events             … 生ログ（episodic memory）
   ↓
domain profiles             … domain ごとの推定（semantic memory・local）
   ↓
leader profile              … 学習者全体の推定（semantic memory・global）
   ↓
next learning recommendation
```

```
                 LEADER
        global learner model
                  |
       +----------+----------+
       |          |          |
      READ       WRITE      CODE
      memory     memory     memory
```

**skills are local, learner is global.**
各 domain は自分の学習記録と能力評価（subskill）だけを持つ。Leader は各 domain の要約だけを読み、学習者全体の傾向・次に行うべき活動を判断する。Leader が個々の課題の採点に口を出すことはない。

## メモリの 2 層

| 層 | テーブル | 中身 | 性質 |
|---|---|---|---|
| **episodic memory** | `learning_events` | 1 回の取り組みの生ログ（domain, task, difficulty, answer, success, hint_count, latency, skill_tags, created_at） | 追記のみ。事実 |
| **semantic memory (local)** | `domain_profiles` | domain ごとの subskill スコア、confidence、evidence 件数、AI 寸評、観察、次のおすすめ | 生ログから**再計算可能**な推定 |
| **semantic memory (global)** | `leader_profiles` | 総合寸評、興味、学習傾向、観察、現在のおすすめ | domain profile の要約から再計算可能な推定 |

推定はいつでも生ログから作り直せる（`recomputeAll()`）。だから一回の失敗だけで「苦手」と断定せず、証拠が少ないときは `confidence: low` として「分析中」と表示する。

## 数値 = evidence、文章 = AI interpretation

能力スコアは **LLM に決めさせない**。`src/lib/scoring.ts` が `learning_events` から決定論的に集計する:

```
base   = 成功(ヒント0) 1.0 / ヒント1 0.8 / ヒント2 0.6 / ヒント3+ 0.5 / 失敗 0.2
weight = difficulty weighting(1→0.7 … 5→1.3) × recency weighting(半減期 14 日)
score  = 重み付き平均（中立値 0.5 を擬似観測 2 件分混ぜて、少数サンプルで極端にならないようにする）
confidence = evidence < 3: low / < 8: medium / それ以上: high
```

LLM（Dify / Mock）が担当するのは **解釈**だけ:

- 回答へのフィードバックと「一段だけ」のヒント（`evaluate`）
- domain の寸評・観察・次のおすすめ（`interpretDomain`）
- 総合寸評・次に取り組む domain（`leader`）

決定論採点が正誤を確定している課題（選択式・短答）では、LLM が `success` と言ってもコード側で結果を上書きする（安全弁）。自由記述（WRITE など）はルーブリックのヒューリスティックを暫定結果として LLM に渡す。

## 学習ループ（1 問）

```
GET  /api/learn/next?domain=code   … 難易度目安に近い未回答タスクを 1 つ返す（answerKey / hints は返さない）
POST /api/learn/submit             … { taskId, answer, hintCount }
   1) 決定論採点（choice / short）。free はヒューリスティック
   2) LearningAIService.evaluate() → feedback + 一段ヒント
   3) 決着（成功 or ヒント上限 or ギブアップ）したときだけ learning_event を記録
   4) domain profile → leader profile を再計算、achievement 判定
   → レスポンスに before/after スコア・寸評・おすすめを含めて返す（Dashboard の三角形が動く）
```

ヒントは `Task.hints[]` に段階的に用意され、`hintLevel` に応じて 1 つずつしか出ない。完成解は `explanation` として**決着後にだけ**表示する。

## AI レイヤーの抽象化

```
LearningAIService（src/lib/ai/index.ts）
   ├─ primary : DifyProvider（src/lib/ai/dify.ts）  … Dify Workflow API を server-side から呼ぶ
   └─ fallback: MockProvider（src/lib/ai/mock.ts）  … ルールベース。Dify 未設定・障害時に自動で切替
```

- インターフェースは `LearningAIProvider`（`evaluate` / `interpretDomain` / `leader`）。将来 `DirectLLMProvider` を足すときもアプリ側は変更不要
- Dify には内部 ID（`learnerRef`）だけを渡す。メール・氏名などの PII は渡さない
- Dify の出力は zod で検証し、欠けたフィールドは Mock の結果で埋める
- 7 箇条のシステムポリシー（`AI_SYSTEM_POLICY`）を毎回 `policy` として送る

## 主要ファイル

| パス | 役割 |
|---|---|
| `prisma/schema.prisma` | DB スキーマ（User / Account / Session / LearningEvent / DomainProfile / LeaderProfile / Achievement / LineUser） |
| `prisma.config.ts` | Prisma 7 の設定（DATABASE_URL は実行時 env） |
| `src/lib/prisma.ts` | Prisma Client（pg driver adapter） |
| `src/lib/env.ts` | サーバ側 env の集約（`server-only`） |
| `src/lib/domain.ts` | READ / WRITE / CODE の定義、subskill 一覧、表示メタ |
| `src/lib/scoring.ts` | 決定論スコアリング（base × difficulty × recency、confidence、次の難易度） |
| `src/lib/tasks/{read,write,code}.ts` | タスク集（段階ヒント・解説・skill tags 付き） |
| `src/lib/tasks/index.ts` | タスク選択、決定論採点、ヒューリスティック採点 |
| `src/lib/ai/types.ts` | AI 入出力の型とシステムポリシー |
| `src/lib/ai/mock.ts` / `dify.ts` / `index.ts` | Mock / Dify provider と、フォールバック付きサービス |
| `src/lib/profile.ts` | events → domain profile → leader profile の再計算、Dashboard 用データ |
| `src/lib/achievements.ts` | 少数の achievement 判定 |
| `src/lib/demo-seed.ts` | 約 10 日分の架空 learning_events を投入 |
| `src/auth.ts` | Auth.js v5（Google OAuth + env でゲートしたデモログイン） |
| `src/app/api/health/route.ts` | ヘルスチェック（DB 疎通・AI provider 状態） |
| `src/app/api/learn/next/route.ts` | 次のタスク取得 |
| `src/app/api/learn/submit/route.ts` | 回答提出 → 採点 → ヒント → 記録 → 再計算 |
| `src/app/api/profile/route.ts` | 学習プロフィール取得 |
| `src/app/api/demo/seed/route.ts` | ログイン中ユーザーへのデモ seed |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js ハンドラ |
| `src/app/api/line/webhook/route.ts` | LINE Webhook（署名検証。Leader だけを表面に出し、課題は Web へ誘導） |
| `scripts/seed-demo.ts` | seed の CLI 版 |
| `scripts/line-richmenu.ts` | LINE Rich Menu セットアップ |
| `Dockerfile` / `docker-entrypoint.sh` | Coolify 用イメージ。起動時に `prisma migrate deploy` |

## LINE ↔ Web アカウント連携

LINE は「入口」、Web は「学習の場」。両者は既定では独立しているが、連携すると LINE の Leader が実データで答える。

```
LINE「連携」 → webhook が LineLinkToken を発行（単回・15分）
            → ワンタイムURL /link/<token> を返信
            → ユーザーが Web で Google ログイン
            → 「連携する」ボタン（POST）で消費 → LineUser.userId = users.id
            → 以降 LINE の Leader は domain_profiles / leader_profiles を読んで答える
```

- GET では消費しない（リンクのプレビュー取得やクローラで無効化されないため）
- トークンは 24 バイト乱数、単回、15分で失効。新しく発行すると古い未使用トークンは無効化される
- LINE 側へ渡すのは学習記録の集計値だけ。氏名・メールは読まない
- 「連携解除」で `LineUser.userId` を外す（学習記録は Web 側に残る）

関連ファイル: `src/lib/line/link.ts` / `src/app/link/[token]/page.tsx` / `src/app/api/line/webhook/route.ts`

## セキュリティ方針（要約）

- API key（Dify / LINE / Google）は **server-side env のみ**。`NEXT_PUBLIC_` を付けるのは公開 URL だけ
- `.env` は git 管理外（`.gitignore`）。`.env.example` にキー名のみ
- PostgreSQL は Coolify 内部ネットワークのみ。5432 を public に出さない
- LINE Webhook は `x-line-signature` を HMAC-SHA256 で検証。不一致は 401
- Google からは `openid email profile` だけ取得し、保存は表示名・メール・アイコン URL のみ
- Dify へ PII を送らない（内部 ID のみ）
- DB アクセスは Prisma 経由（生 SQL はヘルスチェックの `SELECT 1` のみ）
- 本番でデバッグ用の秘密を表示しない（`/api/health` は provider 名と疎通状態だけ）
- デモ用ログイン・seed は env でゲートし、seed は**ログイン中ユーザー自身のデータにしか触れない**
