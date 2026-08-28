"use client";

// 回答の入力欄（選択式のラジオ / 短答のテキスト / 記述のテキストエリア）と送信ボタン。
import type { TaskPublic } from "@/lib/tasks/types";
import { looksLikeCode } from "./looks-like-code";

export function AnswerInput({
  task,
  answer,
  setAnswer,
  busy,
  hintCount,
  error,
  submit,
}: {
  task: TaskPublic;
  answer: string;
  setAnswer: (v: string) => void;
  busy: boolean;
  hintCount: number;
  error: string | null;
  submit: (giveUp?: boolean) => void;
}) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      {task.kind === "choice" && task.choices ? (
        <div className="flex flex-col gap-2">
          {task.choices.map((c, i) => (
            <label key={i} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${answer === String(i) ? "border-fg" : "border-line"}`}>
              <input type="radio" name="choice" value={i} checked={answer === String(i)} onChange={() => setAnswer(String(i))} className="mt-1" disabled={busy} />
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
  );
}
