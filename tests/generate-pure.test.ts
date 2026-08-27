// 作問結果の正規化・Python 出力照合のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikePython, normalizeGenerated, normalizeOutput } from "../src/lib/learn/generate.pure";

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
