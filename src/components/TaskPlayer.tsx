"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DOMAIN_META, MAX_HINTS, type DomainKey } from "@/lib/domain";
import type { TaskPublic } from "@/lib/tasks/types";
import { achievementTitle } from "@/lib/achievement-defs";

type SubmitResponse =
  | { status: "retry"; feedback: string; hint: string; hintCount: number; hintsRemaining: number }
  | {
      status: "success" | "failed";
      feedback: string;
      explanation: string;
      hintCount: number;
      observations?: string[];
      profile: { domain: DomainKey; before: number; after: number; confidence: string; summary: string; recommendedNext: string };
      leader: { summary: string; recommendation: string } | null;
      newAchievements: string[];
    };

type Phase = "loading" | "answering" | "submitting" | "done" | "error";

/** LOGIC は Python と論理パズルが混在するので、コードらしい本文だけ等幅ブロックで出す */
function looksLikeCode(passage: string): boolean {
  const firstLine = passage.split("\n")[0] ?? "";
  if (/^(def |print\(|for |import |[a-z_]+ = )/m.test(passage)) return true;
  if (/^[#・\s]/.test(firstLine)) return false;
  return /\b(def|print|for|while|if|import|return|range|len)\b|[=\[\]{}()]/.test(passage);
}

export function TaskPlayer({
  domain,
  preferredTaskId,
  personaName,
  leaderName,
}: {
  domain: DomainKey;
  preferredTaskId?: string;
  /** この domain を担当する AI の名前（講評の吹き出しに表示） */
  personaName?: string;
  /** LEADER の名前（結果画面に表示） */
  leaderName?: string;
}) {
  const [task, setTask] = useState<TaskPublic | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [answer, setAnswer] = useState("");
  const [hintCount, setHintCount] = useState(0);
  const [log, setLog] = useState<{ kind: "feedback" | "hint" | "me"; text: string }[]>([]);
  const [result, setResult] = useState<Extract<SubmitResponse, { status: "success" | "failed" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const [reload, setReload] = useState<{ key: number; taskId?: string }>({ key: 0, taskId: preferredTaskId });
  const meta = DOMAIN_META[domain];

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
        setLog((l) => [...l, { kind: "feedback", text: j.feedback }, ...(j.hint ? [{ kind: "hint" as const, text: j.hint }] : [])]);
        setHintCount(j.hintCount);
        setPhase("answering");
      } else {
        setLog((l) => [...l, { kind: "feedback", text: j.feedback }]);
        setResult(j);
        setPhase("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("answering");
    }
  }

  if (phase === "loading") return <div className="card p-6 text-sm text-muted">課題を選んでいます…</div>;
  if (phase === "error" || !task)
    return (
      <div className="card p-6 text-sm">
        <p className="text-ng">読み込みに失敗しました（{error}）</p>
        <button className="btn mt-3" onClick={() => load()}>
          再試行
        </button>
      </div>
    );

  const busy = phase === "submitting";
  const done = phase === "done";

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
          <span className="min-w-0 truncate">
            {task.id.startsWith("gen-") && (
              <span className="mr-1 rounded border px-1 py-0.5 text-[10px] font-semibold" style={{ borderColor: meta.color, color: meta.color }}>
                AI 作問
              </span>
            )}
            {task.title}
          </span>
          <span>
            難易度 {task.difficulty}/10 · ヒント {hintCount}/{MAX_HINTS}
          </span>
        </div>
        {task.passage && (looksLikeCode(task.passage) ? <pre className="codeblock">{task.passage}</pre> : <p className="passage text-sm">{task.passage}</p>)}
        <p className="mt-3 text-sm font-medium leading-relaxed">{task.prompt}</p>
      </section>

      {log.length > 0 && (
        <section className="flex flex-col gap-2">
          {log.map((m, i) => (
            <div
              key={i}
              className={
                m.kind === "me"
                  ? "ml-8 self-end rounded-xl border border-line bg-bg-elev px-3 py-2 text-sm"
                  : m.kind === "hint"
                    ? "mr-8 rounded-xl border px-3 py-2 text-sm"
                    : "mr-8 rounded-xl bg-bg-elev px-3 py-2 text-sm text-muted"
              }
              style={m.kind === "hint" ? { borderColor: meta.color } : undefined}
            >
              {m.kind === "hint" && (
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: meta.color }}>
                  hint {log.filter((x, j) => x.kind === "hint" && j <= i).length}
                </div>
              )}
              {m.kind === "feedback" && personaName && (
                <div className="mb-0.5 text-[10px] font-semibold" style={{ color: meta.color }}>
                  {personaName}
                </div>
              )}
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
        </section>
      )}

      {!done && (
        <section className="card flex flex-col gap-3 p-4">
          {task.kind === "choice" && task.choices ? (
            <div className="flex flex-col gap-2">
              {task.choices.map((c, i) => (
                <label key={i} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${answer === String(i) ? "border-fg" : "border-line"}`}>
                  <input type="radio" name="choice" value={i} checked={answer === String(i)} onChange={() => setAnswer(String(i))} className="mt-1" disabled={busy} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          ) : task.kind === "short" ? (
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="答えを入力"
              className="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm"
              disabled={busy}
              autoComplete="off"
            />
          ) : (
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="ここに書く"
              rows={6}
              className="rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed"
              disabled={busy}
            />
          )}
          {task.kind === "free" && <div className="text-right text-[11px] text-muted">{[...answer].length} 字</div>}
          {error && <p className="text-xs text-ng">送信に失敗しました（{error}）。もう一度お試しください。</p>}
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="min-h-11 px-2 text-xs text-muted hover:text-fg" onClick={() => submit(true)} disabled={busy}>
              解説を見て終える
            </button>
            <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={busy || answer.trim() === ""}>
              {busy ? "AIが確認中…（数秒）" : hintCount > 0 ? "もう一度答える" : "答える"}
            </button>
          </div>
        </section>
      )}

      {done && result && (
        <section className="card flex flex-col gap-3 p-4 sm:p-5">
          <div className={`text-sm font-semibold ${result.status === "success" ? "text-ok" : "text-ng"}`}>
            {result.status === "success" ? `正解（ヒント ${result.hintCount} 回）` : "今回は未達"}
          </div>
          <div className="rounded-lg bg-bg p-3 text-sm leading-relaxed">
            <div className="mb-1 text-[11px] font-semibold text-muted">解説</div>
            {result.explanation}
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
            <span className="wordmark text-xs" style={{ color: meta.color }}>
              {meta.label}
            </span>
            <span className="tabular-nums">
              {result.profile.before} → <span className="font-bold">{result.profile.after}</span>
              <span className="ml-2 text-[11px] text-muted">信頼度: {result.profile.confidence}</span>
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted">{result.profile.summary}</p>
          {result.leader && (
            <div className="rounded-lg border border-line p-3 text-xs">
              <div className="wordmark mb-1 text-[10px]">Leader{leaderName ? ` · ${leaderName}` : ""}</div>
              <p className="leading-relaxed">{result.leader.summary}</p>
              <p className="mt-1 font-medium">次のおすすめ: {result.leader.recommendation}</p>
            </div>
          )}
          {result.newAchievements.length > 0 && (
            <p className="text-xs">
              <span className="font-semibold">Achievement 解除:</span> {result.newAchievements.map(achievementTitle).join("、")}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/dashboard" className="btn btn-primary">
              Dashboard で変化を見る
            </Link>
            <button type="button" className="btn" onClick={() => load()}>
              次の課題へ
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
