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
import { loadTaskPrefs } from "../task-prefs";
import { allowedTaskTypes, FREE_TASK_TYPES, taskTypeLabel } from "../task-types";

export type GenerateRequest = {
  request: string;
  /** 明示指定があれば優先 */
  domain?: DomainKey;
  kind?: Task["kind"];
  difficulty?: number;
  /** 問題タイプ（src/lib/task-types.ts のキー）。省略時は依頼文から推定し、決まらなければ出題設定で許可されたタイプから選ぶ */
  taskType?: string;
};

/** 依頼文から問題タイプを推定する（決定論）。判定できなければ null */
export function inferTaskTypeFromRequest(domain: DomainKey, text: string): string | null {
  const t = text.toLowerCase();
  if (domain === "READ") {
    if (/(語彙|言い換え|意味|表現)/.test(t)) return "vocabulary";
    if (/(表|グラフ|データ|数値|図)/.test(t)) return "data";
    if (/(批判|前提|反例|飛躍|妥当)/.test(t)) return "critique";
    if (/(推論|推測|読み取|暗示)/.test(t)) return "inference";
    if (/(要旨|要点|主張|要約)/.test(t)) return "summary";
    return null;
  }
  if (domain === "WRITE") {
    if (/(要約)/.test(t)) return "summary";
    if (/(書き換え|言い換え|書き直|敬語|短く)/.test(t)) return "rewrite";
    if (/(意見|主張|賛成|反対|作文|エッセイ)/.test(t)) return "argument";
    if (/(並べ替え|順序|接続|構成|段落)/.test(t)) return "structure";
    if (/(推敲|直し|明確|冗長|わかりやす)/.test(t)) return "revision";
    return null;
  }
  if (/(バグ|不具合|直して|間違い|エラー)/.test(t) && /(python|パイソン|コード|プログラ)/i.test(t)) return "debug";
  if (/(python|パイソン|コード|プログラ|出力予測|関数)/i.test(t)) return "python";
  if (/(数列|場合の数|確率|比率|割合|計算|数的)/.test(t)) return "math";
  if (/(手順|アルゴリズム|最短|フローチャート|擬似コード)/.test(t)) return "algorithm";
  if (/(パズル|推理|論理|条件)/.test(t)) return "puzzle";
  return null;
}

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
  // 問題タイプ: 明示 > 依頼文からの推定（本人の希望なので出題設定より優先） > 出題設定で許可されたタイプの先頭
  const prefs = await loadTaskPrefs(userId);
  const inferredType = req.taskType ?? inferTaskTypeFromRequest(domain, req.request);
  const kindHint = req.kind ?? (inferredType ? (FREE_TASK_TYPES[domain].includes(inferredType) ? "free" : inferKind(req.request)) : inferKind(req.request));
  const taskType = inferredType ?? allowedTaskTypes(domain, prefs, kindHint)[0] ?? allowedTaskTypes(domain, prefs)[0] ?? undefined;
  // 記述式タイプ（意見文・要約・書き換え）は free、それ以外は依頼文の形式指定に従う
  const kind: Task["kind"] = req.kind ?? (taskType && FREE_TASK_TYPES[domain].includes(taskType) ? "free" : inferKind(req.request));
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

  // LOGIC は「Python」か「論理パズル（コード不可）」かを先頭で明示する（問題タイプが決まっていればそれに従う）
  const style =
    domain === "CODE"
      ? taskType === "python" || taskType === "debug"
        ? "python"
        : taskType === "puzzle" || taskType === "math" || taskType === "algorithm"
          ? "logic"
          : inferLogicStyle(req.request)
      : null;
  const typed = taskType ? `【タイプ: ${taskTypeLabel(domain, taskType)}】` : "";
  const styled =
    style === "logic"
      ? `${typed}【形式: 論理パズル・推論問題（プログラムコードは使わない）】${req.request}`
      : style === "python"
        ? `${typed}【形式: 短い Python コードの読解${taskType === "debug" ? "（期待と違う動作の原因行を問う）" : ""}】${req.request}`
        : `${typed}${req.request}`;

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
      // 問題タイプは列が無いので request に添えて保存する（[type:python] のように先頭に付ける）
      request: `${taskType ? `[type:${taskType}] ` : ""}${req.request}`.slice(0, 300),
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
    taskType,
  };
  return { task, domain };
}
