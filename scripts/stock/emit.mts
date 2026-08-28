// 採用した問題の保存と書き出し。scripts/stock/out/<DOMAIN>.json へのチェックポイントと、
// src/lib/tasks/stock/<domain>.generated.ts の生成（選択肢は id ごとに回転させ、正解位置の偏りを消す）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SUBSKILLS } from "../../src/lib/domain";
import { GEN_MODEL, OUT_DIR, REVIEW_MODEL, SOLVER_MODEL, STOCK_DIR, type Axis, type Domain, type Slot, type StockTask } from "./config.mjs";
import type { Gen } from "./prompts.mjs";

// ---- 出力 ----
/**
 * 複合問題の axes と主系統。主系統は難易度 d、他の系統は d-1（主系統が厳密な最大になるように。tests の「domain が最大系統」に合わせる）。
 * d=1 は全系統 1 の同点になるので、read → write → code の順で先の系統を主系統にする。
 */
export function compositeAxes(s: Slot): { domain: Axis; axes: NonNullable<StockTask["axes"]> } {
  const order: Axis[] = ["READ", "WRITE", "CODE"];
  const involved = order.filter((a) => s.spec.axes.includes(a));
  const primary: Axis = s.difficulty >= 2 ? s.spec.primary : involved[0];
  const axes = Object.fromEntries(involved.map((a) => [a.toLowerCase(), a === primary ? s.difficulty : Math.max(1, s.difficulty - 1)])) as NonNullable<StockTask["axes"]>;
  return { domain: primary, axes };
}

export function toTask(s: Slot, g: Gen, id: string): StockTask {
  const kind = s.spec.kind;
  const mix = s.domain === "MIX" ? compositeAxes(s) : null;
  const domain: Axis = mix ? mix.domain : s.spec.primary;
  const skillTags = g.skill_tags.filter((t) => SUBSKILLS[domain].includes(t));
  const base: StockTask = {
    id,
    domain,
    difficulty: s.difficulty,
    ...(mix ? { axes: mix.axes } : {}),
    title: g.title,
    passage: g.passage || undefined,
    prompt: g.prompt,
    kind,
    taskType: s.domain === "MIX" ? "composite" : s.spec.key,
    hints: g.hints,
    explanation: g.explanation,
    skillTags: skillTags.length ? skillTags : [SUBSKILLS[domain][0]],
  };
  if (kind === "choice") return { ...base, choices: g.choices, answerKey: [String(g.answer_index)] };
  const n = g.model_answer.length;
  const minLength = Math.max(20, Math.round(n * 0.6));
  const maxLength = Math.max(minLength + 40, Math.round(n * 1.6));
  return { ...base, rubric: { mustInclude: g.must_include.filter(Boolean).slice(0, 6), minLength, maxLength, criteria: g.rubric_criteria, sampleAnswer: g.model_answer } };
}

export type Checkpoint = Record<string, StockTask & { rating?: number }>;
export function loadCheckpoint(domain: Domain): Checkpoint {
  const p = path.join(OUT_DIR, `${domain}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Checkpoint) : {};
}
export function saveCheckpoint(domain: Domain, cp: Checkpoint): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `${domain}.json`), JSON.stringify(cp, null, 2));
}
/** id から決定論的に 0..3 を返す（FNV-1a） */
export function rotationOf(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 4;
}

/** 選択式は正解の位置が偏らないよう、id ごとに選択肢を回転させる（answerKey も同時に写像） */
export function rotateChoices(t: StockTask): StockTask {
  if (t.kind !== "choice" || !t.choices || t.choices.length !== 4 || !t.answerKey) return t;
  const r = rotationOf(t.id);
  if (r === 0) return t;
  const choices = t.choices.map((_, i) => t.choices![(i - r + 4) % 4]);
  const answer = (Number(t.answerKey[0]) + r) % 4;
  return { ...t, choices, answerKey: [String(answer)] };
}

export function emit(domain: Domain, cp: Checkpoint): number {
  const tasks = Object.values(cp)
    .map(({ rating: _r, ...t }) => {
      void _r;
      return rotateChoices(t);
    })
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  const name = `${domain}_STOCK`;
  const body = [
    "// 自動生成ファイル（scripts/stock/gen_stock.mts が書き出す）。手で編集しない。",
    `// ${domain}: ${tasks.length} 問（difficulty 1〜10・問題タイプ付き）。生成: ${GEN_MODEL} / 検証: Python 実行 + 独立ソルバー ${SOLVER_MODEL} + レビュー ${REVIEW_MODEL}`,
    'import type { Task } from "../types";',
    "",
    `export const ${name}: Task[] = ${JSON.stringify(tasks, null, 2)};`,
    "",
  ].join("\n");
  mkdirSync(STOCK_DIR, { recursive: true });
  writeFileSync(path.join(STOCK_DIR, `${domain.toLowerCase()}.generated.ts`), body);
  return tasks.length;
}
