import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { getDashboardData } from "@/lib/profile";

export const dynamic = "force-dynamic";

// GET /api/profile  ログイン中ユーザーの学習プロフィール（Dashboard と同じデータ）
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getDashboardData(userId));
}
