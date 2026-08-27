import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AGENTS, AGENT_LABELS, DEFAULT_PERSONAS, TONES, loadPersonas, resetPersonas, savePersona, type AgentKey, type ToneKey } from "@/lib/persona";
import { DOMAIN_VAR } from "@/components/dashboard/shared";

export const dynamic = "force-dynamic";

export const metadata = { title: "設定" };

const AGENT_COLOR: Record<AgentKey, string> = {
  READ: DOMAIN_VAR.READ,
  WRITE: DOMAIN_VAR.WRITE,
  CODE: DOMAIN_VAR.CODE,
  LEADER: "var(--fg)",
};

function isAgent(v: unknown): v is AgentKey {
  return typeof v === "string" && (AGENTS as readonly string[]).includes(v);
}
function isTone(v: unknown): v is ToneKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TONES, v);
}

// AI の人格設定（READ / WRITE / LOGIC / LEADER）。名前・口調・一人称・補足をユーザーごとに上書きできる。
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/settings");
  const { saved } = await searchParams;
  const personas = await loadPersonas(userId);

  async function save(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login?next=/settings");
    const agent = formData.get("agent");
    if (!isAgent(agent)) redirect("/settings");
    const tone = formData.get("tone");
    await savePersona(s.user.id, {
      agent,
      name: String(formData.get("name") ?? "").trim().slice(0, 20) || DEFAULT_PERSONAS[agent].name,
      tone: isTone(tone) ? tone : DEFAULT_PERSONAS[agent].tone,
      firstPerson: String(formData.get("firstPerson") ?? "").trim().slice(0, 10) || DEFAULT_PERSONAS[agent].firstPerson,
      extra: String(formData.get("extra") ?? "").trim().slice(0, 200),
    });
    redirect(`/settings?saved=${agent}`);
  }

  async function reset() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/login?next=/settings");
    await resetPersonas(s.user.id);
    redirect("/settings?saved=all");
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">AI の人格</h1>
          <p className="text-xs text-muted">
            READ / WRITE / LOGIC の講評と、LEADER の総合寸評の文体に反映されます。答えを教えない・一段ヒントという方針は変わりません。
          </p>
        </div>
        <Link href="/dashboard" className="shrink-0 text-xs text-muted hover:text-fg">
          Dashboard →
        </Link>
      </div>

      {saved && (
        <p role="status" className="rounded-lg border border-line bg-bg-elev px-3 py-2 text-sm text-ok">
          {saved === "all" ? "既定の人格に戻しました" : `${AGENT_LABELS[isAgent(saved) ? saved : "READ"]} を保存しました`}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {AGENTS.map((agent) => {
          const p = personas[agent];
          return (
            <form key={agent} action={save} className="card flex flex-col gap-3 p-4" style={{ borderTopColor: AGENT_COLOR[agent], borderTopWidth: 3 }}>
              <input type="hidden" name="agent" value={agent} />
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="wordmark text-sm" style={{ color: AGENT_COLOR[agent] }}>
                  {AGENT_LABELS[agent]}
                </h2>
                <span className="text-[11px] text-muted">既定: {DEFAULT_PERSONAS[agent].name}</span>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted">
                名前
                <input name="name" defaultValue={p.name} maxLength={20} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  口調
                  <select name="tone" defaultValue={p.tone} className="min-h-11 rounded-lg border border-line bg-bg px-2 py-2 text-sm text-fg">
                    {(Object.keys(TONES) as ToneKey[]).map((k) => (
                      <option key={k} value={k}>
                        {TONES[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  一人称
                  <input name="firstPerson" defaultValue={p.firstPerson} maxLength={10} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg" />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted">
                補足（口癖・スタンスなど。200 字まで）
                <textarea name="extra" defaultValue={p.extra} maxLength={200} rows={3} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-fg" />
              </label>
              <p className="text-[11px] text-muted">口調の説明: {TONES[p.tone].prompt}</p>
              <button type="submit" className="btn btn-primary mt-auto">
                保存
              </button>
            </form>
          );
        })}
      </div>

      <form action={reset} className="flex justify-end">
        <button type="submit" className="btn text-sm">
          すべて既定に戻す
        </button>
      </form>
    </div>
  );
}
