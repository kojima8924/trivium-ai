// 自由文の依頼から課題を1問作る（LINE / Web 共通）。
//   依頼文 → domain / kind / difficulty を決定論的に推定 → LLM で作問 → GeneratedTask に保存 → Task として返す
// domain の決定は LLM に任せない（3軸の評価に確実に紐づけるため）。
import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../prisma";
import { learningAI } from "../ai";
import { SUBSKILLS, type DomainKey } from "../domain";
import type { Task } from "../tasks";
import { personaPrompts } from "../persona";
import { nextDifficultyFor } from "../profile";

export type GenerateRequest = {
  request: string;
  /** 明示指定があれば優先 */
  domain?: DomainKey;
  kind?: Task["kind"];
  difficulty?: number;
};

/** 依頼文から domain を推定する（決定論）。判定できなければ null */
export function inferDomain(text: string): DomainKey | null {
  const t = text.toLowerCase();
  if (/(論理|パズル|推論|順番|条件|python|パイソン|コード|プログラ|バグ|計算|数列|手順|ロジック|logic|code)/.test(t)) return "CODE";
  if (/(書|作文|文章|要約を書|主張|反論|推敲|言い換え|説明文|write)/.test(t)) return "WRITE";
  if (/(読|読解|文章題|要旨|批判|記事|read|物語|文を読)/.test(t)) return "READ";
  return null;
}

/** 依頼文から形式を推定する。LINE では選択式が扱いやすいので既定は choice */
export function inferKind(text: string, fallback: Task["kind"] = "choice"): Task["kind"] {
  if (/(記述|自由|書いて|文章で|説明して)/.test(text)) return "free";
  if (/(短答|数値|数字で|一言で|答えだけ)/.test(text)) return "short";
  if (/(選択|4択|四択|クイズ)/.test(text)) return "choice";
  return fallback;
}

/** 依頼文から難易度を推定する（「やさしい」「むずかしい」など） */
export function inferDifficultyDelta(text: string): number {
  if (/(やさし|易し|簡単|入門|初級|軽め)/.test(text)) return -1;
  if (/(むずかし|難し|上級|難問|ハード|歯ごたえ)/.test(text)) return 1;
  return 0;
}

export async function generateTaskForUser(userId: string, req: GenerateRequest): Promise<{ task: Task; domain: DomainKey }> {
  const domain = req.domain ?? inferDomain(req.request) ?? "CODE";
  const kind = req.kind ?? inferKind(req.request);
  const base = req.difficulty ?? (await nextDifficultyFor(userId, domain));
  const difficulty = Math.min(5, Math.max(1, base + inferDifficultyDelta(req.request)));

  const [recent, personas] = await Promise.all([
    prisma.generatedTask.findMany({ where: { userId, domain }, orderBy: { createdAt: "desc" }, take: 8, select: { title: true } }),
    personaPrompts(userId),
  ]);

  const out = await learningAI.generateTask({
    learnerRef: userId,
    request: req.request.slice(0, 300),
    domain,
    difficulty,
    kind,
    allowedSkillTags: SUBSKILLS[domain],
    recentTitles: recent.map((r) => r.title),
    persona: personas[domain],
  });

  // Mock provider は依頼の kind と違う形式を返すことがあるので、返ってきた実体に合わせる
  const actualKind: Task["kind"] = out.choices.length === 4 ? "choice" : out.answerKey.length > 0 ? "short" : "free";
  const id = `gen-${randomBytes(6).toString("base64url")}`;
  const row = await prisma.generatedTask.create({
    data: {
      id,
      userId,
      domain,
      difficulty,
      title: out.title.slice(0, 60),
      passage: out.passage,
      prompt: out.prompt,
      kind: actualKind,
      choices: actualKind === "choice" ? out.choices : undefined,
      answerKey: out.answerKey,
      rubric: out.rubric ? (out.rubric as unknown as Prisma.InputJsonValue) : undefined,
      hints: out.hints,
      explanation: out.explanation,
      skillTags: out.skillTags.filter((t) => (SUBSKILLS[domain] as readonly string[]).includes(t)),
      request: req.request.slice(0, 300),
    },
  });

  const task: Task = {
    id: row.id,
    domain,
    difficulty,
    title: row.title,
    passage: row.passage || undefined,
    prompt: row.prompt,
    kind: actualKind,
    choices: actualKind === "choice" ? out.choices : undefined,
    answerKey: out.answerKey,
    rubric: out.rubric ?? undefined,
    hints: out.hints,
    explanation: out.explanation,
    skillTags: row.skillTags,
  };
  return { task, domain };
}
