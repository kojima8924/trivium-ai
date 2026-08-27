import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aiStatus } from "@/lib/ai";

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
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: db === "ok" ? 200 : 503 });
}
