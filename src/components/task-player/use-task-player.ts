"use client";

// TaskPlayer の状態管理（課題の取得・回答の送信・ヒントの要求・結果）だけを持つフック。
// 表示は TaskBody / FeedbackLog / AnswerInput / ResultCard 側の責務。
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_HINTS, type DomainKey } from "@/lib/domain";
import type { TaskPublic } from "@/lib/tasks/types";
import type { SubmitResult } from "@/lib/learn/types";

// /api/learn/submit のレスポンス型はサーバと共通（src/lib/learn/types.ts が唯一の定義）
export type SubmitResponse = SubmitResult;

export type Phase = "loading" | "answering" | "submitting" | "hinting" | "done" | "error";

/** mark: ○ 正解 / △ 誤答→ヒントで再挑戦 / ✕ ヒント切れ・ギブアップ */
export type LogEntry = { kind: "feedback" | "hint" | "me"; text: string; mark?: "○" | "△" | "✕" };

export type SettledResult = Extract<SubmitResponse, { status: "success" | "failed" }>;

export function useTaskPlayer({ domain, preferredTaskId }: { domain: DomainKey; preferredTaskId?: string }) {
  const [task, setTask] = useState<TaskPublic | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [answer, setAnswer] = useState("");
  const [hintCount, setHintCount] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<SettledResult | null>(null);
  // 実績解除の演出（結果ごとに 1 回。閉じたら消す）
  const [toastKeys, setToastKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const [reload, setReload] = useState<{ key: number; taskId?: string }>({ key: 0, taskId: preferredTaskId });

  // 課題の取得。setState は fetch 完了コールバック内でのみ行う
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ domain: domain.toLowerCase() });
    if (reload.taskId) q.set("task", reload.taskId);
    fetch(`/api/learn/next?${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { task: TaskPublic };
      })
      .then((j) => {
        if (cancelled) return;
        startedAt.current = Date.now();
        setTask(j.task);
        setPhase("answering");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [domain, reload]);

  const load = useCallback((taskId?: string) => {
    setPhase("loading");
    setError(null);
    setTask(null);
    setAnswer("");
    setHintCount(0);
    setLog([]);
    setResult(null);
    setReload((r) => ({ key: r.key + 1, taskId }));
  }, []);

  async function submit(giveUp = false) {
    if (!task) return;
    if (!giveUp && answer.trim() === "") return;
    setPhase("submitting");
    setError(null);
    if (!giveUp) setLog((l) => [...l, { kind: "me", text: task.kind === "choice" ? task.choices?.[Number(answer)] ?? answer : answer }]);
    try {
      const res = await fetch("/api/learn/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          answer,
          hintCount,
          latencyMs: Date.now() - startedAt.current,
          giveUp,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as SubmitResponse;
      if (j.status === "retry") {
        setLog((l) => [...l, { kind: "feedback", text: j.feedback, mark: "△" }, ...(j.hint ? [{ kind: "hint" as const, text: j.hint }] : [])]);
        setHintCount(j.hintCount);
        setPhase("answering");
      } else {
        setLog((l) => [...l, { kind: "feedback", text: j.feedback, mark: j.status === "success" ? "○" : "✕" }]);
        setResult(j);
        if (j.newAchievements?.length) setToastKeys(j.newAchievements);
        setPhase("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("answering");
    }
  }

  /**
   * 回答せずにヒントだけを 1 段もらう（LINE の「ヒント」と同じ /api/learn/hint）。
   * 回数はサーバが数える。使い切っていればその旨を吹き出しで伝える。
   */
  async function hint() {
    if (!task || phase !== "answering" || hintCount >= MAX_HINTS) return;
    setPhase("hinting");
    setError(null);
    try {
      const res = await fetch("/api/learn/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { hint: string | null; hintCount: number; hintsRemaining: number };
      setHintCount(j.hintCount);
      if (j.hint) setLog((l) => [...l, { kind: "hint", text: j.hint! }]);
      else setLog((l) => [...l, { kind: "feedback", text: "ヒントは使い切りました。ここまでの手がかりで、もう一度考えてみてください。" }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("answering");
    }
  }

  return { task, phase, answer, setAnswer, hintCount, log, result, toastKeys, setToastKeys, error, load, submit, hint };
}
