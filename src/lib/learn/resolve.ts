// taskId → Task の解決。静的な課題（src/lib/tasks）と LLM 生成課題（GeneratedTask 行）を同じ Task 型で返す。
// 出題・採点・集計のどこからでも使うので、依存を最小（prisma と tasks だけ）に保つ。
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { getTask, type Task } from "../tasks";
import type { DomainKey } from "../domain";

type GeneratedTaskRow = {
  id: string;
  domain: string;
  difficulty: number;
  axisRead?: number;
  axisWrite?: number;
  axisCode?: number;
  title: string;
  passage: string;
  prompt: string;
  kind: string;
  choices: Prisma.JsonValue | null;
  answerKey: Prisma.JsonValue | null;
  rubric: Prisma.JsonValue | null;
  hints: Prisma.JsonValue;
  explanation: string;
  skillTags: string[];
};

function strs(v: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function rowToTask(r: GeneratedTaskRow): Task {
  const rubric =
    r.rubric && typeof r.rubric === "object" && !Array.isArray(r.rubric)
      ? {
          mustInclude: strs((r.rubric as Record<string, Prisma.JsonValue>).mustInclude),
          minLength: Number((r.rubric as Record<string, unknown>).minLength ?? 0) || undefined,
          maxLength: Number((r.rubric as Record<string, unknown>).maxLength ?? 0) || undefined,
          criteria: strs((r.rubric as Record<string, Prisma.JsonValue>).criteria),
        }
      : undefined;
  const axes = { read: r.axisRead ?? 0, write: r.axisWrite ?? 0, code: r.axisCode ?? 0 };
  return {
    id: r.id,
    domain: r.domain as DomainKey,
    difficulty: r.difficulty,
    axes: axes.read + axes.write + axes.code > 0 ? axes : undefined,
    title: r.title,
    passage: r.passage || undefined,
    prompt: r.prompt,
    kind: r.kind as Task["kind"],
    choices: r.kind === "choice" ? strs(r.choices) : undefined,
    answerKey: strs(r.answerKey),
    rubric,
    hints: strs(r.hints),
    explanation: r.explanation,
    skillTags: r.skillTags,
  };
}

/** taskId から Task を取り出す。生成タスクは本人のものだけ見える */
export async function resolveTask(userId: string, taskId: string): Promise<Task | null> {
  const s = getTask(taskId);
  if (s) return s;
  if (!taskId.startsWith("gen-")) return null;
  const row = await prisma.generatedTask.findFirst({ where: { id: taskId, userId } });
  return row ? rowToTask(row) : null;
}
