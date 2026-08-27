// Auth.js v5: Google OAuth（本命）＋ デモ用フォールバックログイン（env でゲート）
// OAuth secret はサーバ側 env のみ。session は JWT（DB には User/Account を永続化）。
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

/** 長さの違いも含めて時間一定で比較する（合言葉の照合用） */
function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// リバースプロキシ（Coolify/Traefik）配下では、Auth.js がリクエストから組み立てる URL が
// コンテナ内の 0.0.0.0:3000 になり、OAuth の redirect_uri が壊れる。
// AUTH_URL が未設定なら公開 URL（APP_URL / NEXT_PUBLIC_APP_URL）から補う。
if (!process.env.AUTH_URL && env.appUrl && !env.appUrl.includes("localhost")) {
  process.env.AUTH_URL = env.appUrl;
}

const providers: NextAuthConfig["providers"] = [];

if (env.google.configured) {
  providers.push(
    Google({
      // 最小限の scope（プロフィール名とメールのみ）
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  );
}

if (env.demoLoginEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: { name: { label: "表示名", type: "text" }, secret: { label: "合言葉", type: "password" } },
      async authorize(creds) {
        const raw = typeof creds?.name === "string" ? creds.name.trim() : "";
        const name = raw.slice(0, 40) || "Demo Learner";
        const email = `demo+${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@trivium.local`;
        const secret = typeof creds?.secret === "string" ? creds.secret : "";
        // 合言葉（DEMO_LOGIN_SECRET）が設定されていれば必須。一致すれば既存アカウントにも入れる（発表者用）
        if (env.demoLoginSecret) {
          if (!timingSafeEqualString(secret, env.demoLoginSecret)) return null;
          const user = await prisma.user.upsert({ where: { email }, update: { name }, create: { email, name } });
          return { id: user.id, name: user.name, email: user.email };
        }
        // 合言葉なし運用では新規作成だけ許す（表示名を打つだけで既存アカウントに入れないように）
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) return null;
        const user = await prisma.user.create({ data: { email, name } });
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  providers,
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
});

export const authProvidersAvailable = {
  google: env.google.configured,
  demo: env.demoLoginEnabled,
  /** デモログインに合言葉が必要か（ログイン画面の入力欄の表示に使う） */
  demoSecret: env.demoLoginEnabled && Boolean(env.demoLoginSecret),
};

/** ログイン済みユーザーID。未ログインなら null */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
