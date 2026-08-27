// 問題タイプ定義と出題設定（純粋関数）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPOSITE_TYPE,
  DEFAULT_TASK_PREFS,
  TASK_TYPES,
  allTaskTypeKeys,
  allowedTaskTypes,
  isCompositeAxes,
  parseTaskPrefs,
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
