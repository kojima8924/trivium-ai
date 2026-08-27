// デモ直前の健全性チェック。デプロイ先に対して外形監視のように叩く。
//
//   npm run preflight -- https://trivium.example.com
//   npm run preflight                      （既定は NEXT_PUBLIC_APP_URL、無ければ http://localhost:3000）
//
// 秘密情報は表示しない。読み取り専用（POST は署名検証の確認だけで、データを変更しない）。
import "dotenv/config";
import { createHmac } from "node:crypto";

const target = (process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

type Result = { name: string; ok: boolean; detail: string; critical: boolean };
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string, critical = true) {
  results.push({ name, ok, detail, critical });
  const mark = ok ? "OK  " : critical ? "NG  " : "warn";
  console.log(`${mark} ${name} — ${detail}`);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function check(name: string, fn: () => Promise<{ ok: boolean; detail: string }>, critical = true) {
  try {
    const r = await fn();
    record(name, r.ok, r.detail, critical);
  } catch (e) {
    record(name, false, `例外: ${(e as Error).message}`, critical);
  }
}

async function main() {
  console.log(`Trivium preflight — ${target}\n`);

  await check("health", async () => {
    const res = await fetchWithTimeout(`${target}/api/health`);
    const body = (await res.json()) as { status?: string; db?: string; ai?: { provider?: string; lastUsed?: string } };
    return {
      ok: res.status === 200 && body.db === "ok",
      detail: `HTTP ${res.status} / db=${body.db} / ai=${body.ai?.provider}（直近 ${body.ai?.lastUsed}）`,
    };
  });

  await check("トップページ", async () => {
    const res = await fetchWithTimeout(target);
    const html = await res.text();
    const hasHero = html.includes("AI does not do the work for you");
    const hasLogo = html.includes("/brand/logo-wide.png");
    return { ok: res.status === 200 && hasHero && hasLogo, detail: `HTTP ${res.status} / コピー=${hasHero} / ロゴ=${hasLogo}` };
  });

  await check("ログインページと Google ボタン", async () => {
    const res = await fetchWithTimeout(`${target}/login`);
    const html = await res.text();
    const google = html.includes("Google でログイン");
    const demo = html.includes("デモとして入る");
    return {
      ok: res.status === 200 && (google || demo),
      detail: `HTTP ${res.status} / Google=${google} / デモログイン=${demo}${demo ? "（本番では DEMO_LOGIN_ENABLED=false 推奨）" : ""}`,
    };
  });

  await check("Google OAuth の設定", async () => {
    const res = await fetchWithTimeout(`${target}/api/auth/providers`);
    const body = (await res.json()) as Record<string, { id?: string }>;
    const ids = Object.keys(body ?? {});
    return { ok: ids.includes("google"), detail: `provider=${ids.join(", ") || "なし"}` };
  });

  await check("未ログインで /dashboard はログインへ誘導", async () => {
    const res = await fetchWithTimeout(`${target}/dashboard`);
    const loc = res.headers.get("location") ?? "";
    return { ok: res.status >= 300 && res.status < 400 && loc.includes("/login"), detail: `HTTP ${res.status} → ${loc || "(なし)"}` };
  });

  for (const path of ["/icon.png", "/brand/logo-wide.png", "/opengraph-image.png", "/manifest.webmanifest"]) {
    await check(`静的アセット ${path}`, async () => {
      const res = await fetchWithTimeout(`${target}${path}`);
      const len = res.headers.get("content-length");
      return { ok: res.status === 200, detail: `HTTP ${res.status}${len ? ` / ${Math.round(Number(len) / 1024)}KB` : ""}` };
    });
  }

  await check("LINE webhook（署名なしは拒否）", async () => {
    const res = await fetchWithTimeout(`${target}/api/line/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "x", events: [] }),
    });
    // 401 = 署名検証が有効 / 503 = LINE 未設定（デモでLINEを使わないなら許容）
    return { ok: res.status === 401 || res.status === 503, detail: `HTTP ${res.status}${res.status === 503 ? "（LINE 未設定）" : "（署名検証あり）"}` };
  });

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (secret) {
    await check("LINE webhook（正しい署名は受理）", async () => {
      const body = JSON.stringify({ destination: "preflight", events: [] });
      const sig = createHmac("sha256", secret).update(body).digest("base64");
      const res = await fetchWithTimeout(`${target}/api/line/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-line-signature": sig },
        body,
      });
      return { ok: res.status === 200, detail: `HTTP ${res.status}` };
    });
  }

  await check("認証なしで学習APIが叩けないこと", async () => {
    const res = await fetchWithTimeout(`${target}/api/learn/next?domain=code`);
    return { ok: res.status === 401, detail: `HTTP ${res.status}` };
  });

  await check(
    "HTTPS で配信されていること",
    async () => ({ ok: target.startsWith("https://"), detail: target.startsWith("https://") ? "https" : "http（本番では HTTPS 必須）" }),
    !target.includes("localhost"),
  );

  const failed = results.filter((r) => !r.ok && r.critical);
  const warned = results.filter((r) => !r.ok && !r.critical);
  console.log(`\n${results.length - failed.length - warned.length} OK / ${warned.length} warn / ${failed.length} NG`);
  if (failed.length) {
    console.log("\n要対応:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("デモの前提は満たしています。DEMO.md の事前準備チェックへ進んでください。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
