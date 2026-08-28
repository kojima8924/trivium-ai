"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { DOMAIN_VAR } from "@/components/dashboard/shared";

const SLUG: Record<DomainKey, string> = { READ: "read", WRITE: "write", CODE: "logic" };

// Dashboard の「AI に問題を作ってもらう」。系統を選んで自由文で頼むと課題を 1 問作り、
// その課題を載せた学習ページ（/learn/<系統>?task=<gen-id>）へ移動する。
// 解答画面には置かない（解きかけの課題を消してしまう上に、作問は 20 秒前後かかる）。
export function GenerateBox({ defaultDomain }: { defaultDomain: DomainKey }) {
  const router = useRouter();
  const [domain, setDomain] = useState<DomainKey>(defaultDomain);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const request = text.trim();
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/learn/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, domain: domain.toLowerCase() }),
      });
      if (!res.ok) throw new Error(res.status === 429 ? "作問の回数が上限に達しました。少し待ってください" : `HTTP ${res.status}`);
      const j = (await res.json()) as { task: { id: string } };
      router.push(`/learn/${SLUG[domain]}?task=${encodeURIComponent(j.task.id)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
    // 成功時は遷移するので busy を戻さない（戻すと遷移までの一瞬ボタンが復活する）
  }

  return (
    <section className="card flex flex-col gap-2 p-4" aria-labelledby="generate-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 id="generate-heading" className="text-sm font-semibold">
          AI に問題を作ってもらう
        </h2>
        <span className="text-[11px] text-muted">作った問題も同じ 3 系統・同じヒント方針で評価されます</span>
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="系統">
        {DOMAINS.map((d) => {
          const on = d === domain;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDomain(d)}
              disabled={busy}
              className={`min-h-9 flex-1 rounded-md border px-2 text-xs font-semibold transition ${on ? "text-bg" : "border-line text-muted hover:text-fg"}`}
              style={on ? { background: DOMAIN_VAR[d], borderColor: DOMAIN_VAR[d] } : undefined}
            >
              {DOMAIN_META[d].label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void run();
          }}
          placeholder={PLACEHOLDER[domain]}
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          maxLength={300}
          disabled={busy}
        />
        <button type="button" className="btn shrink-0" onClick={run} disabled={busy || text.trim() === ""}>
          {busy ? "作っています…（20 秒ほど）" : "作問"}
        </button>
      </div>
      {error && <p className="text-xs text-ng">{error}</p>}
    </section>
  );
}

const PLACEHOLDER: Record<DomainKey, string> = {
  READ: "例: 短い評論の読解を 1 問 / 図表を読む問題",
  WRITE: "例: 推敲の問題 / 意見文のお題を 1 つ",
  CODE: "例: 論理パズルを 1 問 / Python の出力を当てる問題",
};
