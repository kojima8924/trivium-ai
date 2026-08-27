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
import { looksLikePython, normalizeGenerated, normalizeOutput } from "./generate.pure";

export type GenerateRequest = {
  request: string;
  /** 明示指定があれば優先 */
  domain?: DomainKey;
  kind?: Task["kind"];
  difficulty?: number;
};

type VerifyResult = { result: "skip" | "ok" } | { result: "fixed"; index: number } | { result: "mismatch"; stdout: string };

/**
 * 4 択の Python 出力予測問題を実行して検証する。
 * ok: 正解の選択肢が実行結果と一致 / fixed: 別の選択肢が一致したので正解 index を直した / mismatch: どれも一致しない / skip: 対象外
 */
async function verifyPythonChoice(out: { passage: string; prompt: string; choices: string[]; answerKey: string[] }, domain: DomainKey): Promise<VerifyResult> {
  if (domain !== "CODE" || out.choices.length !== 4 || !learningAI.runPython) return { result: "skip" };
  const code = looksLikePython(out.passage) ? out.passage : looksLikePython(out.prompt) ? `${out.passage}\n${out.prompt}` : "";
  if (!code) return { result: "skip" };
  const run = await learningAI.runPython(code);
  if ("error" in run) {
    console.warn("[generate] python verify skipped:", run.error.slice(0, 200));
    return { result: "skip" };
  }
  const actual = normalizeOutput(run.stdout);
  if (!actual) return { result: "skip" };
  const idx = out.choices.findIndex((c) => normalizeOutput(c) === actual);
  const answer = Number(out.answerKey[0]);
  if (idx === answer) return { result: "ok" };
  if (idx >= 0) {
    out.answerKey[0] = String(idx);
    return { result: "fixed", index: idx };
  }
  return { result: "mismatch", stdout: run.stdout.trim() };
}

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

/** LOGIC の出題形式（Python か論理パズルか）を依頼文から決める。LLM に任せない */
export function inferLogicStyle(text: string): "python" | "logic" | null {
  if (/(python|パイソン|コード|プログラ|バグ|出力予測|関数)/i.test(text)) return "python";
  if (/(パズル|論理|推論|順番|条件|嘘|並び|手順|ロジック|logic)/.test(text)) return "logic";
  return null;
}

export async function generateTaskForUser(userId: string, req: GenerateRequest): Promise<{ task: Task; domain: DomainKey }> {
  const domain = req.domain ?? inferDomain(req.request) ?? "CODE";
  const kind = req.kind ?? inferKind(req.request);
  // 明示指定（「難易度8」）はそのまま使う。無指定なら推薦値に「やさしめ／難しめ」の語で ±1
  const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
  const difficulty =
    req.difficulty !== undefined
      ? clamp(req.difficulty)
      : clamp((await nextDifficultyFor(userId, domain)) + inferDifficultyDelta(req.request));

  const [recent, personas] = await Promise.all([
    prisma.generatedTask.findMany({ where: { userId, domain }, orderBy: { createdAt: "desc" }, take: 8, select: { title: true } }),
    personaPrompts(userId),
  ]);

  // LOGIC は「Python」か「論理パズル（コード不可）」かを先頭で明示する
  const style = domain === "CODE" ? inferLogicStyle(req.request) : null;
  const styled =
    style === "logic"
      ? `【形式: 論理パズル・推論問題（プログラムコードは使わない）】${req.request}`
      : style === "python"
        ? `【形式: 短い Python コードの読解】${req.request}`
        : req.request;

  const gen = async () =>
    normalizeGenerated(
      await learningAI.generateTask({
        learnerRef: userId,
        request: styled.slice(0, 300),
        domain,
        difficulty,
        kind,
        allowedSkillTags: SUBSKILLS[domain],
        recentTitles: recent.map((r) => r.title),
        persona: personas[domain],
      }),
    );
  let out = await gen();
  // Python の出力予測問題は実際に実行して正解を検証する（LLM の机上トレースは間違うことがある）
  // 不一致なら 1 回だけ作り直し、それでも合わなければ正解の選択肢を実行結果で差し替える
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = await verifyPythonChoice(out, domain);
    if (v.result !== "mismatch") {
      if (v.result === "fixed") console.warn(`[generate] python verify: answer index corrected -> ${v.index}`);
      break;
    }
    if (attempt === 0) {
      console.warn("[generate] python verify: no choice matches actual output; regenerating");
      out = await gen();
      continue;
    }
    const idx = Number(out.answerKey[0]);
    console.warn("[generate] python verify: patching correct choice with actual output");
    out.choices[idx] = v.stdout;
  }

  // Mock provider は依頼の kind と違う形式を返すことがあるので、返ってきた実体に合わせる
  const actualKind: Task["kind"] = out.choices.length === 4 ? "choice" : out.answerKey.length > 0 ? "short" : "free";
  const id = `gen-${randomBytes(6).toString("base64url")}`;
  const row = await prisma.generatedTask.create({
    data: {
      id,
      userId,
      domain,
      difficulty,
      axisRead: domain === "READ" ? difficulty : 0,
      axisWrite: domain === "WRITE" ? difficulty : 0,
      axisCode: domain === "CODE" ? difficulty : 0,
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
