# Trivium

> **AI does not do the work for you. It helps you take the next step.**

READ / WRITE / CODE の短い課題に取り組むと、AI は答えを教えずに **一段だけヒント** を出します。
学習行動は learning event として記録され、各 domain の能力プロフィールが **決定論的に** 更新され、
その上に立つ **LEADER** が全体の傾向と「次の一歩」を提案します。

```
                 LEADER
        global learner model
                  |
       +----------+----------+
       |          |          |
      READ       WRITE      CODE
      memory     memory     memory

      skills are local, learner is global.
```

中高生〜成人を対象にした 24 時間プロトタイプです。特定の既存サービスの UI・文言・キャラクターは使っていません。

## 何ができるか

- **Google ログイン** — 学習状態はサーバ（PostgreSQL）に永続化。別端末でも同じプロフィール
- **READ** 短文を読んで要旨・推論・批判的読解 / **WRITE** 主張・反論・推敲 / **CODE** Python の出力予測・バグ発見・設計の言語化
- **一段ヒント** — 誤答すると AI が問い返し／ヒントを 1 つだけ。3 回まで。完成解は出さない
- **能力プロフィール** — READ / WRITE / CODE の三角形レーダー、subskill ごとのバー、信頼度（low / medium / high）
- **LEADER** — 各 domain の要約を読み、総合寸評と次の課題を提案
- **LINE 公式アカウント** — 入口として「今日のおすすめ」「10 分だけやりたい」に応え、Web へ誘導（署名検証付き Webhook・Rich Menu）
- **LINE ↔ Web アカウント連携** — LINE で「連携」と送るとワンタイムURLが届き、Google ログイン後に紐づく。以降 LINE の Leader が実際の学習記録にもとづいて答える（「連携解除」でいつでも解除）
- **Demo Seed** — 架空の 10 日分の学習履歴をワンクリックで投入（自分のアカウントにのみ）

## 画面

| ホーム | 学習（一段ヒント） | 結果とプロフィール更新 |
|---|---|---|
| <img src="docs/screenshots/home.png" width="240" alt="ホーム画面。ロゴと READ / WRITE / CODE のカード" /> | <img src="docs/screenshots/learn-code-hint.png" width="240" alt="CODE の課題。誤答に対して hint 1 だけが提示されている" /> | <img src="docs/screenshots/learn-code-done.png" width="240" alt="正解後の解説とスコア変化、Leader の寸評" /> |

| Dashboard（ライト） | Dashboard（ダーク） |
|---|---|
| <img src="docs/screenshots/dashboard-mobile.png" width="300" alt="能力プロフィールの三角形、次の一歩、domain 寸評" /> | <img src="docs/screenshots/dashboard-mobile-dark.png" width="300" alt="ダークモードの Dashboard" /> |

## 数値 = evidence、文章 = AI interpretation

能力スコアは LLM が決めません。`learning_events` から `src/lib/scoring.ts` が決定論的に集計します。

| 状況 | 基礎点 |
|---|---|
| ヒントなし成功 | 1.0 |
| ヒント 1 回で成功 | 0.8 |
| ヒント 2 回で成功 | 0.6 |
| 失敗 | 0.2 |

× 難易度重み（1→0.7 … 5→1.3）× 新しさ重み（半減期 14 日）。中立値 0.5 を擬似観測 2 件分混ぜているため、
**一回の失敗だけで「苦手」とは断定されません**。記録が少ないうちは「信頼度: low（分析中）」と表示します。

LLM には「解釈」だけを任せます: 寸評・観察・次のおすすめ・ヒントの選択。
provider は `LearningAIService` で抽象化され、`AI_PROVIDER` で切り替えます。

| provider | 説明 |
|---|---|
| `anthropic` | Claude API を server-side から直接呼ぶ（structured outputs で JSON 固定、system policy 7 か条を強制）。設定が最小で推奨 |
| `dify` | Dify Workflow 経由。`dify/*.yml` をインポートすればそのまま動く |
| `mock` | ルールベース。キー不要。上の 2 つが失敗したときも **自動でここにフォールバック** し、アプリは止まりません |

## 技術スタック

Next.js 16 (App Router, TypeScript) · PostgreSQL · Prisma 7 · Auth.js v5 (Google) · Recharts · Claude API / Dify Workflow API (server-side) · LINE Messaging API · Docker / Coolify

## ローカル開発

```bash
npm install                 # postinstall で prisma generate
cp .env.example .env        # 値を埋める（下記）
# PostgreSQL: Docker があれば `docker compose up -d`、無ければ `npx prisma dev -d -n trivium`
npx prisma migrate dev      # migration 適用
npm run dev                 # http://localhost:3000
```

Google OAuth を用意しなくても、`DEMO_LOGIN_ENABLED=true` にすれば「デモとして入る」でログインできます（本番では false 推奨）。

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run seed:demo -- --email you@example.com   # CLI から demo seed（--reset で入れ直し）
npm run line:richmenu                          # LINE Rich Menu 作成
npm run preflight -- https://<公開URL>         # デプロイ先の健全性チェック（デモ直前に実行）
```

## 環境変数

`.env.example` を参照。実値はコミットしません。

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_APP_URL` | 公開 URL（OAuth コールバック・LINE からの誘導リンク） |
| `DATABASE_URL` | PostgreSQL 接続文字列（Coolify 内部ネットワーク。5432 を公開しない） |
| `AUTH_SECRET` / `AUTH_TRUST_HOST` | Auth.js |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth（server only） |
| `DEMO_LOGIN_ENABLED` | デモ用フォールバックログイン（既定 false） |
| `DEMO_SEED_ENABLED` | Dashboard の「デモデータ投入」ボタン（既定 true） |
| `AI_PROVIDER` | `anthropic` / `dify` / `mock` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `ANTHROPIC_TIMEOUT_MS` | Claude API（server only。`AI_PROVIDER=anthropic` のとき） |
| `DIFY_API_BASE` / `DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` / `DIFY_TIMEOUT_MS` | Dify Workflow（server only） |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API |

## 主なエンドポイント

| パス | 説明 |
|---|---|
| `GET /api/health` | DB 疎通と AI provider の状態 |
| `GET /api/learn/next?domain=read\|write\|code[&task=id]` | 次の課題（正解・ヒント・解説は含まない） |
| `POST /api/learn/submit` | 回答 → 決定論採点 → AI の feedback / 一段ヒント → 決着時に learning event 記録 → profile 再計算 |
| `GET /api/profile` | Dashboard と同じプロフィール JSON |
| `POST /api/demo/seed` | 自分のアカウントにデモ履歴を投入 |
| `POST /api/line/webhook` | LINE Webhook（署名検証） |
| `GET /link/<token>` | LINE 連携の確認ページ（POST で消費。単回・15分） |

## ドキュメント

- [ARCHITECTURE.md](ARCHITECTURE.md) — 構造とデータフロー
- [DEPLOY.md](DEPLOY.md) — Sakura VPS + Coolify へのデプロイ、Google / Dify / LINE の設定
- [DEMO.md](DEMO.md) — 2〜3 分のデモ台本

## セキュリティ方針

API key / OAuth secret はサーバ側 env のみ。`.env` はコミットしない。PostgreSQL は公開しない。
LINE Webhook は署名検証。Dify へは PII（メール・氏名）を渡さず内部 ID のみ。DB アクセスは Prisma 経由。

## やらないこと（24h MVP の範囲外）

課金・SNS・ランキング・複雑な権限管理・巨大 RAG・microservices・IRT などの高度な能力推定。
