"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 学習状態を初期状態に戻す（events / profiles / Leader / achievements / 挑戦 / 生成課題 / スナップショット）。
// 人格設定と LINE 連携は残る。デモで「まっさら → seed → 1問」の対比を見せるためのボタン。
export function ResetButton({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!window.confirm("学習記録・プロフィール・Achievement をすべて消して初期状態に戻します。よろしいですか？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { removedEvents: number };
      setMsg(`初期状態に戻しました（${j.removedEvents} 件を削除）`);
      router.refresh();
    } catch (e) {
      setMsg(`失敗: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <button type="button" className="btn px-3 text-xs" disabled={busy || !hasData} onClick={run} aria-label="学習状態を初期状態に戻す">
        {busy ? "戻しています…" : "初期状態に戻す"}
      </button>
      <span role="status" aria-live="polite">
        {msg}
      </span>
    </div>
  );
}
