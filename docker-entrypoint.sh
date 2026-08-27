#!/bin/sh
# Trivium コンテナ起動スクリプト
#   1) prisma migrate deploy（未適用の migration を適用。失敗したら起動しない）
#   2) Next.js standalone サーバ起動
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL が設定されていません" >&2
  exit 1
fi

echo "[entrypoint] prisma migrate deploy を実行します"
(
  cd /app/prisma-cli
  # 隔離した CLI を使う（standalone の node_modules には prisma CLI が無い）
  node node_modules/prisma/build/index.js migrate deploy
) || {
  echo "[entrypoint] ERROR: migrate deploy に失敗しました。DATABASE_URL と DB の状態を確認してください" >&2
  exit 1
}

echo "[entrypoint] Next.js を起動します (port=${PORT:-3000})"
exec node /app/server.js
