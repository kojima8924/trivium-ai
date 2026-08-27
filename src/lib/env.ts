// サーバ側でのみ読む環境変数。ブラウザへは NEXT_PUBLIC_ 以外を絶対に渡さない。
import "server-only";

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",

  demoLoginEnabled: bool(process.env.DEMO_LOGIN_ENABLED, false),
  demoSeedEnabled: bool(process.env.DEMO_SEED_ENABLED, true),

  ai: {
    provider: (process.env.AI_PROVIDER ?? "dify") as "dify" | "mock",
    difyApiBase: process.env.DIFY_API_BASE ?? "https://api.dify.ai/v1",
    difyDomainApiKey: process.env.DIFY_DOMAIN_API_KEY ?? "",
    difyLeaderApiKey: process.env.DIFY_LEADER_API_KEY ?? "",
    difyTimeoutMs: Number(process.env.DIFY_TIMEOUT_MS ?? 20000),
  },

  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  },

  google: {
    configured: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  },
};
