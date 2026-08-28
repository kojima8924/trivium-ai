// /api/agent/context（Dify Chatflow 向けコンテキスト）の整形部分のテスト。
// DB に触らない純粋関数だけを検証する（答え・ヒント・解説を漏らさないこと／会話の並び／推薦系統の決定論）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayNameOf,
  formatPersona,
  orderRecentChat,
  pickRecommendedDomain,
  publicCurrentTask,
  subskillLabel,
  weakestSubskillOf,
} from "../src/lib/agent-context.pure";
import type { Task } from "../src/lib/tasks";

test("displayNameOf: 名前があれば「さん」付け、無ければ「あなた」", () => {
  assert.equal(displayNameOf("小嶋明"), "小嶋明さん");
  assert.equal(displayNameOf("  空白  "), "空白さん");
  assert.equal(displayNameOf(""), "あなた");
  assert.equal(displayNameOf(null), "あなた");
  assert.equal(displayNameOf(undefined), "あなた");
});

test("formatPersona: 口調キーを表示名＋説明に展開する（未知のキーはそのまま）", () => {
  const p = formatPersona({ name: "ヨミ", tone: "polite", firstPerson: "我", extra: "黄泉の司書" });
  assert.equal(p.name, "ヨミ");
  assert.equal(p.tone, "丁寧");
  assert.ok(p.toneDescription.length > 0, "口調の説明が入る");
  assert.equal(p.firstPerson, "我");
  assert.equal(p.extra, "黄泉の司書");

  const unknown = formatPersona({ name: "X", tone: "no-such-tone", firstPerson: "私", extra: "" });
  assert.equal(unknown.tone, "no-such-tone");
  assert.equal(unknown.toneDescription, "");
});

test("subskillLabel / weakestSubskillOf: 最も低い小分類を安定して選び、日本語ラベルにする", () => {
  assert.equal(weakestSubskillOf({}), null);
  assert.equal(weakestSubskillOf({ comprehension: 60, inference: 40, critical_reading: 55 }), "inference");
  // 同点はキー順で安定（呼ぶたびに変わらない）
  assert.equal(weakestSubskillOf({ tracing: 50, algorithms: 50 }), "algorithms");
  assert.equal(subskillLabel("inference"), "推論");
  assert.equal(subskillLabel("unknown_key"), "unknown_key");
  assert.equal(subskillLabel(null), null);
});

test("orderRecentChat: 新しい順の行を古い順に直し、role が不正な行は落とす", () => {
  const rows = [
    { agent: "LEADER", role: "assistant", text: "3番目" },
    { agent: "LEADER", role: "user", text: "2番目" },
    { agent: "READ", role: "system", text: "落とす" },
    { agent: "READ", role: "assistant", text: "1番目" },
  ];
  const out = orderRecentChat(rows);
  assert.deepEqual(
    out.map((t) => t.text),
    ["1番目", "2番目", "3番目"],
  );
  assert.equal(out[0].agent, "READ");
  assert.equal(out[0].role, "assistant");
  // limit は「新しい方から」数える
  const limited = orderRecentChat(rows, 2);
  assert.deepEqual(
    limited.map((t) => t.text),
    ["2番目", "3番目"],
  );
});

test("publicCurrentTask: 答え・ヒント・解説・ルーブリックを含めない", () => {
  const task = {
    id: "code-006",
    domain: "CODE",
    difficulty: 8,
    title: "二分探索の終了条件",
    passage: "def f(a, x):\n    ...",
    prompt: "出力は？",
    kind: "choice",
    choices: ["A", "B", "C", "D"],
    answerKey: ["2"],
    rubric: { criteria: ["秘密"] },
    hints: ["ヒント1", "ヒント2", "ヒント3"],
    explanation: "正解は C",
    skillTags: ["tracing"],
  } as unknown as Task;

  const out = publicCurrentTask(task);
  assert.ok(out);
  assert.equal(out.id, "code-006");
  assert.equal(out.difficulty, 8);
  assert.deepEqual(out.choices, ["A", "B", "C", "D"]);
  const serialized = JSON.stringify(out);
  for (const secret of ["answerKey", "hints", "explanation", "rubric", "正解は C", "ヒント1", "秘密"]) {
    assert.ok(!serialized.includes(secret), `${secret} が漏れている`);
  }
  assert.equal(publicCurrentTask(null), null);
});

test("publicCurrentTask: passage / choices が無い課題でも空で埋める", () => {
  const task = { id: "write-001", domain: "WRITE", difficulty: 4, title: "意見文", prompt: "書いて", kind: "free", hints: [], explanation: "", skillTags: ["structure"] } as unknown as Task;
  const out = publicCurrentTask(task);
  assert.equal(out?.passage, "");
  assert.deepEqual(out?.choices, []);
});

test("pickRecommendedDomain: 保存済みの推薦を優先し、無ければ未計測→低レベルの順", () => {
  const levels = { READ: 6, WRITE: 4, CODE: 7 };
  const evidence = { READ: 12, WRITE: 8, CODE: 20 };
  assert.equal(pickRecommendedDomain("CODE", levels, evidence), "CODE");
  // 不正な保存値は無視して決定論のフォールバック
  assert.equal(pickRecommendedDomain("NOPE", levels, evidence), "WRITE");
  assert.equal(pickRecommendedDomain(null, levels, evidence), "WRITE");
  // 未計測（証拠 0）があればそちらを先に
  assert.equal(pickRecommendedDomain(null, { READ: 6, WRITE: 4, CODE: 0 }, { READ: 12, WRITE: 8, CODE: 0 }), "CODE");
  // すべて未計測なら DOMAINS の順（READ）
  assert.equal(pickRecommendedDomain(null, { READ: 0, WRITE: 0, CODE: 0 }, { READ: 0, WRITE: 0, CODE: 0 }), "READ");
});
