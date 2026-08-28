"use client";

// LOGIC を初めて開いた人に 1 度だけ出す確認カード。
// 「Python の問題を含めますか？」を、設定画面を探させずにその場で決めてもらう。
// LOGIC は論理を測る系統で Python はその道具の一つなので、Python を知らない人が
// 文法でつまずいて「論理が苦手」と記録されるのを防ぐのが目的。
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CharacterAvatar } from "@/components/CharacterAvatar";

export function PythonIntro({ leaderName }: { leaderName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"include" | "exclude" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(include: boolean) {
    if (busy) return;
    setBusy(include ? "include" : "exclude");
    setError(null);
    try {
      const res = await fetch("/api/settings/python-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="python-intro-heading">
      <div className="flex items-start gap-3">
        <CharacterAvatar agent="LEADER" size={40} mood="think" />
        <div className="min-w-0">
          <h2 id="python-intro-heading" className="text-sm font-bold">
            はじめに 1 つだけ — Python（プログラミング）の問題を含めますか？
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            LOGIC で測るのは<span className="font-semibold text-fg">論理の力</span>です。短い Python を読む問題も使いますが、
            それは道具の一つでしかありません。プログラミングが初めてなら「含めない」を選んでください。
            論理パズル・数的推理・手順の設計だけで、同じように LOGIC を伸ばせます。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-primary min-h-11 flex-1" onClick={() => choose(true)} disabled={busy !== null}>
          {busy === "include" ? "設定しています…" : "含める"}
          <span className="ml-1 text-xs font-normal opacity-80">Python を読んだことがある</span>
        </button>
        <button type="button" className="btn min-h-11 flex-1" onClick={() => choose(false)} disabled={busy !== null}>
          {busy === "exclude" ? "設定しています…" : "含めない"}
          <span className="ml-1 text-xs font-normal text-muted">プログラミングは初めて</span>
        </button>
      </div>

      {error && <p className="text-xs text-ng">保存に失敗しました（{error}）。もう一度お試しください。</p>}

      <p className="text-[11px] text-muted">
        この選択はあとから{" "}
        <Link href="/settings" className="underline underline-offset-4">
          設定 → 出題する問題タイプ
        </Link>{" "}
        でいつでも変えられます。{leaderName}が覚えておくので、この確認は一度だけです。
      </p>
    </section>
  );
}
