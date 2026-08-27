"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// デモデータ投入（自分のアカウントにだけ架空の10日分の学習履歴を入れる）
export function SeedButton({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(reset: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { inserted: number };
      setMsg(`${j.inserted}件の学習記録を投入しました`);
      router.refresh();
    } catch (e) {
      setMsg(`失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <button
        type="button"
        className="btn px-3 text-xs"
        disabled={busy}
        onClick={() => run(hasData)}
        aria-label={hasData ? "学習記録をデモデータで置き換える" : "デモデータを投入する"}
      >
        {busy ? "投入中…" : hasData ? "デモデータで置き換える" : "デモデータを投入"}
      </button>
      <span role="status" aria-live="polite">
        {msg}
      </span>
    </div>
  );
}
