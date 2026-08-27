"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DomainKey } from "@/lib/domain";

const SLUG: Record<DomainKey, string> = { READ: "read", WRITE: "write", CODE: "logic" };

// 自由文の依頼から AI に課題を 1 問作ってもらい、その課題を TaskPlayer に載せる。
// 生成後は ?task=<gen-id> に遷移し、学習ページ側が preferredTaskId として読み込む。
export function GenerateBox({ domain }: { domain: DomainKey }) {
  const router = useRouter();
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">AI に問題を作ってもらう</span>
        <span className="text-[11px] text-muted">作った問題も同じ 3 軸で評価されます</span>
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void run();
          }}
          placeholder="例: 論理パズルを1問 / 短い読解を出して"
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          maxLength={300}
          disabled={busy}
        />
        <button type="button" className="btn shrink-0" onClick={run} disabled={busy || text.trim() === ""}>
          {busy ? "作っています…（数秒）" : "作問"}
        </button>
      </div>
      {error && <p className="text-xs text-ng">{error}</p>}
    </section>
  );
}
