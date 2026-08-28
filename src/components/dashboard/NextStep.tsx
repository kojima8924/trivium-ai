import Link from "next/link";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { DOMAIN_VAR } from "./shared";

export type MaterialSuggestion = {
  id: string;
  title: string;
  kind: string;
  author?: string;
  url?: string;
  free: boolean;
  reason: string;
};

type Props = {
  /** ADVISOR の「次のおすすめ」文。無ければ導入文を出す */
  recommendation: string | null;
  recommendedDomain: DomainKey | null;
  totalEvents: number;
  /** 能力プロフィールに合わせた教材（上位 3 件）。無ければ非表示 */
  materials?: MaterialSuggestion[];
};

const KIND_LABEL: Record<string, string> = { book: "書籍", web: "Web", video: "動画", course: "講座", practice: "問題集" };

/**
 * 「次の一歩」— Dashboard の主役。スクロールせずに CTA が見えることを優先する。
 * AI does not do the work for you. It helps you take the next step. の "next step" にあたる部分。
 */
export function NextStep({ recommendation, recommendedDomain, totalEvents, materials = [] }: Props) {
  const target = recommendedDomain ?? "CODE";
  const others = DOMAINS.filter((d) => d !== target);
  const meta = DOMAIN_META[target];
  const body =
    totalEvents === 0
      ? "まず1問取り組むと、あなたの学習プロフィールの計測が始まります。"
      : (recommendation ?? `${target} の課題に取り組んでみましょう。`);

  return (
    <section
      className="card overflow-hidden p-4 sm:p-5"
      style={{ borderTopColor: DOMAIN_VAR[target], borderTopWidth: 3 }}
      aria-labelledby="next-step-heading"
    >
      <div className="flex items-center gap-2">
        <h2 id="next-step-heading" className="text-sm font-bold">
          次の一歩
        </h2>
        <span className="text-[11px] text-muted">ADVISOR からの提案</span>
      </div>

      <p className="mt-2 text-base leading-relaxed font-medium">{body}</p>

      <Link
        href={meta.path}
        className="btn btn-primary mt-3 w-full text-base"
        aria-label={`${meta.label}（${meta.ja}）の課題を始める`}
      >
        {meta.label} を始める
        <span className="text-xs font-normal opacity-80">約3分</span>
      </Link>

      {materials.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold">おすすめ教材</h3>
            <span className="text-[11px] text-muted">能力プロフィールから選定 · LINE で「おすすめの本」と聞いても出ます</span>
          </div>
          <ul className="mt-2 space-y-2">
            {materials.map((m) => (
              <li key={m.id} className="text-xs leading-relaxed">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-bg-elev px-1.5 py-0.5 text-[10px] text-muted">{KIND_LABEL[m.kind] ?? m.kind}</span>
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">
                      {m.title}
                    </a>
                  ) : (
                    <span className="font-semibold">{m.title}</span>
                  )}
                  {m.author && <span className="text-muted">{m.author}</span>}
                  {m.free && <span className="text-[10px] text-muted">無料</span>}
                </div>
                <p className="text-muted">{m.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">ほかの領域:</span>
        {others.map((d) => (
          <Link
            key={d}
            href={DOMAIN_META[d].path}
            className="inline-flex min-h-11 items-center rounded-md px-2 font-semibold underline-offset-4 hover:underline"
            style={{ color: DOMAIN_VAR[d] }}
          >
            {DOMAIN_META[d].label}
          </Link>
        ))}
      </div>
    </section>
  );
}
