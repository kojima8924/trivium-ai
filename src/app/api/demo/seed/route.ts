import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { env } from "@/lib/env";
import { seedDemoForUser } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

// POST /api/demo/seed  { reset?: boolean }
// ログイン中ユーザー自身にだけ架空の学習履歴を投入する（他ユーザーには触れない）
export async function POST(req: Request) {
  if (!env.demoSeedEnabled) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { reset?: unknown };
  const result = await seedDemoForUser(userId, { reset: body.reset === true });
  return NextResponse.json({ ok: true, ...result });
}
