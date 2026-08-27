# DEPLOY.md — Trivium を Sakura VPS + Coolify で公開する

前提:

- Sakura VPS / Ubuntu 24.04 / 4 vCPU / 4 GB RAM
- Coolify（self-hosted）がインストール済みで、ブラウザから管理画面に入れる
- GitHub の private repository `trivium-ai` にこのコードが push 済み
- ドメイン（例: `trivium.example.com`）の A レコードが VPS の IP を向いている

構成はシンプルです。**Coolify の中に PostgreSQL と Next.js アプリの 2 リソース**を作り、DB は内部ネットワークだけで繋ぎます。

```
Internet ──HTTPS──▶ Coolify(Traefik) ──▶ trivium (Next.js, Dockerfile)
                                              │ 内部ネットワーク
                                              ▼
                                        PostgreSQL 16（5432 は非公開）
```

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
4. 更新するとき: main に push → Actions 完了（約 4〜8 分）→ Coolify で **Redeploy**（pull だけなので数十秒）

イメージに焼き込まれる `NEXT_PUBLIC_APP_URL` は GitHub の repo Variables（`NEXT_PUBLIC_APP_URL`）から取る。
未設定でもサーバ側は実行時の `APP_URL` を優先するので、OAuth / LINE のリンクは正しく動く。

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
| `APP_URL` | ○ | `NEXT_PUBLIC_APP_URL` と同じ値。サーバ側はこちらを優先して読むので、Build Variable の設定漏れでもリダイレクト/LINE リンクが localhost にならない保険 | 不要（実行時） |
| `DATABASE_URL` | ○ | 1 章の内部接続文字列 | 不要（実行時のみ。ビルドは DB に触らない） |
| `AUTH_SECRET` | ○ | Auth.js のセッション署名鍵。`openssl rand -base64 32` で生成 | 不要 |
| `AUTH_TRUST_HOST` | ○ | `true`（Traefik 経由のため必須） | 不要 |
| `AUTH_GOOGLE_ID` | ○ | Google OAuth クライアント ID | 不要 |
| `AUTH_GOOGLE_SECRET` | ○ | Google OAuth クライアントシークレット | 不要 |
| `DEMO_LOGIN_ENABLED` | | デモ用フォールバックログイン。本番は `false` 推奨（Google が使えない緊急時のみ `true`） | 不要 |
| `DEMO_SEED_ENABLED` | | Dashboard の「デモデータ投入」ボタン。デモ当日は `true` | 不要 |
| `AI_PROVIDER` | | `dify` または `mock`。未設定は `dify`（キー未設定なら自動で mock） | 不要 |
| `DIFY_API_BASE` | | `https://api.dify.ai/v1` | 不要 |
| `DIFY_DOMAIN_API_KEY` | | Domain workflow の API key | 不要 |
| `DIFY_LEADER_API_KEY` | | Leader workflow の API key | 不要 |
| `DIFY_TIMEOUT_MS` | | 既定 20000 | 不要 |
| `LINE_CHANNEL_SECRET` | | LINE Messaging API のチャネルシークレット（署名検証に必須） | 不要 |
| `LINE_CHANNEL_ACCESS_TOKEN` | | 長期チャネルアクセストークン | 不要 |
| `NODE_ENV` | | Coolify が `production` を自動で入れる。手動設定不要 | — |

Coolify の環境変数画面では各行に **「Build Variable」** のチェックがあります。**チェックが必要なのは `NEXT_PUBLIC_APP_URL` だけ**です。秘密情報（`AUTH_*`, `DIFY_*`, `LINE_*`, `DATABASE_URL`）は Build Variable にしないでください（ビルドログ・イメージレイヤーに残る危険を避ける）。

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

アプリは Dify を **server-side からのみ**呼びます（`src/lib/ai/dify.ts`）。API key はブラウザに渡りません。Dify へ送る user 識別子は内部 ID（`learnerRef`）で、メールや氏名は送りません。

**Dify が未設定・障害のときは自動で Mock provider にフォールバック**するので、Dify 無しでもアプリ全体は動きます（`AI_PROVIDER=mock` で明示的に Mock 固定も可。`AI_PROVIDER=anthropic` なら Dify を介さず Claude API を直接呼びます）。

### 5.1 DSL をインポートする（推奨・5 分）

リポジトリの `dify/` に、そのまま取り込める Workflow アプリ定義が 2 本あります。

| ファイル | アプリ名 | 用途 | API key の環境変数 |
|---|---|---|---|
| `dify/trivium-domain.yml` | `trivium-domain` | READ/WRITE/CODE の回答評価＋一段ヒント（`workflow=domain`）と domain 寸評（`workflow=interpret`）。IF/ELSE で分岐 | `DIFY_DOMAIN_API_KEY` |
| `dify/trivium-leader.yml` | `trivium-leader` | 3 domain の要約から総合寸評・次のおすすめ | `DIFY_LEADER_API_KEY` |

手順:

1. Dify → **Studio → Import DSL file** → `dify/trivium-domain.yml` を選ぶ。同様に `dify/trivium-leader.yml` も取り込む
2. **モデルを差し替える** — DSL の既定は Anthropic（`langgenius/anthropic/anthropic` / `claude-sonnet-4-5`）です。ワークスペースで有効なプロバイダ・モデルに合わせて、各 LLM ノード（domain は「回答評価」「寸評生成」の 2 つ、leader は 1 つ）のモデルを選び直す。Anthropic プラグインが無ければインポート時に警告が出るので Marketplace から追加するか、OpenAI 等に変更する。温度 0.3 / max_tokens 1024 は据え置きでよい
3. 右上 **Publish** → **API Access** → **API Key** を発行し、Coolify の環境変数に `DIFY_DOMAIN_API_KEY` / `DIFY_LEADER_API_KEY` として登録。`DIFY_API_BASE` は Dify Cloud なら `https://api.dify.ai/v1`（self-hosted なら自前 URL）。`AI_PROVIDER=dify` にして再デプロイ
4. Dify の「実行」で試す: `workflow=domain`（`task` に JSON、`learner_answer` に誤答、`deterministic_result=incorrect`、`hint_level=0`）と `workflow=interpret`（`stats` と `recent_events` に JSON）の両方で、`result` に**コードフェンス無しの JSON** が入ることを確認

DSL は `dify/build_dsl.py` から生成され、`python dify/validate.py` で **Start 変数名が `src/lib/ai/dify.ts` の inputs と完全一致すること・End 出力が `result` であること・プロンプトの変数参照が存在すること**を検査しています（詳細は `dify/README.md`）。`dify.ts` の inputs や出力 schema を変えたら、生成スクリプトを直して再生成してください。

### 5.2 入力変数（参考: DSL に含まれている内容）

変数名はコード側（`src/lib/ai/dify.ts` の `run()` に渡す `inputs`）と**完全に一致**しています。`hint_level` と `total_events` は `Number`、それ以外は `String`（長文は Paragraph、max length 48000）です。

**trivium-domain**（`workflow` の値で IF/ELSE 分岐。`domain` → 回答評価、それ以外 → 寸評生成）

| 変数 | 内容 |
|---|---|
| `workflow` | `domain`（回答評価）または `interpret`（寸評生成） |
| `mode` | `read` / `write` / `code` |
| `policy` | システムポリシー 7 箇条（下記）。LLM ノードの System 先頭に展開 |
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
| `policy` | システムポリシー 7 箇条 |
| `domains` | 3 domain の要約 JSON 配列（domain, score, subskills, confidence, evidenceCount, summary, observations, recommendedNext, eventsLast7Days） |
| `total_events` | 学習記録の総数 |
| `last_event` | 直近の学習イベント JSON（domain, taskTitle, difficulty, success, hintCount, minutesAgo）。無ければ空文字 |
| `context` | 「10分だけ」などの文脈（無ければ空文字） |

### 5.3 出力（End ノード）

End ノードの出力変数名は **`result`** で、LLM の出力（JSON 文字列）をそのまま入れています。コード側は ```` ```json ```` のフェンスも剥がして解釈し、`result` / `output` / `text` / `json` のいずれか、または outputs 直下にフィールドが並ぶ形も受け付けます。

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

Studio → **Create from Blank → Workflow** で 5.2 の変数を Start に作り、IF/ELSE（`workflow` is `domain`）→ LLM 2 つ → End（出力変数 `result` に LLM の `text`）と繋ぎます。LLM の System には `{{#start.policy#}}` と「出力は JSON のみ・コードフェンス無し・キーは 5.3 のとおり」を明記し、User に各入力変数を見出し付きで並べてください。可能なら Dify の **JSON Schema 出力**を有効にします。

### 5.6 動作確認

Coolify のアプリログに `[ai] evaluate: dify failed, falling back to mock: ...` が出ていれば Dify 側の設定（変数名・key・出力形式・モデル）を見直してください。`/api/health` の `ai.lastUsed` が `dify` なら直近の呼び出しが Dify で成功しています。

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
   npm run line:richmenu
   ```
   - 2行×3列: 上段 `READ | WRITE | CODE`（Webへ）、下段 `今日の学習 | 履歴 | PROFILE`（postback）
   - 見た目を整えるなら `public/line/richmenu.png`（2500×1686）を置いてから再実行（無ければ単色画像を自動生成）
6. LINE user ID と Google アカウントは独立（`LineUser.userId` は将来の連携用で未使用）。LINE 側は「入口」に徹し、課題は Web で解く

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
4. CODE を 1 問解いて、learning event → profile → Leader 寸評が更新されることを確認

## 8. ロールバックとよくある失敗

| 症状 | 原因と対処 |
|---|---|
| 起動直後に落ちる。ログに `migrate deploy に失敗` | `DATABASE_URL` が違う / DB と別 Project / DB 未起動。`docker-entrypoint.sh` は migrate 失敗で exit 1 する仕様 |
| `UntrustedHost` エラーでログインできない | `AUTH_TRUST_HOST=true` を設定（コード側でも `trustHost: true` だが env も入れておく） |
| Google ログインで `redirect_uri_mismatch` | Google Cloud Console のリダイレクト URI が `https://<domain>/api/auth/callback/google` と 1 文字でも違う（`http`/`https`、末尾スラッシュ、`www`） |
| Google ログインで `access_denied`（アプリ未確認） | OAuth 同意画面が「テスト」のとき、テストユーザーに追加していないアカウント |
| ログインは通るが Dashboard が 500 | `AUTH_SECRET` 未設定、または DB 接続断。`/api/health` の `db` を見る |
| リンクが `http://localhost:3000` を向く | `NEXT_PUBLIC_APP_URL` を Build Variable にして**再ビルド**（実行時に変えても反映されない） |
| AI の返答が固定文っぽい | Mock provider にフォールバックしている。ログの `[ai]` 行と 5.5 章を確認 |

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
