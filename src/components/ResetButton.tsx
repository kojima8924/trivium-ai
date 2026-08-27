"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 学習状態を初期状態に戻す（events / profiles / ADVISOR / 実績 / 挑戦 / 生成課題 / スナップショット）。
// 人格設定・LINE 連携・出題設定は残る。デモで「まっさら → seed → 1問」の対比を見せるためのボタン。
// 誤タップ防止のため、ボタン → 確認（実行／やめる）の 2 段階にする（window.confirm はスマホで見づらいので画面内に出す）。
export function ResetButton({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setConfirming(false);
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

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-elev px-3 py-2 text-xs" role="alertdialog" aria-label="初期化の確認">
        <span>学習記録・能力プロフィール・実績・XP をすべて消して初期状態に戻します（人格・LINE 連携・出題設定は残ります）。よろしいですか？</span>
        <button type="button" className="btn btn-primary px-3 text-xs" onClick={() => void run()} autoFocus>
          初期化する
        </button>
        <button type="button" className="btn px-3 text-xs" onClick={() => setConfirming(false)}>
          やめる
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <button type="button" className="btn px-3 text-xs" disabled={busy || !hasData} onClick={() => setConfirming(true)} aria-label="学習状態を初期状態に戻す">
        {busy ? "戻しています…" : "初期状態に戻す"}
      </button>
      <span role="status" aria-live="polite">
        {msg}
      </span>
    </div>
  );
}
