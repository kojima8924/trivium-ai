"use client";

// 課題そのものの表示（AI 作問バッジ・題名・難易度とヒント回数・本文・設問）。
import { DOMAIN_META, MAX_HINTS, type DomainKey } from "@/lib/domain";
import type { TaskPublic } from "@/lib/tasks/types";
import { CodeBlock } from "@/components/CodeBlock";
import { looksLikeCode } from "./looks-like-code";

export function TaskBody({ task, domain, hintCount }: { task: TaskPublic; domain: DomainKey; hintCount: number }) {
  const meta = DOMAIN_META[domain];
  return (
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
      {task.passage && (looksLikeCode(task.passage) ? <CodeBlock code={task.passage} /> : <p className="passage text-sm">{task.passage}</p>)}
      <p className="mt-3 text-sm font-medium leading-relaxed">{task.prompt}</p>
    </section>
  );
}
