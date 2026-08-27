import Link from "next/link";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { DOMAIN_VAR } from "./shared";

type Props = {
  /** Leader の「次のおすすめ」文。無ければ導入文を出す */
  recommendation: string | null;
  recommendedDomain: DomainKey | null;
  totalEvents: number;
};

/**
 * 「次の一歩」— Dashboard の主役。スクロールせずに CTA が見えることを優先する。
 * AI does not do the work for you. It helps you take the next step. の "next step" にあたる部分。
 */
export function NextStep({ recommendation, recommendedDomain, totalEvents }: Props) {
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
        <span className="text-[11px] text-muted">Leader からの提案</span>
      </div>

      <p className="mt-2 text-base leading-relaxed font-medium">{body}</p>

      <Link
        href={meta.path}
        className="btn btn-primary mt-3 w-full text-base"
        aria-label={`${target}（${meta.ja}）の課題を始める`}
      >
        {target} を始める
        <span className="text-xs font-normal opacity-80">約3分</span>
      </Link>

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
