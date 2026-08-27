"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// デモデータ投入（自分のアカウントにだけ架空の10日分の学習履歴を入れる）。
// 誤タップで学習記録が置き換わらないよう、ボタン → 確認（実行／やめる）の 2 段階にする。
export function SeedButton({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(reset: boolean) {
    setConfirming(false);
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

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-elev px-3 py-2 text-xs" role="alertdialog" aria-label="デモデータ投入の確認">
        <span>
          {hasData
            ? "今の学習記録をすべて消して、架空の 10 日分のデモデータに置き換えます。よろしいですか？"
            : "架空の 10 日分の学習記録（デモデータ）を投入します。よろしいですか？"}
        </span>
        <button type="button" className="btn btn-primary px-3 text-xs" onClick={() => void run(hasData)} autoFocus>
          {hasData ? "置き換える" : "投入する"}
        </button>
        <button type="button" className="btn px-3 text-xs" onClick={() => setConfirming(false)}>
          やめる
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <button
        type="button"
        className="btn px-3 text-xs"
        disabled={busy}
        onClick={() => setConfirming(true)}
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
