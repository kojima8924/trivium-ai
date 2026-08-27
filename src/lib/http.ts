// 状態を変える API 用の共通ガード。
//   1) クロスサイトからの POST を弾く（Cookie の SameSite=Lax に加える二段目）
//   2) 1ユーザーあたりのレート制限（AI 呼び出しの浪費・連打を防ぐ）
// 単一コンテナ運用の MVP なのでカウンタはプロセス内に持つ。水平分割するなら Redis 等に移す。
import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";

/** 明確にクロスサイトなリクエストだけ拒否する（ヘッダ不在は許容＝監視や curl を壊さない） */
export function rejectCrossSite(req: Request): NextResponse | null {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "unsupported media type" }, { status: 415 });
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    const allowed = new Set<string>();
    try {
      allowed.add(new URL(env.appUrl).origin);
    } catch {
      /* NEXT_PUBLIC_APP_URL が不正でも他の判定は続ける */
    }
    // リバースプロキシ（Coolify/Traefik）配下では Host がコンテナ名になるため転送ヘッダも見る
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? (env.isProduction ? "https" : "http");
    if (host) allowed.add(`${proto}://${host}`);
    if (!allowed.has(origin)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * 固定ウィンドウのレート制限。
 * @returns 制限に掛かったら 429 レスポンス、通れば null
 */
export function rateLimit(key: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      // 上限を超えたら期限切れを掃除する（メモリリーク防止）
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return null;
  }
  b.count += 1;
  if (b.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}

/** テスト・開発用にカウンタを消す */
export function resetRateLimits(): void {
  buckets.clear();
}
