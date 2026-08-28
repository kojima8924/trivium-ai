"use client";

// 回答の入力欄（選択式のラジオ / 短答のテキスト / 記述のテキストエリア）と、ヒント・終了・送信のボタン。
import { MAX_HINTS } from "@/lib/domain";
import type { TaskPublic } from "@/lib/tasks/types";
import { looksLikeCode } from "./looks-like-code";

export function AnswerInput({
  task,
  answer,
  setAnswer,
  busy,
  hinting,
  hintCount,
  error,
  submit,
  requestHint,
}: {
  task: TaskPublic;
  answer: string;
  setAnswer: (v: string) => void;
  /** 回答を AI が確認中 */
  busy: boolean;
  /** ヒントを取りに行っている最中 */
  hinting: boolean;
  hintCount: number;
  error: string | null;
  submit: (giveUp?: boolean) => void;
  /** 回答せずにヒントを 1 段もらう */
  requestHint: () => void;
}) {
  const locked = busy || hinting;
  const hintsLeft = MAX_HINTS - hintCount;
  return (
    <section className="card flex flex-col gap-3 p-4">
      {task.kind === "choice" && task.choices ? (
        <div className="flex flex-col gap-2">
          {task.choices.map((c, i) => (
            <label key={i} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${answer === String(i) ? "border-fg" : "border-line"}`}>
              <input type="radio" name="choice" value={i} checked={answer === String(i)} onChange={() => setAnswer(String(i))} className="mt-1" disabled={locked} />
              {/* 複数行の出力（print が 2 行など）は改行のまま見せる。コードらしい選択肢は等幅 */}
              <span className={`whitespace-pre-wrap break-words ${looksLikeCode(c) ? "font-mono text-xs sm:text-sm" : ""}`}>{c}</span>
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
          disabled={locked}
          autoComplete="off"
        />
      ) : (
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="ここに書く"
          rows={6}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed"
          disabled={locked}
        />
      )}
      {task.kind === "free" && <div className="text-right text-[11px] text-muted">{[...answer].length} 字</div>}
      {error && <p className="text-xs text-ng">送信に失敗しました（{error}）。もう一度お試しください。</p>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {/* 詰まったら回答前でもヒントを 1 段もらえる（LINE の「💡 ヒント」と同じ。回数は XP と証拠の重みに効く） */}
          <button
            type="button"
            className="btn min-h-11 shrink-0 px-3 text-xs"
            onClick={requestHint}
            disabled={locked || hintsLeft <= 0}
            aria-label={hintsLeft > 0 ? `ヒントをもらう（残り ${hintsLeft} 回）` : "ヒントは使い切りました"}
            title={hintsLeft > 0 ? "答えは教えません。着眼点を一段だけ" : "ヒントは使い切りました"}
          >
            {hinting ? "考え中…" : `💡 ヒント ${hintCount}/${MAX_HINTS}`}
          </button>
          <button type="button" className="min-h-11 shrink-0 px-2 text-xs text-muted hover:text-fg" onClick={() => submit(true)} disabled={locked}>
            解説を見て終える
          </button>
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={() => submit()} disabled={locked || answer.trim() === ""}>
          {busy ? "AIが確認中…（数秒）" : hintCount > 0 ? "もう一度答える" : "答える"}
        </button>
      </div>
    </section>
  );
}
