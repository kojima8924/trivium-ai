// 生成された 1 問を採用してよいか判定する。構造チェック → python / debug は実際に実行 →
// 4 択は正解を伏せた独立ソルバー、記述はレビュー担当に通し、難易度のずれも見る。合格したものだけ採用する。
import { spawnSync } from "node:child_process";
import { SUBSKILLS } from "../../src/lib/domain";
import { normalizeOutput } from "../../src/lib/learn/generate.pure";
import { OUT_DIR, REVIEW_MODEL, SOLVER_MODEL, type Slot } from "./config.mjs";
import { allowedTags, slotKey } from "./plan.mjs";
import { REVIEW_ROLE, SOLVER_ROLE, fmt, reviewSchema, solveSchema, type Gen } from "./prompts.mjs";
import { parse } from "./codex.mjs";

// ---- 検証 ----
export function nl(t: string): string {
  return t.replace(/\\n/g, "\n").replace(/\\t/g, "    ").replace(/\r/g, "").trim();
}
export function runPython(code: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("python", ["-I", "-c", code], { timeout: 5000, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, cwd: OUT_DIR });
  if (r.error) return { stdout: "", stderr: r.error.message, status: -1 };
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}
export const FORBIDDEN = /\b(input\(|random|datetime|time\.|open\(|os\.|sys\.|subprocess|socket|requests)/;

export type Verified = { ok: true; gen: Gen; rating?: number } | { ok: false; reason: string };

export async function verify(s: Slot, g0: Gen): Promise<Verified> {
  const g: Gen = { ...g0, title: nl(g0.title), passage: nl(g0.passage), prompt: nl(g0.prompt), explanation: nl(g0.explanation), choices: g0.choices.map(nl), hints: g0.hints.map(nl), model_answer: nl(g0.model_answer) };
  const kind = s.spec.kind;
  const shown = g.title + g.passage + g.prompt + g.choices.join("") + g.hints.join("") + g.explanation;
  if (/`/.test(shown)) return { ok: false, reason: "backtick" };
  if (g.hints.length !== 3 || g.hints.some((h) => h.length < 4)) return { ok: false, reason: "hints" };
  if (g.explanation.length < 10) return { ok: false, reason: "explanation" };
  if (!g.prompt) return { ok: false, reason: "prompt empty" };
  g.title = g.title.replace(/^\s*(READ|WRITE|LOGIC|CODE|MIX)\s*[:：]\s*/i, "").slice(0, 40);
  const tags = allowedTags(s);
  g.skill_tags = g.skill_tags.filter((t) => tags.includes(t));
  if (g.skill_tags.length === 0) g.skill_tags = [SUBSKILLS[s.spec.primary][0]];

  if (kind === "free") {
    if (g.rubric_criteria.length < 3) return { ok: false, reason: "rubric" };
    if (g.must_include.filter(Boolean).length < 2) return { ok: false, reason: "must_include" };
    g.choices = [];
    const len = g.model_answer.length;
    const [lo, hi] = s.difficulty <= 2 ? [25, 90] : s.difficulty <= 4 ? [40, 130] : s.difficulty <= 6 ? [70, 200] : s.difficulty <= 8 ? [110, 280] : [150, 340];
    if (len < lo || len > hi) return { ok: false, reason: `model_answer length ${len} (want ${lo}〜${hi})` };
    const minL = Math.max(20, Math.round(len * 0.6));
    const maxL = Math.max(minL + 40, Math.round(len * 1.6));
    for (const h of g.hints) {
      const hl = [...h].length;
      const hits = g.must_include.filter((w) => w && h.includes(w)).length;
      if (hl >= minL && hl <= maxL && hits >= 2 && !/[？?]\s*$/.test(h)) return { ok: false, reason: "hint looks like a full answer" };
    }
    const r = await parse(REVIEW_MODEL, REVIEW_ROLE, [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("rubric", g.rubric_criteria), fmt("model_answer", g.model_answer)].join("\n\n"), reviewSchema, "review", "low", 400);
    if (r.score < 4) return { ok: false, reason: `review ${r.score}: ${r.issues.slice(0, 80)}` };
    return { ok: true, gen: g };
  }

  if (g.choices.length !== 4) return { ok: false, reason: `choices ${g.choices.length}` };
  const norm = g.choices.map((c) => normalizeOutput(c));
  if (new Set(norm).size !== 4 || norm.some((c) => !c)) return { ok: false, reason: "duplicate/empty choice" };
  if (g.answer_index < 0 || g.answer_index > 3) return { ok: false, reason: "answer_index" };
  if (g.hints.some((h) => norm.includes(normalizeOutput(h)))) return { ok: false, reason: "hint equals a choice" };
  // 正解だけが目立って長い（2 番目に長い選択肢の 1.25 倍超）と「長いのが正解」で解けてしまう
  if (s.spec.key !== "python") {
    const lens = g.choices.map((c) => [...c].length);
    const correct = lens[g.answer_index];
    const others = lens.filter((_, i) => i !== g.answer_index);
    if (correct > Math.max(...others) * 1.15 && correct - Math.max(...others) > 6) return { ok: false, reason: `correct choice is longest (${correct} vs ${Math.max(...others)})` };
  }
  if ((s.domain === "READ" || s.domain === "MIX") && g.hints.some((h) => /(しかし|ただし|だが|一方で)/.test(h))) return { ok: false, reason: "hint spells out the connective" };

  if (s.spec.key === "python") {
    if (!/print\(/.test(g.passage)) return { ok: false, reason: "no print" };
    if (FORBIDDEN.test(g.passage)) return { ok: false, reason: "forbidden construct" };
    const run = runPython(g.passage);
    if (run.status !== 0) return { ok: false, reason: `python error: ${run.stderr.slice(-80)}` };
    const actual = normalizeOutput(run.stdout);
    if (!actual) return { ok: false, reason: "empty stdout" };
    const idx = norm.findIndex((c) => c === actual);
    if (idx < 0) return { ok: false, reason: `no choice matches stdout (${run.stdout.trim().slice(0, 60)})` };
    if (idx !== g.answer_index) {
      console.warn(`  [fix] ${slotKey(s)}: answer_index ${g.answer_index} -> ${idx}`);
      g.answer_index = idx;
    }
    g.choices[idx] = run.stdout.trim();
    return { ok: true, gen: g };
  }
  if (s.spec.key === "debug") {
    if (FORBIDDEN.test(g.passage)) return { ok: false, reason: "forbidden construct" };
    const run = runPython(g.passage);
    // バグ入りコードは「動くが結果が違う」か「例外で止まる」のどちらでもよいが、少なくとも Python として読み込めること
    if (run.status === -1 || /SyntaxError|IndentationError/.test(run.stderr)) return { ok: false, reason: "buggy code does not parse" };
  }

  const sol = await parse(
    SOLVER_MODEL,
    SOLVER_ROLE,
    [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("choices", g.choices.map((c, i) => `${i}: ${c}`)), fmt("hints", g.hints)].join("\n\n"),
    solveSchema,
    "solution",
    s.difficulty >= 7 || ["puzzle", "math", "algorithm", "debug", "read_code"].includes(s.spec.key) ? "high" : "medium",
    4000,
  );
  if (sol.hints_leak_answer) return { ok: false, reason: "hints leak answer" };
  if (!sol.hand_solvable) return { ok: false, reason: `not hand-solvable: ${sol.note.slice(0, 80)}` };
  // 数的推理・パズルで「1〜10000」のような大きな範囲の数え上げは機械的に弾く
  if (["math", "puzzle", "algorithm", "read_code"].includes(s.spec.key) && /([1-9]\d{3,}|[1-9]\d{2,}\s*(まで|個|通り|人|回))/.test(g.passage + g.prompt) && /(何個|いくつ|何通り|数えよ|個数)/.test(g.prompt)) {
    return { ok: false, reason: "large-range counting problem" };
  }
  if (sol.ambiguous) return { ok: false, reason: `ambiguous: ${sol.note.slice(0, 80)}` };
  if (sol.answer_index !== g.answer_index) return { ok: false, reason: `solver disagrees (${sol.answer_index} vs ${g.answer_index}): ${sol.note.slice(0, 80)}` };
  // 難易度: LOGIC は評価との差が大きいものを弾く（8 以上は許容幅を広げる）。READ / WRITE / MIX は「明らかに難しすぎ」だけ弾く
  if (s.domain === "CODE") {
    const tol = s.difficulty >= 8 ? 4 : 3;
    if (Math.abs(sol.difficulty_rating - s.difficulty) > tol) return { ok: false, reason: `difficulty rated ${sol.difficulty_rating} (target ${s.difficulty})` };
  } else if (sol.difficulty_rating - s.difficulty > 3) {
    return { ok: false, reason: `too hard: rated ${sol.difficulty_rating} (target ${s.difficulty})` };
  }
  return { ok: true, gen: g, rating: sol.difficulty_rating };
}
