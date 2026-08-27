# scripts/dev — 開発・検証用スクリプト

本番では使わない、手元で「本当に動くか」を確かめるためのスクリプト。すべて次の形で実行する（`server-only` モジュールを Node から読むため `--conditions=react-server` が要る）。

```bash
npx tsx --conditions=react-server scripts/dev/<name>.ts
```

前提: `.env` に `DATABASE_URL`（ローカルの `npx prisma dev -d -n trivium`）と、必要なら `OPENAI_API_KEY` / `LINE_*` が入っていること。dev サーバ（`npm run dev`、http://localhost:3000）を使うものはその旨を明記。

| スクリプト | 何を確かめるか | 外部 API | デモ用アカウントへの影響 |
|---|---|---|---|
| `ai-check.ts` | AI provider の疎通と品質（evaluate / interpretDomain / leader を代表入力で実行し、応答と所要時間を表示。答えを漏らしていないかを目視） | OpenAI（現在の `AI_PROVIDER`） | なし（DB に触らない） |
| `gen-check.ts` | 作問（generateTask）の疎通と品質 | OpenAI | なし |
| `chat-check.ts` | 4 人格との会話（`chatWithAgent`）と観察メモ更新。時刻の反映・人格（ツンデレの LEADER 等）・Web 検索の使用を確認 | OpenAI（検索を含む） | なし（テストユーザーを作って削除） |
| `link-check.ts` | LINE 連携トークンの一生（発行・消費の単回性・失効・再発行時の無効化・解除・同時消費の競合） | なし | なし（テスト行を作って削除） |
| `line-quiz-check.ts` | LINE 出題フローの結合検証（署名付き webhook を dev サーバに送り、出題→誤答→正答→記録を確認） | OpenAI、dev サーバ | なし（テストユーザーを作って削除） |
| `digest-check.ts` | 「今日の 3 問」完了通知の条件判定（2 系統では送らない、3 系統で `DailyDigest` を作る、同日 2 回目は送らない） | LINE push（架空 ID なので失敗するが記録は残る） | なし |

注意:

- ローカル DB（`prisma dev` = PGlite）は並列アクセスに弱い。スクリプトは直列に走らせる（Issue #8）
- デモ用アカウント（`demo+demo-learner@trivium.local`）の状態を変えるスクリプトは無い。学習ループを本物の API で試したい場合は `curl` で `/api/learn/submit` を叩き、最後に `POST /api/demo/seed {"reset":true}` で戻す（`DEMO.md` の事前準備を参照）

本番向けの運用スクリプトは 1 つ上の `scripts/` にある（`seed-demo.ts` / `warm-cache.ts` / `preflight.ts` / `line-richmenu.ts` / `line-richmenu-image.ts` / `brand-assets.ts`。それぞれ `npm run` のエントリが `package.json` にある）。
| `line-dispatch-check.ts` | 署名付き webhook で LINE の振り分け（出題／作問／呼びかけ会話／古い出題の拒否）を実機確認 | OpenAI・LINE 署名 | 使い捨てユーザーを作って削除。デモ用アカウントには触れない |
