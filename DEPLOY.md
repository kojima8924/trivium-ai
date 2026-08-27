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

## 3. 環境変数

`.env.example` のキーと同じです。**実値はこのファイルにも repo にも書かない**でください。

| キー | 必須 | 用途 | Build Variable? |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | ○ | 公開 URL（`https://trivium.example.com`）。OAuth コールバック・LINE からの誘導リンクに使う | **○ 必要**（`NEXT_PUBLIC_` はビルド時にバンドルへ埋め込まれる） |
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

**Dify が未設定・障害のときは自動で Mock provider にフォールバック**するので、Dify 無しでもアプリ全体は動きます（`AI_PROVIDER=mock` で明示的に Mock 固定も可）。

### 5.1 Workflow アプリを 2 つ作る

Dify → Studio → **Create from Blank → Workflow**。

| アプリ | 用途 | API key の環境変数 |
|---|---|---|
| `trivium-domain` | READ/WRITE/CODE の回答評価 + 一段ヒント、および domain 寸評 | `DIFY_DOMAIN_API_KEY` |
| `trivium-leader` | 3 domain の要約から総合寸評・次のおすすめ | `DIFY_LEADER_API_KEY` |

各アプリの **Publish → API Access → API Key** を発行して Coolify に登録します。`DIFY_API_BASE` は Dify Cloud なら `https://api.dify.ai/v1`。

### 5.2 入力変数（Start ノード）

変数名はコード側（`src/lib/ai/dify.ts` の `run()` に渡す `inputs`）と**完全に一致**させます。すべて `String`（`hint_level`, `total_events` は `Number` でも可）で、長文が入るものは max length を十分に大きく（例: 4000 以上）してください。

**trivium-domain**（`workflow` の値で 2 種類の呼び出しを分岐します。IF/ELSE ノードで `workflow == "domain"` / `"interpret"` を分けるか、1 つの LLM ノードで両方を扱う）

| 変数 | 内容 |
|---|---|
| `workflow` | `domain`（回答評価）または `interpret`（寸評生成） |
| `mode` | `read` / `write` / `code` |
| `policy` | システムポリシー 7 箇条（下記）。LLM ノードの System に埋め込む |
| `task` | 課題の JSON（id, title, passage, prompt, kind, choices, difficulty, criteria, hints） |
| `learner_answer` | 学習者の回答 |
| `deterministic_result` | `correct` / `incorrect` / `unknown`（決定論採点の結果。`unknown` は自由記述） |
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
| `context` | 「10分だけ」などの文脈（無ければ空文字） |

### 5.3 出力（End ノード）

End ノードの出力変数名は **`result`** とし、LLM の出力（JSON 文字列）をそのまま入れます。コード側は ```` ```json ```` のフェンスも剥がして解釈し、`result` / `output` / `text` / `json` のいずれか、または outputs 直下にフィールドが並ぶ形も受け付けます。

期待する JSON（`src/lib/ai/dify.ts` の zod schema と対応）:

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

### 5.4 システムポリシー（LLM ノードの System に入れる）

`policy` 変数として毎回渡しています（`src/lib/ai/types.ts` の `AI_SYSTEM_POLICY`）。

```
1. Never complete the learner's task for them unless explicitly entering an answer-review phase.
2. Give at most one useful hint at a time.
3. Prefer questions over answers.
4. Adapt to previous learner responses.
5. Do not infer traits unsupported by learning evidence.
6. Comment on learning behavior, not personality.
7. If evidence is insufficient, explicitly state uncertainty.
```

LLM ノードには「出力は JSON のみ。余計な文章を付けない」と明記し、可能なら Dify の **JSON Schema 出力**を有効にしてください。

### 5.5 動作確認

Coolify のアプリログに `[ai] evaluate: dify failed, falling back to mock: ...` が出ていれば Dify 側の設定（変数名・key・出力形式）を見直してください。`/api/health` の `ai.lastUsed` が `dify` なら直近の呼び出しが Dify で成功しています。

## 6. LINE 公式アカウント

（LINE担当の断片をここに統合）

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

```bash
npm run docker:build
docker run --rm -p 3000:3000 --env-file .env trivium
```

`.env` の `DATABASE_URL` はコンテナから見えるホスト（`host.docker.internal` など）に読み替えてください。
