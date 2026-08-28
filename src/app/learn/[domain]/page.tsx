import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DOMAIN_META, parseDomain } from "@/lib/domain";
import { TaskPlayer } from "@/components/TaskPlayer";
import { loadPersonas } from "@/lib/persona";
import { loadTaskPrefs } from "@/lib/task-prefs";
import { prisma } from "@/lib/prisma";
import { PythonIntro } from "@/components/PythonIntro";

export const dynamic = "force-dynamic";

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { domain: raw } = await params;
  const domain = parseDomain(raw);
  if (!domain) notFound();
  const sp = await searchParams;

  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/learn/${raw}`)}`);

  const meta = DOMAIN_META[domain];
  const userId = session.user.id;
  const personas = await loadPersonas(userId);
  // LOGIC を初めて開いた人にだけ「Python を含めますか？」を 1 度出す。
  // 課題を id 指定で開いたとき（共有リンク・デモ）と、すでに LOGIC を解いたことがある人には出さない。
  const askPython =
    domain === "CODE" &&
    !sp.task &&
    !(await loadTaskPrefs(userId)).pythonPrompted &&
    (await prisma.learningEvent.count({ where: { userId, domain: "CODE" } })) === 0;
  return (
    <div className="flex flex-col gap-4 py-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="wordmark text-2xl" style={{ color: meta.color }}>
            {meta.label}
          </h1>
          <Link href="/dashboard" className="shrink-0 whitespace-nowrap text-xs text-muted hover:text-fg">
            Dashboard →
          </Link>
        </div>
        <p className="mt-0.5 text-xs text-muted">{meta.tagline}</p>
      </div>
      {askPython && <PythonIntro leaderName={personas.LEADER.name} />}
      {/* key で課題を切り替える（Dashboard で作問した ?task=gen-… でも確実に再ロード） */}
      <TaskPlayer key={sp.task ?? "auto"} domain={domain} preferredTaskId={sp.task} personaName={personas[domain].name} leaderName={personas.LEADER.name} />
    </div>
  );
}
