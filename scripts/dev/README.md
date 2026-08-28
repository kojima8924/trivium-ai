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
| `line-dispatch-check.ts` | LINE の振り分けを実機確認（署名付き webhook を dev サーバへ。課題の依頼→出題 or 作問／系統指定／今日の学習／呼びかけ会話／古い出題の拒否／領域語の誤爆なし の 6 項目） | OpenAI、dev サーバ | 使い捨てユーザーを作って削除。デモ用アカウントには触れない |
| `materials-url-check.mts` | 教材カタログ 145 件の URL を全件検査。**証明書のホスト名不一致**（LINE 内ブラウザは警告を無視できないので開けない）・404・DNS 不到達を検出する。Cloudflare 等の 403 は「要確認」として分けて表示 | 各教材サイト | なし |
| `dify-chat-check.ts` | Dify 統合 Chatflow（`trivium-chat`）の疎通。担当の指定、`/api/agent/context` が引けないときに文脈なしで会話できるかも確認 | Dify（`DIFY_CHAT_API_KEY`） | なし |

注意:

- ローカル DB（`prisma dev` = PGlite）は並列アクセスに弱い。スクリプトは直列に走らせる（Issue #8）
- デモ用アカウント（`demo+demo-learner@trivium.local`）の状態を変えるスクリプトは無い。学習ループを本物の API で試したい場合は `curl` で `/api/learn/submit` を叩き、最後に `POST /api/demo/seed {"reset":true}` で戻す

本番向けの運用スクリプトは 1 つ上の `scripts/` にある。

| スクリプト | 用途 | 実行 |
|---|---|---|
| `seed-demo.ts` | デモ用の 10 日分の学習履歴を投入（`--reset` で入れ直し） | `npm run seed:demo -- --email you@example.com` |
| `warm-cache.ts` | 選択式の講評キャッシュを事前生成（LINE の即答用） | `npm run warm-cache -- --concurrency 1` |
| `preflight.ts` | 公開 URL の健全性チェック（health / OAuth / 静的アセット / 署名検証 / 認証ガード） | `npm run preflight -- https://<公開URL>` |
| `line-richmenu.ts` | Rich Menu の作成・適用（`APP_URL` が localhost なら中断する） | `npm run line:richmenu` |
| `line-richmenu-image.ts` | Rich Menu の背景画像 2500×1686 を生成 | `npx tsx scripts/line-richmenu-image.ts` |
| `line-howto-image.mts` | 友だち追加時に配る使い方画像 `public/line/howto.png` を生成 | `npx tsx scripts/line-howto-image.mts` |
| `brand-assets.ts` | ロゴ・OGP などのブランド素材 | `npx tsx scripts/brand-assets.ts` |
| `stock/gen_stock.mts` | 問題ストックの生成・検証（既定は Codex CLI） | `npx tsx scripts/stock/gen_stock.mts`（詳細は README） |
| `characters/gen_moods.mts` | キャラの表情差分 | `npx tsx scripts/characters/gen_moods.mts` |
| `dify/*.mts` | 教材ナレッジの書き出し・Dify への投入・カタログ拡充 | `npx tsx scripts/dify/upload_materials.mts --single` |

画像を作る 2 本は生成 AI ではなく SVG 合成（sharp）。日本語が崩れないためで、文言を変えたらスクリプトを編集して作り直す。
