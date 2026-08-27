import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { DOMAIN_META, parseDomain } from "@/lib/domain";
import { TaskPlayer } from "@/components/TaskPlayer";
import { GenerateBox } from "@/components/GenerateBox";
import { loadPersonas } from "@/lib/persona";

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
  const personas = await loadPersonas(session.user.id);
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
      <GenerateBox domain={domain} />
      {/* key で課題を切り替える（作問後の ?task=gen-… でも確実に再ロード） */}
      <TaskPlayer key={sp.task ?? "auto"} domain={domain} preferredTaskId={sp.task} personaName={personas[domain].name} leaderName={personas.LEADER.name} />
    </div>
  );
}
