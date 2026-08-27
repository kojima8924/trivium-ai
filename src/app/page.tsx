import Link from "next/link";
import { auth } from "@/auth";
import { DOMAINS, DOMAIN_META } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const loggedIn = Boolean(session?.user);

  return (
    <div className="flex flex-col gap-10 py-8">
      <section className="flex flex-col items-start gap-4">
        <h1 className="wordmark text-4xl sm:text-5xl">Trivium</h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          <span className="font-semibold text-fg">AI does not do the work for you.</span>
          <br />
          It helps you take the next step.
        </p>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          読む・書く・コードを読む。AIは答えを教えず、一段だけヒントを出し、あなたの学習行動から能力プロフィールを更新します。
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          {loggedIn ? (
            <Link href="/dashboard" className="btn btn-primary">
              Dashboard を開く
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary">
              Google でログインして始める
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {DOMAINS.map((d) => {
          const m = DOMAIN_META[d];
          return (
            <Link
              key={d}
              href={loggedIn ? m.path : `/login?next=${encodeURIComponent(m.path)}`}
              className="card flex flex-col gap-2 p-5 transition-colors hover:border-fg"
              style={{ borderTopColor: m.color, borderTopWidth: 3 }}
            >
              <div className="flex items-baseline justify-between">
                <span className="wordmark text-lg" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span className="text-xs text-muted">{m.ja}</span>
              </div>
              <p className="text-sm leading-relaxed text-muted">{m.tagline}</p>
            </Link>
          );
        })}
      </section>

      <section className="card p-5 text-sm leading-relaxed text-muted">
        <div className="mb-2 font-semibold text-fg">仕組み</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>READ / WRITE / CODE の短い課題に取り組む（誤答なら AI が一段だけヒント）</li>
          <li>行動が learning event として記録され、各 domain の能力プロフィールが決定論的に更新される</li>
          <li>LEADER が3つの domain を横断して総合寸評と「次の一歩」を提案する</li>
        </ol>
        <p className="mt-3 text-xs">skills are local, learner is global.</p>
      </section>
    </div>
  );
}
