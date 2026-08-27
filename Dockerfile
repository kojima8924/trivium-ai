# syntax=docker/dockerfile:1
# Trivium - multi-stage build（deps → build → prisma-cli → runner）
# Coolify では Build Pack = Dockerfile を選ぶだけでこのファイルが使われる。
#
# 方針:
#   - Next.js は output:"standalone" で最小サーバを出力し、runner はそれだけを持つ
#   - 起動時に `prisma migrate deploy` を流すため、Prisma CLI は独立ディレクトリ
#     (/app/prisma-cli) に隔離して同梱する（standalone の node_modules と混ぜない）
#   - alpine の musl で Prisma engine が詰まる事故を避け、debian slim を使う

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- deps: 依存関係のインストール（postinstall で prisma generate が走る） ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# prisma generate（postinstall）に必要
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ---------- build: Next.js ビルド ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* はビルド時にバンドルへ焼き込まれる。Coolify では「Build Variable」として渡すこと
# （未指定なら空。サーバ側は実行時の APP_URL を優先して読むので致命傷にはならない）
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
# ビルド時に DB へは接続しない（接続は実行時に遅延）。テレメトリは切る。
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---------- prisma-cli: migrate deploy 専用の隔離環境 ----------
# ここでは prisma CLI と dotenv だけを持つ package を作る（バージョンは package.json と揃える）
FROM ${NODE_IMAGE} AS prisma-cli
WORKDIR /prisma-cli
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json /tmp/app-package.json
RUN node -e '\
  const p = require("/tmp/app-package.json"); \
  const pick = (n) => (p.devDependencies?.[n] ?? p.dependencies?.[n]); \
  const out = { name: "trivium-prisma-cli", private: true, \
    dependencies: { prisma: pick("prisma"), dotenv: pick("dotenv") } }; \
  require("fs").writeFileSync("package.json", JSON.stringify(out, null, 2));' \
  && npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./

# ---------- runner: 実行イメージ ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# standalone サーバ本体 + 静的ファイル
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# migrate 用の隔離 CLI
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli ./prisma-cli
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# /api/health は DB 疎通も見るので、DB が落ちていれば unhealthy になる
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
