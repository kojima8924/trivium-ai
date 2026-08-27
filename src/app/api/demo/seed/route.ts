import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { env } from "@/lib/env";
import { seedDemoForUser } from "@/lib/demo-seed";
import { rateLimit, rejectCrossSite } from "@/lib/http";

export const dynamic = "force-dynamic";

// POST /api/demo/seed  { reset?: boolean }
// ログイン中ユーザー自身にだけ架空の学習履歴を投入する（他ユーザーには触れない）
export async function POST(req: Request) {
  if (!env.demoSeedEnabled) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 投入は 23 件の書き込み＋全 domain の再計算を伴うので、連打を抑える
  const limited = rateLimit(`seed:${userId}`, 6, 60_000);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as { reset?: unknown };
  const result = await seedDemoForUser(userId, { reset: body.reset === true });
  return NextResponse.json({ ok: true, ...result });
}
