import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { consumeLinkToken, type LinkOutcome } from "@/lib/line/link";

export const dynamic = "force-dynamic";

export const metadata = { title: "LINE アカウント連携" };

// LINE から届いたワンタイムURL。
// GET では消費せず、ログイン済みユーザーが「連携する」を押したときだけ結び付ける
// （リンクのプレビュー取得やクローラで勝手に消費されないため）。
export default async function LinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  const { result } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/link/${token}`)}`);

  if (result) return <Result outcome={result as LinkOutcome["status"]} />;

  async function link() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect(`/login?next=${encodeURIComponent(`/link/${token}`)}`);
    const outcome = await consumeLinkToken(token, s.user.id);
    redirect(`/link/${token}?result=${outcome.status}`);
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-12">
      <div>
        <h1 className="text-xl font-bold">LINE と連携しますか？</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          連携すると、LINE の Leader があなたの学習記録（READ / WRITE / CODE の集計と直近の行動）にもとづいて次の一歩を提案します。
        </p>
      </div>

      <ul className="card space-y-1.5 p-4 text-xs leading-relaxed text-muted">
        <li>・連携されるのは学習記録だけです。LINE 側に氏名やメールアドレスは渡しません。</li>
        <li>・このリンクは一度きり・15分で失効します。</li>
        <li>・LINE で「連携解除」と送れば、いつでも解除できます。</li>
      </ul>

      <form action={link}>
        <button type="submit" className="btn btn-primary w-full">
          {session.user.name ?? "このアカウント"} と連携する
        </button>
      </form>

      <Link href="/dashboard" className="text-center text-xs text-muted hover:text-fg">
        連携せずに Dashboard へ
      </Link>
    </div>
  );
}

function Result({ outcome }: { outcome: LinkOutcome["status"] }) {
  const map: Record<LinkOutcome["status"], { title: string; body: string; ok: boolean }> = {
    linked: {
      title: "連携しました",
      body: "LINE に戻って「今日のおすすめ」と送ってみてください。学習記録にもとづいた提案が返ります。",
      ok: true,
    },
    relinked: {
      title: "連携先を切り替えました",
      body: "この LINE アカウントは、いまログイン中のアカウントに紐づきました。",
      ok: true,
    },
    already: { title: "すでに連携済みです", body: "設定はそのままです。LINE から続けて利用できます。", ok: true },
    invalid: { title: "リンクが見つかりません", body: "LINE で「連携」と送って、新しいリンクを発行してください。", ok: false },
    expired: { title: "リンクの有効期限が切れています", body: "15分で失効します。LINE で「連携」と送り直してください。", ok: false },
    used: { title: "このリンクは使用済みです", body: "もう一度連携したい場合は、LINE で「連携」と送ってください。", ok: false },
  };
  const m = map[outcome] ?? map.invalid;
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-12">
      <div>
        <h1 className={`text-xl font-bold ${m.ok ? "text-ok" : "text-ng"}`}>{m.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{m.body}</p>
      </div>
      <Link href="/dashboard" className="btn btn-primary w-full">
        Dashboard を開く
      </Link>
    </div>
  );
}
