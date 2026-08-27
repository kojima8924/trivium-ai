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
import { chooseTaskType, inferDifficultyDelta, inferDomain, inferKind, inferLogicStyle, looksLikePython, normalizeGenerated, normalizeOutput, stableHash } from "./generate.pure";

// 依頼文の推定は純粋モジュールに置いている（テストから直接呼べる）。互換のため再エクスポート
export { chooseTaskType, inferDifficultyDelta, inferDomain, inferKind, inferLogicStyle, inferTaskTypeFromRequest } from "./generate.pure";
import { loadTaskPrefs } from "../task-prefs";
import { taskTypeLabel } from "../task-types";

export type GenerateRequest = {
  request: string;
  /** 明示指定があれば優先 */
  domain?: DomainKey;
  kind?: Task["kind"];
  difficulty?: number;
  /** 問題タイプ（src/lib/task-types.ts のキー）。省略時は依頼文から推定し、決まらなければ出題設定で許可されたタイプから選ぶ */
  taskType?: string;
};

type VerifyResult = { result: "skip" | "ok" } | { result: "fixed"; index: number } | { result: "mismatch"; stdout: string };

/**
 * 4 択の Python 出力予測問題（taskType = python）を実行して検証する。
 * ok: 正解の選択肢が実行結果と一致 / fixed: 別の選択肢が一致したので正解 index を直した / mismatch: どれも一致しない / skip: 対象外
 * debug（バグ発見）は選択肢が「原因の行」や説明文なので stdout と照合しない（実行できるかの確認だけ）。
 * puzzle / math / algorithm はコードではないので対象外。
 */
async function verifyPythonChoice(
  out: { passage: string; prompt: string; choices: string[]; answerKey: string[] },
  domain: DomainKey,
  taskType: string | undefined,
): Promise<VerifyResult> {
  if (domain !== "CODE" || out.choices.length !== 4 || !learningAI.runPython) return { result: "skip" };
  if (taskType !== undefined && taskType !== "python" && taskType !== "debug") return { result: "skip" };
  const code = looksLikePython(out.passage) ? out.passage : looksLikePython(out.prompt) ? `${out.passage}\n${out.prompt}` : "";
  if (!code) return { result: "skip" };
  const run = await learningAI.runPython(code);
  if ("error" in run) {
    console.warn("[generate] python verify skipped:", run.error.slice(0, 200));
    return { result: "skip" };
  }
  // バグ発見問題は「動く（または例外で止まる）コード」であることだけ確認し、選択肢は照合しない
  if (taskType === "debug") return { result: "skip" };
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

/**
 * 問題タイプと形式を決める（純粋）。
 *   1. 明示指定 → そのまま（設定より本人の明示が優先）
 *   2. 依頼文から推定 → 出題設定で除外されていなければ採用
 *   3. それ以外 → 許可タイプ（形式ヒントで絞る）から seed で決定論的に選ぶ。形式ヒントで空なら形式を free に切り替える
 */

export async function generateTaskForUser(userId: string, req: GenerateRequest): Promise<{ task: Task; domain: DomainKey }> {
  const domain = req.domain ?? inferDomain(req.request) ?? "CODE";
  // 明示指定（「難易度8」）はそのまま使う。無指定なら推薦値に「やさしめ／難しめ」の語で ±1
  const clamp = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
  const difficulty =
    req.difficulty !== undefined
      ? clamp(req.difficulty)
      : clamp((await nextDifficultyFor(userId, domain)) + inferDifficultyDelta(req.request));

  const [prefs, recent, personas] = await Promise.all([
    loadTaskPrefs(userId),
    prisma.generatedTask.findMany({ where: { userId, domain }, orderBy: { createdAt: "desc" }, take: 8, select: { title: true } }),
    personaPrompts(userId),
  ]);

  // 問題タイプと形式:
  //   明示（req.taskType）> 依頼文からの推定 > 出題設定で許可されたタイプから決定論的に選ぶ（ユーザー × 直近の作問数でばらける）
  //   推定したタイプが出題設定で除外されていれば、設定を尊重して許可タイプから選び直す（設定画面の「作問からも外れる」と整合）
  //   記述式タイプ（意見文・要約・書き換え）は free。形式ヒント（choice 等）で出せるタイプが無ければ形式の方を free に切り替える
  const kindHint: Task["kind"] | undefined = req.kind ?? (/(記述|自由|書いて|文章で|説明して|短答|数値|数字で|一言で|答えだけ|選択|4択|四択|クイズ)/.test(req.request) ? inferKind(req.request) : undefined);
  const { taskType, kind } = chooseTaskType(domain, req, prefs, kindHint, stableHash(`${userId}:${recent.length}`));

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
    const v = await verifyPythonChoice(out, domain, taskType);
    if (v.result !== "mismatch") {
      if (v.result === "fixed") console.warn(`[generate] python verify: answer index corrected -> ${v.index}`);
      break;
    }
    if (attempt === 0) {
      console.warn("[generate] python verify: no choice matches actual output; regenerating");
      out = await gen();
      continue;
    }
    // 最後の手段: 正解の選択肢を実行結果で差し替える（出力予測問題 = python のときだけ。他タイプには絶対に適用しない）
    if (taskType === "python" || taskType === undefined) {
      const idx = Number(out.answerKey[0]);
      console.warn("[generate] python verify: patching correct choice with actual output");
      out.choices[idx] = v.stdout;
    }
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
