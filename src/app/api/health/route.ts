import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aiStatus } from "@/lib/ai";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Coolify / 監視用。DB 疎通と AI provider の状態を返す（秘密情報は含めない）
export async function GET() {
  const startedAt = Date.now();
  let db: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  const body = {
    status: db === "ok" ? "ok" : "degraded",
    db,
    ai: aiStatus(),
    // LINE の会話を Dify 統合 Chatflow に流しているか（秘密は出さない）
    dify: { chat: env.ai.lineChatViaDify && env.ai.difyChatApiKey ? "on" : "off", keyConfigured: Boolean(env.ai.difyChatApiKey) },
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: db === "ok" ? 200 : 503 });
}
