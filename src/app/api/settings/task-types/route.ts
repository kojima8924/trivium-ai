import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { loadTaskPrefs, saveTaskPrefs } from "@/lib/task-prefs";
import { parseTaskPrefs, taskPrefsLeaveSomething } from "@/lib/task-types";
import { DOMAIN_META } from "@/lib/domain";

export const dynamic = "force-dynamic";

// GET  /api/settings/task-types  … ログイン中ユーザーの出題設定（出さない問題タイプ・複合問題の可否）
// POST /api/settings/task-types  … 保存。系統のタイプを全部除外する指定は 400（出題できなくなる）
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await loadTaskPrefs(userId));
}

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limited = rateLimit(`task-prefs:${userId}`, 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const prefs = parseTaskPrefs(body);
  const check = taskPrefsLeaveSomething(prefs);
  if (!check.ok) {
    return NextResponse.json({ error: `${DOMAIN_META[check.domain].label} のタイプを全部外すと出題できません。1 つ以上残してください。` }, { status: 400 });
  }
  return NextResponse.json(await saveTaskPrefs(userId, prefs));
}
