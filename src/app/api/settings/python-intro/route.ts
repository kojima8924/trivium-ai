import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { loadTaskPrefs, saveTaskPrefs } from "@/lib/task-prefs";
import { applyPythonChoice } from "@/lib/task-types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ include: z.boolean() });

// POST /api/settings/python-intro
// LOGIC の初回に出す「Python の問題を含めますか？」への回答を保存する。
// include=false なら Python 読解・バグ発見を除外（設定画面のチェックを外したのと同じ状態）。
// どちらを選んでも pythonPrompted=true になり、確認カードは二度と出ない。あとから /settings で変えられる。
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = rateLimit(`python-intro:${userId}`, 10, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const prefs = await loadTaskPrefs(userId);
  return NextResponse.json(await saveTaskPrefs(userId, applyPythonChoice(prefs, parsed.data.include)));
}
