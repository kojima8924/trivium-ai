import Image from "next/image";
import Link from "next/link";
import { auth, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  const user = session?.user;
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Trivium ホーム" className="flex min-h-11 items-center">
          <Image src="/brand/logo-wide.png" alt="Trivium" width={443} height={96} priority className="h-6 w-auto" />
        </Link>
        <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
          {user ? (
            <>
              <Link href="/dashboard" className="btn h-9 min-h-0 px-3 py-1 text-sm">
                Dashboard
              </Link>
              <Link href="/settings" className="flex min-h-11 items-center whitespace-nowrap px-2 text-muted hover:text-fg" aria-label="AI の人格設定">
                設定
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button type="submit" className="min-h-11 whitespace-nowrap px-2 text-muted hover:text-fg" title={user.email ?? undefined}>
                  ログアウト
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-primary h-9 min-h-0 px-3 py-1 text-sm">
              ログイン
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
