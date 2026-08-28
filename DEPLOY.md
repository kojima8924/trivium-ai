# DEPLOY.md — Trivium を Sakura VPS + Coolify で公開する

前提:

- Sakura VPS / Ubuntu 24.04 / 4 vCPU / 4 GB RAM
- Coolify（self-hosted）がインストール済みで、ブラウザから管理画面に入れる
- GitHub の private repository `trivium-ai` にこのコードが push 済み
- ドメイン（例: `trivium.example.com`）の A レコードが VPS の IP を向いている

構成はシンプルです。**Coolify の中に PostgreSQL と Next.js アプリの 2 リソース**を作り、DB は内部ネットワークだけで繋ぎます。アプリのイメージは GitHub Actions がビルドして GHCR に置き、Coolify はそれを pull するだけです（2.5 章。VPS 上ではビルドしない）。

```
GitHub main ──push──▶ Actions（typecheck / test / Docker 実ビルド＋起動スモーク）──▶ ghcr.io/kojima8924/trivium-ai:latest
                                                                                        │ pull（Coolify API または UI の Redeploy）
Internet ──HTTPS──▶ Coolify(Traefik) ──▶ trivium (Next.js, Docker Image) ◀────────────┘
                                              │ 内部ネットワーク
                                              ▼
                                        PostgreSQL 16（5432 は非公開）
```

現在の本番: `https://trivium.153.126.213.251.sslip.io`（さくら VPS の IP を sslip.io で名前解決。DNS 設定不要）。

---

## 1. PostgreSQL リソースを作る（5432 を公開しない）

1. Coolify → **Projects** → 対象 Project → **+ New Resource** → **Databases** → **PostgreSQL**（16 系）
2. 名前を `trivium-db` などにする。ユーザー名 / パスワード / DB 名は Coolify が生成する（そのままで可）
3. **「Make it publicly available」は OFF のまま**にする（ポート公開しない。ここが本番の必須条件）
4. **Start** で起動
5. 画面の **Internal URL（内部接続文字列）** をコピーする。形はこうです:

   ```
   postgres://<user>:<password>@<コンテナ名>:5432/<db>
   ```

   これをアプリ側の `DATABASE_URL` に使います。末尾に `?schema=public` を付けても付けなくても動きます。

> 同じ Project / 同じサーバー内のリソースは Coolify の内部 Docker ネットワークで名前解決できます。アプリとDBを別 Project に作ると繋がらないので、**同じ Project に作る**こと。

## 2. GitHub repository を Coolify に接続する

1. Coolify → **Sources** → **+ Add** → **GitHub App** を作成し、GitHub 側で `trivium-ai` へのアクセスを許可する（private repo なので GitHub App 方式が必要）
2. Project → **+ New Resource** → **Application** → **Private Repository (with GitHub App)** → `trivium-ai` を選択、branch は `main`
3. **Build Pack** を **Dockerfile** にする（リポジトリ直下の `Dockerfile` が使われる）
4. **Ports Exposes** を `3000` にする
5. **Domains** に `https://trivium.example.com` を入れる（`https://` を付けると Let's Encrypt の証明書が自動発行される）
6. 保存後、**Environment Variables** を次章のとおり登録してから **Deploy**

### Health check

Coolify の Health Check 設定は Dockerfile 内の `HEALTHCHECK`（`/api/health`）をそのまま使えます。手動で設定する場合は:

- Path: `/api/health`
- Port: `3000`
- Start period: 40 秒程度（migrate + 起動時間）

`/api/health` は DB 疎通も確認するので、DB が落ちていると `503 degraded` になります。

## 2.5 【推奨】VPS 上でビルドせず、GitHub Actions が作ったイメージを pull する

4 vCPU / 4GB の VPS で Next.js を Docker ビルドすると、メモリ不足で Coolify ごと応答しなくなる（2026-08-27 に実際に発生。SSH のバナー交換すらタイムアウトした）。
**ビルドは GitHub Actions に任せ、Coolify は「Docker Image」として pull するだけ**にする。

1. main へ push すると `.github/workflows/docker.yml` の `publish` job が、スモークテスト通過後に
   `ghcr.io/kojima8924/trivium-ai:latest`（と `:<commit sha>`）を push する（GitHub の Packages。private）
2. VPS 側で一度だけ GHCR にログインする（Coolify は host の docker を使うので、この認証情報が pull に使われる）
   ```bash
   # GitHub → Settings → Developer settings → Personal access tokens（classic）で read:packages のみ付けたトークンを作る
   ssh root@<VPS IP>
   echo "<PAT>" | docker login ghcr.io -u kojima8924 --password-stdin
   ```
3. Coolify: プロジェクト → **+ New Resource → Docker Image** → Image に `ghcr.io/kojima8924/trivium-ai:latest`
   - Port: `3000`、Domains: `https://trivium.<VPS IP>.sslip.io`
   - 環境変数は 3 章と同じ（**Build Variable は不要**。`APP_URL` を必ず入れる）
   - 既存の「GitHub から Dockerfile ビルド」のリソースは **削除するか Stop** する（2 本同時に動かさない）
4. 更新するとき: main に push → Actions 完了（約 4〜8 分）→ Coolify で **Redeploy**（pull だけなので数十秒）。UI を開かずに API で行う手順は 2.6 章

イメージに焼き込まれる `NEXT_PUBLIC_APP_URL` は GitHub の repo Variables（`NEXT_PUBLIC_APP_URL`）から取る。
未設定でもサーバ側は実行時の `APP_URL` を優先するので、OAuth / LINE のリンクは正しく動く。

## 2.6 Coolify API でデプロイする（スマホからの指示だけで回す）

Coolify → **Keys & Tokens → API tokens** で read/write のトークンを作り、ローカルの `.env` に `COOLIFY_BASE_URL` / `COOLIFY_API_TOKEN` として置く（**値はコミットしない**。`.env` は gitignore 済み）。

```bash
# アプリ一覧（uuid を控える）
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" "$COOLIFY_BASE_URL/api/v1/applications" | jq '.[] | {uuid, name, fqdn, status}'

# 環境変数の一覧（キー名だけ見る）
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" "$COOLIFY_BASE_URL/api/v1/applications/<uuid>/envs" | jq '[.[].key]'

# 最新イメージを pull して再デプロイ（POST。GET は "changed to POST" と返る）
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" "$COOLIFY_BASE_URL/api/v1/deploy?uuid=<uuid>&force=true"
# → {"deployments":[{"message":"... deployment queued.","deployment_uuid":"..."}]}

# 進捗
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" "$COOLIFY_BASE_URL/api/v1/deployments/<deployment_uuid>" | jq '.status'
```

流れ: main に push → Actions の `Docker` workflow が success（`gh run watch`）→ 上の deploy を叩く → `/api/health` が `db:ok` → `npm run preflight -- <公開URL>`。

### VPS が固まったとき
- さくらの VPS コントロールパネルから **再起動**（Coolify・DB は docker volume に永続化されているので消えない）
- 復帰後、スワップを追加しておくと再発しにくい:
  ```bash
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

## 3. 環境変数

`.env.example` のキーと同じです。**実値はこのファイルにも repo にも書かない**でください。

| キー | 必須 | 用途 | Build Variable? |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | ○ | 公開 URL（`https://trivium.example.com`）。OAuth コールバック・LINE からの誘導リンクに使う | **○ 必要**（`NEXT_PUBLIC_` はビルド時にバンドルへ埋め込まれる。Dockerfile は `ARG NEXT_PUBLIC_APP_URL` で受ける） |
| `AUTH_URL` | ○ | 公開 URL（`APP_URL` と同じ値）。Traefik 越しだと Auth.js が `0.0.0.0:3000` を自分の URL と誤認し、Google の redirect_uri が壊れる。コードは `APP_URL` から自動補完するが、明示しておくのが確実 | 不要（実行時） |
| `APP_URL` | ○ | `NEXT_PUBLIC_APP_URL` と同じ値。サーバ側はこちらを優先して読むので、Build Variable の設定漏れでもリダイレクト/LINE リンクが localhost にならない保険 | 不要（実行時） |
| `DATABASE_URL` | ○ | 1 章の内部接続文字列 | 不要（実行時のみ。ビルドは DB に触らない） |
| `AUTH_SECRET` | ○ | Auth.js のセッション署名鍵。`openssl rand -base64 32` で生成 | 不要 |
| `AUTH_TRUST_HOST` | ○ | `true`（Traefik 経由のため必須） | 不要 |
| `AUTH_GOOGLE_ID` | ○ | Google OAuth クライアント ID | 不要 |
| `AUTH_GOOGLE_SECRET` | ○ | Google OAuth クライアントシークレット | 不要 |
| `DEMO_LOGIN_ENABLED` | | デモ用フォールバックログイン。本番は `false` 推奨（Google が使えない緊急時のみ `true`） | 不要 |
| `DEMO_LOGIN_SECRET` | | デモログインの合言葉。設定すると入力必須（一致すれば既存アカウントにも入れる＝発表者用）。未設定なら新規作成のみ | 不要 |
| `DEMO_SEED_ENABLED` | | Dashboard の「デモデータ投入」「初期状態に戻す」と `/api/demo/warm`（講評キャッシュ生成）。デモ当日は `true`、**恒久運用では `false`** | 不要 |
| `ADMIN_EMAILS` | | 管理者メール（カンマ区切り）。`/api/demo/warm` はこのアドレスでログインしたユーザーだけ実行でき、1 回 20 課題・ヒント 1 段・同時 1 本に制限される | 不要 |
| `AI_PROVIDER` | | `openai`（既定・推奨）/ `dify` / `anthropic` / `mock`。キー未設定なら自動で mock | 不要 |
| `OPENAI_API_KEY` | ○ | OpenAI API キー（`AI_PROVIDER=openai` のとき。講評・寸評・ADVISOR・作問をすべて OpenAI Responses API で行う） | 不要 |
| `OPENAI_MODEL` | | 役割指定の無い呼び出しの予備（既定 `gpt-5.4-mini`）。**実際に使うモデルは `src/config/trivium.config.ts` の `MODELS`**（採点・寸評・会話 `gpt-5.4-mini`、作問 `gpt-5.5`）で決まる | 不要 |
| `OPENAI_TIMEOUT_MS` | | 既定 25000 | 不要 |
| `DIFY_API_BASE` | | `https://api.dify.ai/v1`（`AI_PROVIDER=dify` のとき） | 不要 |
| `DIFY_DOMAIN_API_KEY` | | `trivium-domain` workflow の API key（回答評価・寸評） | 不要 |
| `DIFY_LEADER_API_KEY` | | `trivium-leader` workflow の API key（総合寸評） | 不要 |
| `DIFY_GENERATE_API_KEY` | | `trivium-generate` workflow の API key（作問。無ければ作問だけ定型問題にフォールバック） | 不要 |
| `DIFY_CHAT_API_KEY` | | `trivium-chat`（統合 Chatflow）のアプリ API key。**LINE の会話だけ Dify 経由**にするときに使う（`AI_PROVIDER` は `openai` のままでよい） | 不要 |
| `LINE_CHAT_VIA_DIFY` | | `true` で LINE の会話を統合 Chatflow に流す（既定 `false`）。キーが無い・Dify が失敗したときは自動で OpenAI 直呼び出しにフォールバック | 不要 |
| `DIFY_TIMEOUT_MS` | | 既定 20000（Web 検索を挟む作問は 10 秒以上かかるので 30000 推奨） | 不要 |
| `TRIVIUM_AGENT_TOKEN` | | Dify の Chatflow（4 人格 + 教材おすすめ）が `GET /api/agent/context` で人格・能力値・出題中の課題を読むためのサーバ間トークン。`openssl rand -base64 32` で生成し、Dify 側の環境変数にも同じ値を入れる。未設定ならこの API は 503（アプリ本体は影響なし） | 不要 |
| `CRON_TOKEN` | | デイリーミッションのリマインダー（`POST /api/cron/reminder`）の Bearer トークン。`openssl rand -base64 32` で生成し、**同じ値を GitHub の Secrets `CRON_TOKEN` にも入れる**（下の 11 章）。未設定ならこの API は 503（リマインダーが飛ばないだけ） | 不要 |
| `LINE_CHANNEL_SECRET` | | LINE Messaging API のチャネルシークレット（署名検証に必須） | 不要 |
| `LINE_CHANNEL_ACCESS_TOKEN` | | 長期チャネルアクセストークン | 不要 |
| `NODE_ENV` | | Coolify が `production` を自動で入れる。手動設定不要 | — |

Coolify の環境変数画面では各行に **「Build Variable」** のチェックがあります。**チェックが必要なのは `NEXT_PUBLIC_APP_URL` だけ**です。秘密情報（`AUTH_*`, `OPENAI_*`, `DIFY_*`, `LINE_*`, `DATABASE_URL`）は Build Variable にしないでください（ビルドログ・イメージレイヤーに残る危険を避ける）。

## 4. Google OAuth の設定

1. [Google Cloud Console](https://console.cloud.google.com/) → プロジェクトを作成（または選択）
2. **APIs & Services → OAuth 同意画面**: User Type = External、アプリ名「Trivium」、サポートメールを入力。スコープは `openid` / `email` / `profile` のみ。テスト段階なら **テストユーザー**にデモで使う Google アカウントを追加する（公開ステータスが「テスト」のままだと、登録したユーザー以外はログインできません）
3. **認証情報 → 認証情報を作成 → OAuth クライアント ID** → アプリケーションの種類 = **ウェブ アプリケーション**
4. **承認済みの JavaScript 生成元**: `https://trivium.example.com`
5. **承認済みのリダイレクト URI**: `https://trivium.example.com/api/auth/callback/google`
   - ローカル開発用に `http://localhost:3000/api/auth/callback/google` も追加しておくと便利
6. 発行されたクライアント ID / シークレットを Coolify の `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` に登録

保存する個人情報は「表示名・メール・アイコン URL」だけです（`prisma/schema.prisma` の `User`）。

## 5. Dify Cloud（Sandbox）の設定

アプリの AI レイヤーは `AI_PROVIDER` で切り替えます。既定は **`openai`**（`src/lib/ai/openai.ts` が OpenAI Responses API を直接呼ぶ。設定は `OPENAI_API_KEY` だけ）。Dify を使うのは「プロンプトを Dify の UI で調整したい」「Web 検索などのノードを足したい」場合で、**LLM は Dify 側も OpenAI に統一**しています。

Dify は **server-side からのみ**呼びます（`src/lib/ai/dify.ts`）。API key はブラウザに渡りません。Dify へ送る user 識別子は内部 ID（`learnerRef`）で、メールや氏名は送りません。**Dify が未設定・障害のときは自動で Mock provider にフォールバック**するので、Dify 無しでもアプリ全体は動きます。

### 5.1 DSL をインポートする（推奨・10 分）

リポジトリの `dify/` に、そのまま取り込めるアプリ定義が **4 本**あります（`dify/build_dsl.py` から生成。詳細は `dify/README.md`）。

| ファイル | アプリ名 | 用途 | ノード構成 | API key の環境変数 |
|---|---|---|---|---|
| `dify/trivium-domain.yml` | `trivium-domain` | 回答評価＋一段ヒント（`workflow=domain`）／domain 寸評（`workflow=interpret`） | Start → IF/ELSE → LLM×2 → End | `DIFY_DOMAIN_API_KEY` |
| `dify/trivium-leader.yml` | `trivium-leader` | 3 domain の要約から総合寸評・次のおすすめ | Start → **現在日時**（組み込み time ツール, Asia/Tokyo）→ LLM → End | `DIFY_LEADER_API_KEY` |
| `dify/trivium-generate.yml` | `trivium-generate` | 依頼文（「論理パズルを 1 問」等）から課題を作る | Start → IF/ELSE(`use_search`) → [true] code → **HTTP（OpenAI Responses + web_search）** → code → LLM → End ／ [false] LLM → End | `DIFY_GENERATE_API_KEY` |
| `dify/trivium-chat.yml` | `trivium-chat` | **Chatflow**。4 人格（ヨミ/フミ/ロゴス/ミチ）の会話と教材おすすめを 1 本で。文脈は 1 conversation で共有 | Start → **HTTP `GET /api/agent/context`** → code → IF/ELSE → [true] assigner ／ [false] **question-classifier** → assigner×4 or **knowledge-retrieval** → LLM×2 → Answer×2 | `DIFY_CHAT_API_KEY` |

手順:

1. Dify → **設定 → モデルプロバイダー** で **OpenAI** を有効化し API キーを登録（LLM ノードはすべて `langgenius/openai/openai`）
2. **Studio → Import DSL file** で 4 本を順に取り込む。各 LLM ノードのモデル既定は `gpt-5.4-mini`（アプリ側の `OPENAI_MODEL` と同じ）。ワークスペースで選べなければ使えるモデルに差し替える
3. `trivium-generate` を開き、**環境変数 `OPENAI_API_KEY`（secret）** を実際のキーに差し替える（Web 検索の HTTP ノードが `Authorization: Bearer` に使う。DSL には `sk-REPLACE_ME` が入っている）
4. `trivium-leader` の「現在日時」ノードは Dify 組み込みの `time` ツール（認証不要）。インポート時に警告が出たらノードを開いて保存し直す
5. **`trivium-chat`（Chatflow）の設定** — この 3 つをやらないと会話が既定値で動く／教材が出ない:
   - 環境変数 `TRIVIUM_API_BASE` を公開 URL（例 `https://trivium.153.126.213.251.sslip.io`）に、`TRIVIUM_AGENT_TOKEN`（secret）を Coolify の `AGENT_API_TOKEN` と**同じ値**に差し替える
   - ノード「**教材ナレッジ検索**」を開き、ナレッジ **`trivium-materials`**（5.6 で投入）を選ぶ。`dataset_ids` は環境ごとに違うので DSL には入れていない
   - ノード「相談先の判定」（question-classifier）のモデルを確認する
6. 右上 **Publish** → **API Access** → **API Key** を 4 本それぞれ発行し、Coolify の環境変数に `DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` / `DIFY_GENERATE_API_KEY` / `DIFY_CHAT_API_KEY` として登録。`DIFY_API_BASE` は Dify Cloud なら `https://api.dify.ai/v1`
   - **LINE の会話だけ Dify 経由にする**（推奨）: `AI_PROVIDER=openai` のまま `DIFY_CHAT_API_KEY` と `LINE_CHAT_VIA_DIFY=true` を設定して Restart。評価・寸評・作問・意図判定は速い OpenAI 直呼び出しのまま、会話（人格・教材おすすめ）だけ統合 Chatflow を通る。Dify が落ちても自動で OpenAI にフォールバックする
   - **全部 Dify 経由にする**: `AI_PROVIDER=dify` にして Restart（評価・作問も Workflow を通るため遅くなる）
   - 疎通確認: `npx tsx --conditions=react-server scripts/dev/dify-chat-check.ts "読解を伸ばせる本を教えて"`。`/api/health` の `dify.chat` が `on` なら LINE の会話が Chatflow 経由
7. **Chatflow の動作確認** — 「デバッグとプレビュー」で `learner_ref` に実在の userId を入れて: 「僕の能力は？」→ ミチが集計値を踏まえて答える／`addressed_agent=CODE` で「さっきの問題のヒント」→ ロゴスが答えを言わずに一段だけ導く／「読解を伸ばす本は？」→ ナレッジの候補から 3 件（候補外の書名が出ないこと）
8. Workflow 3 本は Dify の「実行」で試す:
   - domain: `workflow=domain`、`task` に JSON、`learner_answer` に誤答、`deterministic_result=incorrect`、`hint_level=0` → `result` に `status: "retry"` の JSON
   - leader: `workflow=leader`、`domains` に JSON 配列、`total_events=23` → `summary` に「今日/今週」の言葉が入る
   - generate: `workflow=generate`、`request=論理パズルを1問`、`domain=CODE`、`kind=choice`、`difficulty=3`、`allowed_skill_tags=tracing,debugging,algorithms,design`、`use_search=false` → 4 択の JSON。`use_search=true`＋`request=最近のニュースで読解を1問`、`domain=READ` で検索経由も確認
   いずれも `result` に**コードフェンス無しの JSON** が入ること

`python dify/validate.py` が **Start 変数名 = `src/lib/ai/dify.ts` の inputs キー（完全一致）・End 出力が `result`・LLM が OpenAI・環境変数の宣言・code ノードの入出力**を検査しています（Chatflow は `advanced-chat` / Answer ノード / classifier の class とエッジ / 会話変数と env の宣言 / ナレッジ id を焼き込んでいないこと、を別途検査）。`dify.ts` の inputs や出力 schema を変えたら、`dify/build_dsl.py` を直して再生成してください。

### 5.2 入力変数（参考: DSL に含まれている内容）

変数名はコード側（`src/lib/ai/dify.ts` の `run()` に渡す `inputs`）と**完全に一致**しています。`hint_level` / `total_events` / `difficulty` は `Number`、それ以外は `String`（長文は Paragraph、max length 48000）。3 本とも共通で `policy`（システムポリシー 7 箇条）と `persona`（AI の人格 JSON。空なら既定の口調）を受け取ります。

**trivium-domain**（`workflow` の値で IF/ELSE 分岐。`domain` → 回答評価、それ以外 → 寸評生成）

| 変数 | 内容 |
|---|---|
| `workflow` | `domain`（回答評価）または `interpret`（寸評生成） |
| `mode` | `read` / `write` / `code`（code の表示名は LOGIC） |
| `policy` | システムポリシー 7 箇条。LLM ノードの System 先頭に展開 |
| `persona` | `{name, tone, firstPerson, extra}` の JSON（無ければ空文字） |
| `task` | 課題の JSON（id, title, passage, prompt, kind, choices, difficulty, criteria, hints） |
| `learner_answer` | 学習者の回答 |
| `deterministic_result` | `correct` / `incorrect` / `unknown`（決定論採点の結果。`unknown` は自由記述） |
| `heuristic_result` | `meets_rubric` / `below_rubric` / `n/a`（自由記述のルーブリック簡易判定。AI の参考情報） |
| `hint_level` | これまでに出したヒント数 |
| `current_domain_profile` | domain profile の JSON（score, subskills, confidence, evidenceCount, summary） |
| `recent_behavior` | 直近の学習行動（改行区切り） |
| `stats` | （interpret 用）集計値 JSON |
| `recent_events` | （interpret 用）直近イベント JSON |

**trivium-leader**

| 変数 | 内容 |
|---|---|
| `workflow` | 常に `leader` |
| `policy` / `persona` | 上と同じ（persona は ADVISOR＝内部キー LEADER の人格） |
| `domains` | 3 domain の要約 JSON 配列（domain, score, subskills, confidence, evidenceCount, summary, observations, recommendedNext, eventsLast7Days） |
| `total_events` | 学習記録の総数 |
| `last_event` | 直近の学習イベント JSON（domain, taskTitle, difficulty, success, hintCount, minutesAgo）。無ければ空文字 |
| `context` | 「10分だけ」などの文脈（無ければ空文字） |

現在日時は Start ではなく、ワークフロー内の `time` ツールノード（`{{#now.text#}}`）から LLM に渡ります。

**trivium-generate**

| 変数 | 内容 |
|---|---|
| `workflow` | 常に `generate` |
| `policy` / `persona` | 上と同じ（persona はその domain の人格） |
| `request` | 学習者の依頼文（LINE の自由文や Web の入力欄） |
| `domain` | `READ` / `WRITE` / `CODE`（アプリ側が依頼文から決定論で推定。LLM に決めさせない） |
| `kind` | `choice` / `short` / `free` |
| `difficulty` | 1〜10（系統ごとの難易度） |
| `allowed_skill_tags` | その domain の subskill 名（カンマ区切り。skill_tags はここから選ぶ） |
| `recent_titles` | 直近の生成課題タイトル（改行区切り。同じ題材を避ける） |
| `use_search` | `true` のとき Web 検索を挟む（依頼文に「ニュース / 時事 / 最近の / 話題 / 最新」等があるときだけアプリ側が `true` にする） |

### 5.3 出力（End ノード）

End ノードの出力変数名は **`result`** で、LLM の出力（JSON 文字列）をそのまま入れています。コード側は ````json` のフェンスも剥がして解釈し、`result` / `output` / `text` / `json` のいずれか、または outputs 直下にフィールドが並ぶ形も受け付けます。

期待する JSON（`src/lib/ai/dify.ts` の zod schema と対応。DSL の System プロンプトにも同じキーを明記済み）:

`workflow = domain`（回答評価）
```json
{
  "status": "success | retry | needs_more",
  "feedback": "学習者への短いフィードバック（答えは書かない）",
  "hint": "一段だけのヒント（success のときは空）",
  "observations": ["学習行動についての観察（性格ではなく行動）"],
  "skill_tags": ["tracing"],
  "recommended_next_difficulty": 3
}
```
※ `deterministic_result` が `correct` / `incorrect` のときは、コード側で `status` をその結果に強制します（LLM の気分で正誤が変わらない安全弁）。

`workflow = interpret`（domain 寸評）
```json
{
  "summary": "その domain の短い寸評",
  "observations": ["..."],
  "recommended_next": "次のおすすめ課題（1 文）"
}
```

`workflow = leader`
```json
{
  "summary": "総合寸評",
  "interests": ["..."],
  "preferences": { "practiceFocus": "CODE" },
  "observations": ["..."],
  "recommendation": "次のおすすめ（1 文）",
  "recommended_domain": "READ | WRITE | CODE"
}
```

`workflow = generate`（13 キーすべて必須。該当しない項目は空配列・空文字・-1・0）
```json
{
  "title": "推論: 条件から順番を決める",
  "passage": "本文・状況・コード（無ければ空）",
  "prompt": "設問",
  "choices": ["A", "B", "C", "D"],
  "answer_index": 1,
  "short_answers": [],
  "rubric_must_include": [],
  "rubric_criteria": [],
  "rubric_min_length": 0,
  "rubric_max_length": 0,
  "hints": ["問い返し", "一段目", "二段目（答えは書かない）"],
  "explanation": "解説（答えを含んでよい）",
  "skill_tags": ["tracing"]
}
```
※ `kind=choice` なのに `choices` が 4 件でない／`answer_index` が 0〜3 でない場合、コード側は例外にして Mock の定型問題へフォールバックします。

### 5.4 システムポリシー

`policy` 変数として毎回渡しています（`src/lib/ai/types.ts` の `AI_SYSTEM_POLICY`）。DSL 側にコピーは持たず、`{{#start.policy#}}` として System の先頭に展開します。

```
1. Never complete the learner's task for them unless explicitly entering an answer-review phase.
2. Give at most one useful hint at a time.
3. Prefer questions over answers.
4. Adapt to previous learner responses.
5. Do not infer traits unsupported by learning evidence.
6. Comment on learning behavior, not personality.
7. If evidence is insufficient, explicitly state uncertainty.
```

### 5.5 DSL が使えない場合（手作り）

Studio → **Create from Blank → Workflow** で 5.2 の変数を Start に作り、domain は IF/ELSE（`workflow` is `domain`）→ LLM 2 つ → End（出力変数 `result` に LLM の `text`）、leader は `time` ツール → LLM → End、generate は IF/ELSE（`use_search` is `true`）→（code → HTTP → code →）LLM → End と繋ぎます。LLM の System には `{{#start.policy#}}` と「出力は JSON のみ・コードフェンス無し・キーは 5.3 のとおり」を明記し、User に各入力変数を見出し付きで並べてください。可能なら Dify の **JSON Schema 出力**を有効にします。

### 5.6 教材ナレッジ（ADVISOR の教材推薦）

1. アプリ内の教材カタログ `src/lib/materials/catalog.ts`（定番書・公式サイト 145 件）を `npx tsx scripts/dify/export_materials.mts` で `dify/materials/*.md` に書き出す（1 教材 1 ファイル。手動アップロードなら `--single` で `ALL.md`）
2. Dify → **ナレッジ → API** でナレッジ用 API キーを発行し、`.env` に `DIFY_DATASET_API_KEY`（と必要なら `DIFY_BASE_URL`）を設定
3. `npx tsx scripts/dify/upload_materials.mts --dry-run` で内容を確認 → `--dry-run` を外して投入（Dataset `trivium-materials` を自動作成し、id を表示。以後は `DIFY_MATERIALS_DATASET_ID` に入れると同じ Dataset を上書き更新）
4. Coolify の環境変数にも `DIFY_DATASET_API_KEY` / `DIFY_MATERIALS_DATASET_ID` / `DIFY_BASE_URL` を登録して Restart。未設定でもアプリ内カタログだけで推薦は動く（Dify は「ナレッジ検索のスコア」を加える追加情報源）
5. カタログを更新したら 1 と 3 をやり直す（既存ドキュメントは教材 id で照合して上書き）

**無料プラン（Sandbox）の場合**: ドキュメント数の上限が小さく、UI からは 1 ファイルずつしか上げられないので、**145 教材を 1 ファイルにまとめて 1 回で投入**します。

```bash
npx tsx scripts/dify/export_materials.mts --single   # dify/materials/ALL.md（145 教材・約 58,000 字）を書き出す
npx tsx scripts/dify/upload_materials.mts --single   # API で 1 ドキュメントとして投入（区切り線でチャンク分割）
```

API を使わず UI から入れる場合は、ナレッジ作成 → `dify/materials/ALL.md` を 1 つだけアップロード →
**チャンク設定を「カスタム」にして、区切り記号を `

---

`、最大チャンク長 1000** にしてください（1 教材 = 1 チャンクになります）。
チャンク内に `- id: <教材 id>` が入っているので、アプリ側はセグメント本文から教材を特定できます（ドキュメント名には依存しません）。

### 5.7 動作確認

Coolify のアプリログに `[ai] evaluate: dify failed, falling back to mock: ...` が出ていれば Dify 側の設定（変数名・key・出力形式・モデル）を見直してください。`/api/health` の `ai.lastUsed` が `dify` なら直近の呼び出しが Dify で成功しています。`ai.lastError` に直近の失敗理由（鍵は伏字）が出ます。

## 6. LINE 公式アカウント

1. [LINE Developers](https://developers.line.biz/) でプロバイダー → **Messaging API チャネル**を作成
2. 「Messaging API設定」で以下を取得し、Coolify の環境変数に設定（実値はコミットしない）
   - `LINE_CHANNEL_SECRET` … チャネル基本設定の「チャネルシークレット」
   - `LINE_CHANNEL_ACCESS_TOKEN` … 「チャネルアクセストークン（長期）」を発行
3. **Webhook URL** に `https://<公開ドメイン>/api/line/webhook` を設定し「Webhookの利用」を ON → 「検証」で 200 を確認
   - 署名検証は必須実装済み（`x-line-signature` が無い／不一致は 401、secret 未設定は 503）
4. LINE Official Account Manager（応答設定）で **応答メッセージ: OFF**、**Webhook: ON**（あいさつメッセージも OFF 推奨。follow 時は Webhook が歓迎文を返す）
5. Rich Menu を作成（`NEXT_PUBLIC_APP_URL` を公開URLにしてから、ローカルの開発環境で実行）
   ```bash
   NEXT_PUBLIC_APP_URL=https://<本番URL> npm run line:richmenu  # ← ボタンのリンク先が焼き込まれるので、必ず本番 URL を渡す（.env の localhost のままだと Dashboard ボタンが localhost:3000 になる）
   ```
   - 2行×3列: 上段 `READ | WRITE | LOGIC`（postback。LINE 上でその系統の選択式を 1 問）、下段 `使い方 | Dashboard | PROFILE`（使い方＝案内と `/guide` へのボタン、Dashboard＝メインサイトへ、PROFILE＝Flex カード）
   - 画像は `public/line/richmenu.png`（`npx tsx scripts/line-richmenu-image.ts` で再生成）。本番に反映するときは `APP_URL=<公開URL> NEXT_PUBLIC_APP_URL=<公開URL> npm run line:richmenu`（新しいメニューを作って既定にする。古いものは LINE API で削除）
6. LINE と Google アカウントは「連携」で紐づく（`LineUser.userId`。ワンタイム URL・単回・15 分）。未連携でも会話と Web への誘導は動くが、**出題・記録・人格の記憶は連携が必要**

### 6.1 ローカルで Webhook を検証する

```bash
# 別ポートで起動（テスト用シークレット）
LINE_CHANNEL_SECRET=testsecret LINE_CHANNEL_ACCESS_TOKEN=dummy npx next dev -p 3100

# 署名付きリクエスト（本文はファイル経由にする。シェル変数に日本語を入れると署名が合わない）
printf '%s' '{"destination":"x","events":[{"type":"message","mode":"active","timestamp":0,"webhookEventId":"1","deliveryContext":{"isRedelivery":false},"replyToken":"dummy","source":{"type":"user","userId":"Utest0001"},"message":{"id":"1","type":"text","text":"10分だけ"}}]}' > body.json
SIG=$(openssl dgst -sha256 -hmac testsecret -binary body.json | base64)
curl -s -w ' %{http_code}
' -X POST -H 'Content-Type: application/json' -H "x-line-signature: $SIG" --data-binary @body.json http://localhost:3100/api/line/webhook
# → {"ok":true,"handled":1} 200（dummy token のため LINE への返信自体はログに 401 が出るが正常）
# 署名なし/不正なら 401
```

## 7. デプロイ後の確認

1. `https://trivium.example.com/api/health` → `{"status":"ok","db":"ok",...}` が返る
2. トップページ → Google でログイン → Dashboard が表示される（別ブラウザ/端末で同じ Google アカウントでログインしても同じプロフィールが出る）
3. Dashboard の **デモデータを投入**（`DEMO_SEED_ENABLED=true` のとき）で三角形が埋まる
   - CLI から入れる場合はコンテナ内で `npm run seed:demo -- --email <ログインしたメール>`（Coolify の Terminal 機能）。ただし standalone イメージには `tsx` が無いので、基本は Dashboard のボタンを使う
4. LOGIC（`/learn/logic`）を 1 問解いて、learning event → 到達レベル・XP → ADVISOR 寸評が更新されることを確認
5. LINE で「連携」→ 連携後に Rich Menu「今日の学習」で選択式が届き、答えると記録が付くことを確認

## 8. ロールバックとよくある失敗

| 症状 | 原因と対処 |
|---|---|
| 起動直後に落ちる。ログに `migrate deploy に失敗` | `DATABASE_URL` が違う / DB と別 Project / DB 未起動。`docker-entrypoint.sh` は migrate 失敗で exit 1 する仕様 |
| `UntrustedHost` エラーでログインできない | `AUTH_TRUST_HOST=true` を設定（コード側でも `trustHost: true` だが env も入れておく） |
| Google ログインで `redirect_uri_mismatch` | Google Cloud Console のリダイレクト URI が `https://<domain>/api/auth/callback/google` と 1 文字でも違う（`http`/`https`、末尾スラッシュ、`www`） |
| Google ログインで `access_denied`（アプリ未確認） | OAuth 同意画面が「テスト」のとき、テストユーザーに追加していないアカウント |
| ログインは通るが Dashboard が 500 | `AUTH_SECRET` 未設定、または DB 接続断。`/api/health` の `db` を見る |
| リンクが `http://localhost:3000` を向く | `NEXT_PUBLIC_APP_URL` を Build Variable にして**再ビルド**（実行時に変えても反映されない） |
| AI の返答が固定文っぽい／数秒で返る | Mock provider にフォールバックしている。`/api/health` の `ai.lastUsed` と `ai.lastError`（鍵は伏字）を見る。環境変数を直したら **Restart** しないと反映されない |
| Google の redirect_uri が `https://0.0.0.0:3000/...` になる | `AUTH_URL`（または `APP_URL`）が未設定。公開 URL を入れて Restart |

**ロールバック**: Coolify のアプリ画面 → **Deployments** から直前の成功デプロイを選んで **Redeploy**。DB の migration は前方互換（追加のみ）で作っているので、アプリだけ戻しても動きます。破壊的 migration を入れた場合は事前に Coolify の DB バックアップ機能でスナップショットを取ってください。

## 9. ローカルで同じイメージを試す（任意）

> 注意: このリポジトリの開発機（Windows）は WSL 未導入のため Docker Desktop が起動しません。
> ローカルで試せない場合は、10 章の CI（GitHub Actions）でのビルド検証結果を参照してください。

```bash
npm run docker:build
docker run --rm -p 3000:3000 --env-file .env trivium
```

`.env` の `DATABASE_URL` はコンテナから見えるホスト（`host.docker.internal` など）に読み替えてください。

## 10. イメージの実地検証（CI で毎回自動実行）

このリポジトリの `.github/workflows/docker.yml` が、push のたびに **Coolify と同じ Dockerfile** を
GitHub Actions 上でビルドし、PostgreSQL を立てて**実際にコンテナを起動**して確認します。
ローカル（Windows）は WSL 未導入で Docker Desktop が動かないため、ここが唯一の実地検証です。

CI が確認していること:

1. `docker build`（4 ステージ）が通る
2. `docker-entrypoint.sh` の `prisma migrate deploy` が成功し、テーブルが実際に作られる
   （`User` / `LearningEvent` / `DomainProfile` / `LeaderProfile` / `TaskAttempt` / `LineUser` / `Achievement` の存在を SQL で検証）
3. `/api/health` が 200 かつ `"db":"ok"` を返す
4. `public/` と app icon が配信される（`.dockerignore` の除外ミス検知）
5. トップページがレンダリングされる

### 実測値（2026-08-27 / GitHub Actions ubuntu-latest, 4 vCPU 相当）

| 項目 | 実測 |
|---|---|
| イメージサイズ | **518 MiB**（543,225,335 bytes） |
| ビルド時間（キャッシュ無し） | 約 **7 分 34 秒** |
| ビルド時間（GHA キャッシュあり） | 約 **3 分 33 秒** |
| コンテナ起動 → `/api/health` が `db:ok` | **3 秒以内**（`migrate deploy` 込み） |
| ヘルスチェック実応答 | `{"status":"ok","db":"ok","ai":{"provider":"mock","lastUsed":"mock"},"latencyMs":85}` |

> イメージが 518 MiB あるのは `node:22-bookworm-slim` に加えて、
> Prisma のクエリエンジンと `migrate deploy` 用の隔離 CLI（`/app/prisma-cli`）を同梱しているためです。
> 4 GB RAM の VPS で問題になるサイズではありませんが、削るなら Prisma CLI を
> 「初回デプロイ時だけ手で流す」運用に変えるのが最も効きます。

### Coolify 側で気をつける点（実地検証で分かったこと）

- 起動時に `DATABASE_URL` が無いと **entrypoint が exit 1 して起動しない**（黙って起動しないのではなくログに理由が出る）
- migration は起動のたびに `migrate deploy` される。追加のみの migration なので再デプロイで壊れない
- `AI_PROVIDER=mock`（または Dify 未設定）でも `/api/health` は `ok` を返す。AI の状態は `ai.lastUsed` で見る

---

## 11. デイリーミッションのリマインダー（GitHub Actions の cron）

「1 日 3 問（READ / WRITE / LOGIC を 1 問ずつ）」がまだ終わっていない人に、設定した時刻に ADVISOR（ミチ）が LINE で一声かけます。
サーバ内にスケジューラを持たず、**GitHub Actions が 30 分ごとに本番の API を叩くだけ**の構成です。

```
GitHub Actions（cron "0,30 * * * *"）──POST /api/cron/reminder──▶ 本番アプリ ──push──▶ LINE
                    Authorization: Bearer CRON_TOKEN        誰に送るかはアプリ側が判断
```

### 設定手順

1. トークンを作る（`openssl rand -base64 32`）
2. **Coolify** → アプリの Environment Variables に `CRON_TOKEN` を追加 → Restart
3. **GitHub** → repo の Settings → Secrets and variables → Actions
   - **Secrets** タブ → New repository secret → `CRON_TOKEN`（Coolify と同じ値）
   - **Variables** タブ → `APP_URL`（例 `https://trivium.153.126.213.251.sslip.io`）。未設定なら workflow 内の既定値を使う
4. Actions タブ → **Reminder** → *Run workflow* で手動実行し、`{"slot":"…","sent":0,…}` が返ることを確認

### 送信条件（すべて満たしたときだけ 1 通）

| 条件 | 判定 |
|---|---|
| LINE 連携済み | `LineUser.userId` がある |
| リマインダー ON | `/settings` の「LINE の通知」（既定 ON） |
| 時刻が一致 | 設定時刻（JST・30 分刻み、既定 20:00）が今の枠と一致 |
| 今日まだ送っていない | `preferences.notify.lastReminderDay` が今日でない |
| ミッション未達成 | 今日の記録が 3 系統そろっていない |

`sent` / `skipped` / `failed` を JSON で返します。1 回の実行で最大 200 人、個別の失敗は握って続行します。
`CRON_TOKEN` 未設定なら 503 を返し、workflow も失敗扱いにしません（機能を止めたいときは Secrets を消すだけでよい）。

### 通知設定（`/settings` の「LINE の通知」）

- **デイリーミッションのリマインダー**（ON/OFF）と**時刻**（JST・30 分刻み）
- **今日の総評を受け取る**（3 系統そろった日の ADVISOR 総評・XP・今日の 1 冊）

保存先は `LeaderProfile.preferences.notify`（migration 不要）。「初期状態に戻す」でも消えません。
