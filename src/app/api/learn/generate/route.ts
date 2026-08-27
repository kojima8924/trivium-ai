import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { parseDomain } from "@/lib/domain";
import { rateLimit, rejectCrossSite } from "@/lib/http";
import { generateTaskForUser } from "@/lib/learn/generate";
import { toPublic } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** 自由文の依頼（例: 「論理パズルを1問」「短い読解を出して」） */
  request: z.string().min(1).max(300),
  domain: z.string().optional(),
  kind: z.enum(["choice", "short", "free"]).optional(),
  difficulty: z.number().int().min(1).max(10).optional(),
});

// POST /api/learn/generate
// 自由文の依頼から課題を1問作り、通常の学習ループ（/api/learn/submit）で解けるように返す
export async function POST(req: Request) {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 作問は LLM コストが高いので控えめに
  const limited = rateLimit(`generate:${userId}`, 10, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const domain = parsed.data.domain ? parseDomain(parsed.data.domain) ?? undefined : undefined;

  const { task } = await generateTaskForUser(userId, { ...parsed.data, domain });
  return NextResponse.json({ task: toPublic(task) });
}
