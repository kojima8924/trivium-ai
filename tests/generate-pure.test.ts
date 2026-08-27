// 作問結果の正規化・Python 出力照合のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseTaskType, inferTaskTypeFromRequest, looksLikePython, normalizeGenerated, normalizeOutput, stableHash } from "../src/lib/learn/generate.pure";
import { DEFAULT_TASK_PREFS, type TaskPrefs } from "../src/lib/task-types";

test("normalizeGenerated: 文字列の \n を改行にし、title の domain 接頭辞を外す", () => {
  const out = normalizeGenerated({
    title: "LOGIC: 辞書更新",
    passage: "x = 1\nprint(x)",
    prompt: "出力は？",
    choices: ["[('a', 2)]\n{'a': 5}", "1"],
    explanation: "a\nb",
  });
  assert.equal(out.title, "辞書更新");
  assert.equal(out.passage, "x = 1\nprint(x)");
  assert.equal(out.choices[0], "[('a', 2)]\n{'a': 5}");
  assert.equal(out.explanation, "a\nb");
});

test("normalizeOutput: 引用符の種類・空白・行末を無視して比較できる", () => {
  const actual = "[('a', 2), ('b', 4), ('c', 6)]\n{'a': 5, 'b': 5, 'c': 2}\n";
  assert.equal(normalizeOutput(actual), normalizeOutput('[("a", 2), ("b", 4), ("c", 6)]\n{"a": 5, "b": 5, "c": 2}'));
  assert.notEqual(normalizeOutput(actual), normalizeOutput('[("a", 2), ("b", 4), ("c", 2)]\n{"a": 5, "b": 5, "c": 2}'));
});

test("looksLikePython: print を含むコードだけ対象", () => {
  assert.equal(looksLikePython("data = [1, 2]\nfor x in data:\n    print(x)"), true);
  assert.equal(looksLikePython("次の条件から順番を推理せよ。A は B より前。"), false);
});

test("stableHash: 決定論的で、入力が違えば（ほぼ）違う値", () => {
  assert.equal(stableHash("u1:0"), stableHash("u1:0"));
  assert.notEqual(stableHash("u1:0"), stableHash("u1:1"));
});

const prefs = (over: Partial<TaskPrefs["excludedTaskTypes"]>): TaskPrefs => ({
  ...DEFAULT_TASK_PREFS,
  excludedTaskTypes: { ...DEFAULT_TASK_PREFS.excludedTaskTypes, ...over },
});

test("chooseTaskType: 依頼文の推定は出題設定で除外されていれば採用しない", () => {
  assert.equal(inferTaskTypeFromRequest("CODE", "関数の問題を出して"), "python");
  const r = chooseTaskType("CODE", { request: "関数の問題を出して" }, prefs({ CODE: ["python"] }), "choice", 0);
  assert.notEqual(r.taskType, "python");
  assert.equal(r.kind, "choice");
  // 除外されていなければ推定どおり
  assert.equal(chooseTaskType("CODE", { request: "関数の問題を出して" }, DEFAULT_TASK_PREFS, "choice", 0).taskType, "python");
  // 明示指定は設定より優先
  assert.equal(chooseTaskType("CODE", { request: "何か", taskType: "python" }, prefs({ CODE: ["python"] }), "choice", 0).taskType, "python");
});

test("chooseTaskType: 推定できない依頼は許可タイプから seed で決定論的に選ぶ（先頭固定ではない）", () => {
  const picks = new Set(Array.from({ length: 12 }, (_, seed) => chooseTaskType("CODE", { request: "LOGICで難易度8の問題" }, DEFAULT_TASK_PREFS, "choice", seed).taskType));
  assert.ok(picks.size >= 3, `ばらけていない: ${[...picks].join(",")}`);
  assert.equal(chooseTaskType("CODE", { request: "x" }, DEFAULT_TASK_PREFS, "choice", 7).taskType, chooseTaskType("CODE", { request: "x" }, DEFAULT_TASK_PREFS, "choice", 7).taskType);
});

test("chooseTaskType: 選択式で出せるタイプが無ければ形式を free に切り替える（意見文の 4 択を作らない）", () => {
  const r = chooseTaskType("WRITE", { request: "WRITEで難易度8の問題" }, prefs({ WRITE: ["revision", "structure"] }), "choice", 0);
  assert.equal(r.kind, "free");
  assert.ok(["argument", "summary", "rewrite"].includes(r.taskType ?? ""), r.taskType);
});
