"use client";

// 学習者の回答・AI の講評・ヒントを吹き出しで並べる。
// 講評には ○ △ ✕ を大きく出し、AI 側の連続する吹き出しの先頭にだけ担当キャラのアバターを添える。
import { DOMAIN_META, type DomainKey } from "@/lib/domain";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { moodForMark } from "@/lib/characters";
import type { LogEntry } from "./use-task-player";

export function FeedbackLog({ log, domain, personaName }: { log: LogEntry[]; domain: DomainKey; personaName?: string }) {
  if (log.length === 0) return null;
  const meta = DOMAIN_META[domain];
  return (
    <section className="flex flex-col gap-2">
      {log.map((m, i) => (
        <div key={i} className={m.kind === "me" ? "flex justify-end" : "flex items-end gap-2"}>
          {/* AI 側の吹き出しには担当キャラのアバターを添える（連続するときは最初だけ） */}
          {m.kind !== "me" && (
            <div className="w-9 shrink-0">{(i === 0 || log[i - 1].kind === "me") && <CharacterAvatar agent={domain} size={36} mood={moodForMark(m.mark ?? (m.kind === "hint" ? "△" : undefined))} />}</div>
          )}
          <div
            className={
              m.kind === "me"
                ? "ml-8 rounded-xl border border-line bg-bg-elev px-3 py-2 text-sm"
                : m.kind === "hint"
                  ? "mr-8 flex-1 rounded-xl border px-3 py-2 text-sm"
                  : "mr-8 flex-1 rounded-xl bg-bg-elev px-3 py-2 text-sm text-muted"
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
            {m.mark && (
              <div
                className={`mb-1 text-3xl font-black leading-none ${m.mark === "○" ? "text-ok" : m.mark === "✕" ? "text-ng" : "text-write"}`}
                aria-label={m.mark === "○" ? "正解" : m.mark === "✕" ? "不正解" : "もう一度"}
              >
                {m.mark}
                <span className="ml-2 align-middle text-xs font-semibold">{m.mark === "○" ? "正解" : m.mark === "✕" ? "不正解" : "もう一度"}</span>
              </div>
            )}
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
