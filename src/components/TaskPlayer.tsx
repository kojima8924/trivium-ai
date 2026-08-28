"use client";

// 学習ページの本体。状態は useTaskPlayer に、表示は task-player/ の子コンポーネントに任せ、
// ここは「読み込み中／エラー／課題・ログ・入力・結果」の組み立てだけを行う。
import type { DomainKey } from "@/lib/domain";
import { AnswerInput } from "@/components/task-player/AnswerInput";
import { FeedbackLog } from "@/components/task-player/FeedbackLog";
import { ResultCard } from "@/components/task-player/ResultCard";
import { TaskBody } from "@/components/task-player/TaskBody";
import { useTaskPlayer } from "@/components/task-player/use-task-player";

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
  const { task, phase, answer, setAnswer, hintCount, log, result, toastKeys, setToastKeys, error, load, submit } = useTaskPlayer({ domain, preferredTaskId });

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
      <TaskBody task={task} domain={domain} hintCount={hintCount} />

      <FeedbackLog log={log} domain={domain} personaName={personaName} />

      {!done && <AnswerInput task={task} answer={answer} setAnswer={setAnswer} busy={busy} hintCount={hintCount} error={error} submit={(giveUp) => void submit(giveUp)} />}

      {done && result && (
        <ResultCard result={result} domain={domain} leaderName={leaderName} toastKeys={toastKeys} setToastKeys={setToastKeys} onNext={() => load()} />
      )}
    </div>
  );
}
