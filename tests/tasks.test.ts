// tasks/ の整合性と採点・選択ロジックのテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TASKS,
  getTask,
  tasksFor,
  pickNextTask,
  checkDeterministic,
  checkHeuristic,
  toPublic,
  type Task,
} from "../src/lib/tasks";
import { DOMAINS, SUBSKILLS } from "../src/lib/domain";

test("全タスク: id が一意", () => {
  const ids = ALL_TASKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("全タスク: domain・skillTags・difficulty・hints の整合性", () => {
  for (const t of ALL_TASKS) {
    assert.ok((DOMAINS as readonly string[]).includes(t.domain), `${t.id}: domain`);
    assert.ok(t.skillTags.length >= 1, `${t.id}: skillTags 空`);
    for (const tag of t.skillTags) {
      assert.ok(SUBSKILLS[t.domain].includes(tag), `${t.id}: tag ${tag} は ${t.domain} の subskill でない`);
    }
    assert.ok(Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= 5, `${t.id}: difficulty`);
    assert.ok(t.hints.length >= 1 && t.hints.length <= 3, `${t.id}: hints は 1〜3 個`);
    assert.ok(t.explanation.length > 0, `${t.id}: explanation`);
    assert.ok(t.prompt.length > 0, `${t.id}: prompt`);
    assert.ok(t.id.toLowerCase().startsWith(t.domain.toLowerCase()), `${t.id}: id の接頭辞と domain`);
  }
});

test("choice タスク: answerKey が choices の範囲内の index", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "choice")) {
    assert.ok(t.choices && t.choices.length >= 2, `${t.id}: choices`);
    assert.ok(t.answerKey && t.answerKey.length >= 1, `${t.id}: answerKey`);
    for (const k of t.answerKey!) {
      const idx = Number(k);
      assert.ok(Number.isInteger(idx) && idx >= 0 && idx < t.choices!.length, `${t.id}: answerKey ${k}`);
    }
  }
});

test("short タスク: answerKey が非空", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "short")) {
    assert.ok(t.answerKey && t.answerKey.length >= 1 && t.answerKey.every((k) => k.trim().length > 0), t.id);
  }
});

test("free タスク: rubric があり criteria が非空", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "free")) {
    assert.ok(t.rubric, `${t.id}: rubric`);
    assert.ok(t.rubric!.criteria.length >= 1, `${t.id}: criteria`);
    if (t.rubric!.minLength && t.rubric!.maxLength) {
      assert.ok(t.rubric!.minLength < t.rubric!.maxLength, `${t.id}: min < max`);
    }
  }
});

test("各 domain に最低 3 タスク", () => {
  for (const d of DOMAINS) assert.ok(tasksFor(d).length >= 3, d);
});

test("getTask / tasksFor", () => {
  assert.equal(getTask("code-001")?.domain, "CODE");
  assert.equal(getTask("nope"), undefined);
  assert.ok(tasksFor("READ").every((t) => t.domain === "READ"));
});

test("checkDeterministic: short の正規化（空白・カンマ・大文字小文字・引用符）", () => {
  const t = getTask("code-001")!; // answerKey: ["[4, 1, 5]", "[4,1,5]"]
  assert.equal(checkDeterministic(t, "[4, 1, 5]"), true);
  assert.equal(checkDeterministic(t, "[4,1,5]"), true);
  assert.equal(checkDeterministic(t, "  [4 ,1,  5]  "), true);
  assert.equal(checkDeterministic(t, "[4、1、5]"), true);
  assert.equal(checkDeterministic(t, "[4, 1, 6]"), false);

  const s = getTask("code-008")!; // "mui"
  assert.equal(checkDeterministic(s, "MUI"), true);
  assert.equal(checkDeterministic(s, "'mui'"), true);
  assert.equal(checkDeterministic(s, '"mui"'), true);
  assert.equal(checkDeterministic(s, " mui \n"), true);
  assert.equal(checkDeterministic(s, "ium"), false);
});

test("checkDeterministic: choice は index 文字列の完全一致（trim あり）", () => {
  const t = getTask("read-001")!; // answerKey ["1"]
  assert.equal(checkDeterministic(t, "1"), true);
  assert.equal(checkDeterministic(t, " 1 "), true);
  assert.equal(checkDeterministic(t, "0"), false);
  assert.equal(checkDeterministic(t, ""), false);
});

test("checkDeterministic: free は null", () => {
  const t = getTask("write-001")!;
  assert.equal(checkDeterministic(t, "何か書いた"), null);
});

test("checkHeuristic: minLength / maxLength / mustInclude", () => {
  const t = getTask("write-003")!; // min 15, max 70, mustInclude 学習/記録/次
  const ok = checkHeuristic(t, "このアプリは学習記録をもとに、次にやるべきことを示します。");
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.reasons, []);

  const short = checkHeuristic(t, "学習記録。次。");
  assert.equal(short.pass, false);
  assert.ok(short.reasons.some((r) => r.includes("短すぎ")));

  const long = checkHeuristic(t, "学習の記録を見て次にやることが分かる。".repeat(6));
  assert.equal(long.pass, false);
  assert.ok(long.reasons.some((r) => r.includes("長すぎ")));

  const missing = checkHeuristic(t, "このアプリはユーザーに何かを示すための便利な道具です。");
  assert.equal(missing.pass, false);
  assert.ok(missing.reasons.some((r) => r.includes("評価観点")));
});

test("checkHeuristic: rubric 無しは非空なら pass", () => {
  const t: Task = { ...getTask("write-001")!, rubric: undefined };
  assert.equal(checkHeuristic(t, "x").pass, true);
  assert.equal(checkHeuristic(t, "   ").pass, false);
});

test("pickNextTask: 未回答を優先し、目標難易度に近いものを選ぶ", () => {
  const t = pickNextTask("CODE", 4, []);
  assert.equal(t.domain, "CODE");
  assert.equal(Math.abs(t.difficulty - 4), 0);
  const easy = pickNextTask("CODE", 1, []);
  assert.equal(easy.difficulty, Math.min(...tasksFor("CODE").map((x) => x.difficulty)));
});

test("pickNextTask: 全て回答済みなら失敗したものを優先", () => {
  const pool = tasksFor("CODE");
  const history = pool.map((t, i) => ({
    taskId: t.id,
    success: t.id !== "code-005",
    createdAt: new Date(2026, 0, 1 + i),
  }));
  assert.equal(pickNextTask("CODE", 3, history).id, "code-005");
});

test("pickNextTask: 同じタスクの複数履歴は最新が使われる（失敗→成功なら成功扱い）", () => {
  const pool = tasksFor("CODE");
  const history = pool.map((t, i) => ({ taskId: t.id, success: true, createdAt: new Date(2026, 0, 10 + i) }));
  // code-005 は昔失敗、後で成功 → 失敗扱いにならない
  history.push({ taskId: "code-005", success: false, createdAt: new Date(2026, 0, 1) });
  const picked = pickNextTask("CODE", 3, history);
  assert.notEqual(picked.id, "code-005");
});

test("pickNextTask: 全て成功済みなら最も古いものを返す", () => {
  const pool = tasksFor("READ");
  const history = pool.map((t, i) => ({ taskId: t.id, success: true, createdAt: new Date(2026, 0, 1 + i) }));
  assert.equal(pickNextTask("READ", 3, history).id, pool[0].id);
});

test("pickNextTask: preferredTaskId は同 domain のときだけ尊重", () => {
  assert.equal(pickNextTask("CODE", 3, [], "code-006").id, "code-006");
  assert.notEqual(pickNextTask("CODE", 3, [], "read-001").id, "read-001");
  assert.equal(pickNextTask("CODE", 3, [], "nope").domain, "CODE");
});

test("toPublic: answerKey / hints / explanation / rubric を落とす", () => {
  const t = getTask("code-007")!;
  const p = toPublic(t) as Record<string, unknown>;
  for (const k of ["answerKey", "hints", "explanation", "rubric"]) assert.ok(!(k in p), k);
  assert.equal(p.id, t.id);
  assert.equal(p.prompt, t.prompt);
  assert.equal(p.passage, t.passage);
});
