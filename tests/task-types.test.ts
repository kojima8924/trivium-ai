// 問題タイプ定義と出題設定（純粋関数）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPOSITE_TYPE,
  DEFAULT_TASK_PREFS,
  applyPythonChoice,
  TASK_TYPES,
  allTaskTypeKeys,
  allowedTaskTypes,
  isCompositeAxes,
  parseTaskPrefs,
  pythonGateAllows,
  PYTHON_GATE_MAX_DIFFICULTY,
  PYTHON_TASK_TYPES,
  taskAllowedByPrefs,
  taskPrefsLeaveSomething,
  taskTypeLabel,
} from "../src/lib/task-types";
import { DOMAINS } from "../src/lib/domain";

test("問題タイプ: 各系統 5 タイプでキーが一意、composite と重ならない", () => {
  for (const d of DOMAINS) {
    const keys = allTaskTypeKeys(d);
    assert.equal(keys.length, 5, d);
    assert.equal(new Set(keys).size, keys.length, d);
    assert.ok(!keys.includes(COMPOSITE_TYPE.key), d);
    for (const t of TASK_TYPES[d]) assert.ok(t.label && t.description, `${d}/${t.key}`);
  }
});

test("taskTypeLabel: 定義済みは表示名、composite は共通ラベル、未知はキーのまま", () => {
  assert.equal(taskTypeLabel("CODE", "python"), "Python 読解");
  assert.equal(taskTypeLabel("WRITE", "argument"), "意見文（記述）");
  assert.equal(taskTypeLabel("READ", "composite"), COMPOSITE_TYPE.label);
  assert.equal(taskTypeLabel("READ", "nope"), "nope");
});

test("parseTaskPrefs: 不正な値は捨てて既定に、未知キーは無視", () => {
  assert.deepEqual(parseTaskPrefs(undefined), DEFAULT_TASK_PREFS);
  assert.deepEqual(parseTaskPrefs({ excludedTaskTypes: { CODE: ["python", "nope", 3], READ: "x" }, excludeComposite: "yes" }), {
    excludedTaskTypes: { READ: [], WRITE: [], CODE: ["python"] },
    excludeComposite: false,
    pythonPrompted: false,
  });
  assert.equal(parseTaskPrefs({ excludeComposite: true }).excludeComposite, true);
});

test("taskPrefsLeaveSomething: 系統のタイプを全部外すと NG", () => {
  const all = allTaskTypeKeys("CODE");
  assert.deepEqual(taskPrefsLeaveSomething({ ...DEFAULT_TASK_PREFS, excludedTaskTypes: { READ: [], WRITE: [], CODE: all } }), { ok: false, domain: "CODE" });
  assert.deepEqual(taskPrefsLeaveSomething({ ...DEFAULT_TASK_PREFS, excludedTaskTypes: { READ: [], WRITE: [], CODE: all.slice(1) } }), { ok: true });
});

test("taskAllowedByPrefs: 除外タイプと複合の扱い", () => {
  const prefs = parseTaskPrefs({ excludedTaskTypes: { CODE: ["python"] }, excludeComposite: true });
  assert.equal(taskAllowedByPrefs({ domain: "CODE", taskType: "python" }, prefs), false);
  assert.equal(taskAllowedByPrefs({ domain: "CODE", taskType: "puzzle" }, prefs), true);
  assert.equal(taskAllowedByPrefs({ domain: "CODE" }, prefs), true, "taskType 未設定は常に可");
  assert.equal(taskAllowedByPrefs({ domain: "READ", taskType: "composite" }, prefs), false);
  assert.equal(taskAllowedByPrefs({ domain: "READ", taskType: "summary", axes: { read: 5, code: 3 } }, prefs), false, "axes が 2 系統なら複合扱い");
  assert.equal(taskAllowedByPrefs({ domain: "READ", taskType: "summary", axes: { read: 5, code: 3 } }, DEFAULT_TASK_PREFS), true);
});

test("allowedTaskTypes: kind で記述式タイプを出し分ける", () => {
  const prefs = parseTaskPrefs({ excludedTaskTypes: { WRITE: ["argument"] } });
  assert.deepEqual(allowedTaskTypes("WRITE", prefs, "free"), ["summary", "rewrite"]);
  assert.deepEqual(allowedTaskTypes("WRITE", prefs, "choice"), ["revision", "structure"]);
  assert.deepEqual(allowedTaskTypes("CODE", DEFAULT_TASK_PREFS, "free"), []);
  assert.equal(allowedTaskTypes("READ", DEFAULT_TASK_PREFS).length, 5);
});

test("isCompositeAxes: 2 系統以上が正のときだけ true", () => {
  assert.equal(isCompositeAxes(undefined), false);
  assert.equal(isCompositeAxes({ read: 5 }), false);
  assert.equal(isCompositeAxes({ read: 5, code: 0 }), false);
  assert.equal(isCompositeAxes({ read: 5, code: 2 }), true);
});

test("taskPrefsLeaveSomething: 選択式タイプを全部外すと LINE で出せないので NG（kind: choice）", () => {
  const r = taskPrefsLeaveSomething({ ...DEFAULT_TASK_PREFS, excludedTaskTypes: { READ: [], WRITE: ["revision", "structure"], CODE: [] } });
  assert.deepEqual(r, { ok: false, domain: "WRITE", kind: "choice" });
  const ok = taskPrefsLeaveSomething({ ...DEFAULT_TASK_PREFS, excludedTaskTypes: { READ: [], WRITE: ["revision", "argument", "summary", "rewrite"], CODE: [] } });
  assert.deepEqual(ok, { ok: true });
});

// ---- Python ゲート: 易しい帯（難易度 1〜3）は Python 未経験者に出さない ----
// LOGIC は「論理」を測る系統なので、文法を知らないだけで失敗＝否定証拠になるのを避ける。

test("Python ゲート: 未経験者には易しい Python 系を出さない", () => {
  const ctx = { solvedPythonBefore: false };
  for (const type of PYTHON_TASK_TYPES) {
    for (let d = 1; d <= PYTHON_GATE_MAX_DIFFICULTY; d++) {
      assert.equal(pythonGateAllows({ difficulty: d, taskType: type }, ctx), false, `${type} 難易度${d} は出さない`);
    }
    assert.equal(pythonGateAllows({ difficulty: PYTHON_GATE_MAX_DIFFICULTY + 1, taskType: type }, ctx), true, `${type} は難易度4以上なら出す`);
  }
});

test("Python ゲート: 非 Python のタイプと難易度の高い課題はそのまま通す", () => {
  const ctx = { solvedPythonBefore: false };
  for (const type of ["puzzle", "math", "algorithm", "summary", undefined]) {
    assert.equal(pythonGateAllows({ difficulty: 1, taskType: type }, ctx), true, `${type} は難易度1でも通す`);
  }
  assert.equal(pythonGateAllows({ difficulty: 10, taskType: "python" }, ctx), true);
});

test("Python ゲート: 一度 Python 系で正解していれば易しい帯も解禁", () => {
  assert.equal(pythonGateAllows({ difficulty: 1, taskType: "python" }, { solvedPythonBefore: true }), true);
  assert.equal(pythonGateAllows({ difficulty: 2, taskType: "debug" }, { solvedPythonBefore: true }), true);
});

test("Python ゲート: 本人が Python を指定したときは希望を優先する（「Pythonやさしめ」）", () => {
  assert.equal(pythonGateAllows({ difficulty: 1, taskType: "python" }, { solvedPythonBefore: false, requestedTaskType: "python" }), true);
  assert.equal(pythonGateAllows({ difficulty: 1, taskType: "debug" }, { solvedPythonBefore: false, requestedTaskType: "debug" }), true);
  // 別のタイプを指定しているときは解禁しない
  assert.equal(pythonGateAllows({ difficulty: 1, taskType: "python" }, { solvedPythonBefore: false, requestedTaskType: "puzzle" }), false);
});

// ---- 「Python の問題を含めますか？」（LOGIC 初回の確認カード）----

test("Python の確認: 「含めない」で Python 読解・バグ発見が除外され、確認済みになる", () => {
  const after = applyPythonChoice(DEFAULT_TASK_PREFS, false);
  for (const t of PYTHON_TASK_TYPES) assert.ok(after.excludedTaskTypes.CODE.includes(t), `${t} が除外される`);
  assert.equal(after.pythonPrompted, true);
  // 出題不能にはならない（LOGIC には論理パズル・数的推理・手順設計が残る）
  assert.equal(taskPrefsLeaveSomething(after).ok, true);
  assert.ok(allowedTaskTypes("CODE", after, "choice").length > 0);
});

test("Python の確認: 「含める」なら除外されず、確認済みになる", () => {
  const after = applyPythonChoice(DEFAULT_TASK_PREFS, true);
  for (const t of PYTHON_TASK_TYPES) assert.ok(!after.excludedTaskTypes.CODE.includes(t));
  assert.equal(after.pythonPrompted, true);
});

test("Python の確認: あとから「含める」に変えると除外が解け、他系統の設定は保たれる", () => {
  const base = { ...DEFAULT_TASK_PREFS, excludedTaskTypes: { READ: ["data"], WRITE: [], CODE: ["math"] }, excludeComposite: true };
  const off = applyPythonChoice(base, false);
  const on = applyPythonChoice(off, true);
  assert.deepEqual(on.excludedTaskTypes.CODE, ["math"], "Python 以外の除外は残る");
  assert.deepEqual(on.excludedTaskTypes.READ, ["data"], "他系統の設定は触らない");
  assert.equal(on.excludeComposite, true);
});

test("Python の確認: pythonPrompted は既定 false、JSON から復元できる", () => {
  assert.equal(DEFAULT_TASK_PREFS.pythonPrompted, false);
  assert.equal(parseTaskPrefs({}).pythonPrompted, false);
  assert.equal(parseTaskPrefs({ pythonPrompted: true }).pythonPrompted, true);
  assert.equal(parseTaskPrefs({ pythonPrompted: "yes" }).pythonPrompted, false, "真偽値以外は false");
});
