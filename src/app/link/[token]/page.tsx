import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { consumeLinkToken, isLinkResultGenuine, type LinkStatus } from "@/lib/line/link";
import { lineClient, pushTo } from "@/lib/line/push";
import { prisma } from "@/lib/prisma";

const SUCCESS: ReadonlySet<string> = new Set(["linked", "relinked", "already"]);
const KNOWN: ReadonlySet<string> = new Set(["linked", "relinked", "already", "invalid", "expired", "used"]);

export const dynamic = "force-dynamic";

export const metadata = { title: "LINE アカウント連携" };

/** リンクを発行した LINE 側の情報（表示名は Messaging API から取れたときだけ）。連携相手を本人が確認できるようにする */
async function describeIssuer(token: string): Promise<{ lineUserId: string; displayName: string | null; issuedMinutesAgo: number } | null> {
  const row = await prisma.lineLinkToken.findUnique({ where: { token }, select: { lineUserId: true, createdAt: true, usedAt: true } });
  if (!row || row.usedAt) return null;
  let displayName: string | null = null;
  const client = lineClient();
  if (client) {
    try {
      const p = await client.getProfile(row.lineUserId);
      displayName = p.displayName ?? null;
    } catch {
      /* プロフィール未公開・ブロック中などは名前なしで進める */
    }
  }
  return { lineUserId: row.lineUserId, displayName, issuedMinutesAgo: Math.max(0, Math.round((Date.now() - row.createdAt.getTime()) / 60_000)) };
}

// LINE から届いたワンタイムURL。
// GET では消費せず、ログイン済みユーザーが「連携する」を押したときだけ結び付ける
// （リンクのプレビュー取得やクローラで勝手に消費されないため）。
// 連携相手の LINE 表示名と発行時刻を見せ、第三者が発行したリンクを踏まされても気づけるようにする。
// 連携が成立したら LINE 側にも通知し、心当たりが無ければ「連携解除」で戻せるようにする。
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

  if (result) {
    // クエリだけで成功画面が出ないよう、成功系は DB で裏を取る（トークンが使用済みで、かつ自分に紐づいていること）
    let outcome: LinkStatus = KNOWN.has(result) ? (result as LinkStatus) : "invalid";
    if (SUCCESS.has(outcome) && !(await isLinkResultGenuine(token, session.user.id))) outcome = "invalid";
    return <Result outcome={outcome} />;
  }

  const issuer = await describeIssuer(token);
  const webName = session.user.name ?? "このアカウント";

  async function link() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect(`/login?next=${encodeURIComponent(`/link/${token}`)}`);
    const before = await prisma.lineLinkToken.findUnique({ where: { token }, select: { lineUserId: true } });
    const outcome = await consumeLinkToken(token, s.user.id);
    if (before && (outcome.status === "linked" || outcome.status === "relinked")) {
      // LINE 側への通知（本人以外が踏んだリンクで連携された場合の気づきと取り消し手段）
      const name = s.user.name ?? "（表示名なし）";
      await pushTo(before.lineUserId, {
        text: [
          `Web アカウント『${name}』と連携しました。`,
          "心当たりがない場合は「連携解除」と送ってください。すぐに解除されます。",
          `${env.appUrl.replace(/\/$/, "")}/dashboard`,
        ].join("\n"),
      }).catch((err) => console.warn("[link] notify failed:", (err as Error).message));
    }
    redirect(`/link/${token}?result=${outcome.status}`);
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-12">
      <div>
        <h1 className="text-xl font-bold">LINE と連携しますか？</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          連携すると、LINE の ADVISOR があなたの学習記録（READ / WRITE / LOGIC の集計と直近の行動）にもとづいて次の一歩を提案します。
        </p>
      </div>

      {issuer ? (
        <div className="card p-4 text-sm leading-relaxed">
          <div className="text-[11px] font-semibold text-muted">連携相手の LINE</div>
          <div className="mt-1 font-semibold">{issuer.displayName ? `${issuer.displayName} さん` : "（表示名を取得できませんでした）"}</div>
          <div className="mt-1 text-xs text-muted">
            {issuer.issuedMinutesAgo <= 0 ? "たった今" : `${issuer.issuedMinutesAgo} 分前`}に LINE で「連携」と送って発行されたリンクです。
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ng">
            LINE で「連携」と送ったのがあなた自身でない場合（他の人から送られてきたリンクなど）は、連携しないでください。
          </p>
        </div>
      ) : (
        <p className="card p-4 text-sm text-muted">このリンクは使用済みか、見つかりません。LINE で「連携」と送って新しいリンクを発行してください。</p>
      )}

      <ul className="card space-y-1.5 p-4 text-xs leading-relaxed text-muted">
        <li>・連携されるのは学習記録だけです。LINE 側に氏名やメールアドレスは渡しません。</li>
        <li>・このリンクは一度きり・15分で失効します。</li>
        <li>・連携が成立すると LINE にも通知が届きます。LINE で「連携解除」と送れば、いつでも解除できます。</li>
      </ul>

      {issuer && (
        <form action={link}>
          <button type="submit" className="btn btn-primary w-full">
            {webName} と連携する
          </button>
        </form>
      )}

      <Link href="/dashboard" className="text-center text-xs text-muted hover:text-fg">
        連携せずに Dashboard へ
      </Link>
    </div>
  );
}

function Result({ outcome }: { outcome: LinkStatus }) {
  const map: Record<LinkStatus, { title: string; body: string; ok: boolean }> = {
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
  const m = map[outcome];
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
