// Auth.js v5: Google OAuth（本命）＋ デモ用フォールバックログイン（env でゲート）
// OAuth secret はサーバ側 env のみ。session は JWT（DB には User/Account を永続化）。
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

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
      credentials: { name: { label: "表示名", type: "text" } },
      async authorize(creds) {
        const raw = typeof creds?.name === "string" ? creds.name.trim() : "";
        const name = raw.slice(0, 40) || "Demo Learner";
        const email = `demo+${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@trivium.local`;
        const user = await prisma.user.upsert({
          where: { email },
          update: { name },
          create: { email, name },
        });
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
};

/** ログイン済みユーザーID。未ログインなら null */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
