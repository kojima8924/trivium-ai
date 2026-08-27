// LINE Messaging API Webhook
// - raw body の署名検証後、検証済みイベントだけを意図別ハンドラへ渡す
// - イベント単位で失敗を閉じ込め、再送嵐を防ぐため処理エラー時も 200 を返す
import { after, NextResponse } from "next/server";
import { validateSignature, type webhook } from "@line/bot-sdk";
import { env } from "@/lib/env";
import { handleLineEvent } from "@/lib/line/handlers";

export const dynamic = "force-dynamic";

// 疎通確認用（LINE Developers の「検証」ボタンは POST なので、こちらは人間用）
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(env.line.channelSecret && env.line.channelAccessToken) });
}

export async function POST(req: Request) {
  if (!env.line.channelSecret || !env.line.channelAccessToken) {
    return NextResponse.json({ error: "LINE is not configured" }, { status: 503 });
  }

  // 署名検証は raw body に対して行う（JSON 化前）
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  if (!signature || !validateSignature(body, env.line.channelSecret, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: webhook.CallbackRequest;
  try {
    payload = JSON.parse(body) as webhook.CallbackRequest;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  // LINE は 1秒程度で応答を期待するので、イベント処理は並列で行う
  await Promise.all(
    events.map(async (event) => {
      try {
        await handleLineEvent(event, after);
      } catch (err) {
        console.error("[line] event failed:", (err as Error).message);
      }
    }),
  );

  return NextResponse.json({ ok: true, handled: events.length });
}
