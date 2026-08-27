import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, authProvidersAvailable, signIn } from "@/auth";

export const dynamic = "force-dynamic";

// 自サイト内のパスだけを許可する（`//evil`・`/\evil`・タブ混入・絶対URLは弾く）
function safeNext(v: string | undefined): string {
  if (!v || !v.startsWith("/")) return "/dashboard";
  try {
    const u = new URL(v, "http://n");
    if (u.origin !== "http://n") return "/dashboard";
    return u.pathname + u.search;
  } catch {
    return "/dashboard";
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const session = await auth();
  if (session?.user) redirect(next);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <div>
        <h1 className="sr-only">Trivium</h1>
        <Image src="/brand/logo-wide.png" alt="Trivium" width={443} height={96} priority className="h-8 w-auto" />
        <p className="mt-2 text-sm text-muted">
          ログインすると、学習状態がサーバに保存され、別の端末からも同じプロフィールを利用できます。
        </p>
      </div>

      {sp.error && (
        <p className="card border-ng/40 p-3 text-sm text-ng">ログインに失敗しました（{sp.error}）。もう一度お試しください。</p>
      )}

      {authProvidersAvailable.google ? (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: next });
          }}
        >
          <button type="submit" className="btn btn-primary w-full">
            <GoogleMark />
            Google でログイン
          </button>
        </form>
      ) : (
        <p className="card p-3 text-sm text-muted">
          Google ログインは未設定です（<code>AUTH_GOOGLE_ID</code> / <code>AUTH_GOOGLE_SECRET</code>）。
        </p>
      )}

      {authProvidersAvailable.demo && (
        <form
          className="card flex flex-col gap-3 p-4"
          action={async (formData: FormData) => {
            "use server";
            const name = String(formData.get("name") ?? "");
            await signIn("demo", { name, redirectTo: next });
          }}
        >
          <div className="text-xs font-semibold text-muted">デモ用ログイン（Google を使わない保険）</div>
          <input
            name="name"
            placeholder="表示名（例: Demo Learner）"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm"
            maxLength={40}
          />
          <button type="submit" className="btn w-full">
            デモとして入る
          </button>
        </form>
      )}

      <p className="text-xs leading-relaxed text-muted">
        保存するのは表示名とメールアドレスだけです。AI 層（Dify）には個人情報を渡しません。
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
