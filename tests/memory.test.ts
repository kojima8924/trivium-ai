// 観察メモ・会話履歴・宛先判定の純粋関数（server-only モジュールは読まない）
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerExcerpt, sanitizeNotes } from "../src/lib/memory.pure";
import { trimHistory } from "../src/lib/line/chat.pure";
import { detectAddressedAgent } from "../src/lib/persona.pure";
import { PERSONA_DEFAULTS } from "../src/config/trivium.config";

test("sanitizeNotes: 数値つきの評価語は伏せられ、上限字数で切られる", () => {
  const out = sanitizeNotes("正答率は85%で安定。3回ヒントを使った。難易度7の問題で詰まる傾向。", 400);
  assert.ok(!/85%/.test(out));
  assert.ok(!/3回/.test(out));
  assert.ok(/（数値）/.test(out));
  assert.equal([...sanitizeNotes("あ".repeat(500), 400)].length, 400);
});

test("sanitizeNotes: 空白の連続と余分な改行を整える", () => {
  assert.equal(sanitizeNotes("行動  の\n\n\n\n傾向", 400), "行動 の\n\n傾向");
});

test("answerExcerpt: 改行を空白にして先頭 N 字だけ", () => {
  const out = answerExcerpt("一行目\n二行目\n" + "x".repeat(300), 20);
  assert.equal([...out].length, 20);
  assert.ok(!out.includes("\n"));
});

test("trimHistory: 直近 N 往復だけ残す（assistant の数で数える）", () => {
  const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), text: `t${i}` }));
  const out = trimHistory(turns, 10);
  assert.equal(out.filter((t) => t.role === "assistant").length, 10);
  assert.equal(out[out.length - 1].text, "t29");
  assert.equal(out[0].role, "user");
});

test("trimHistory: 往復が少なければそのまま", () => {
  const turns = [{ role: "user" as const, text: "a" }, { role: "assistant" as const, text: "b" }];
  assert.deepEqual(trimHistory(turns, 10), turns);
});

test("detectAddressedAgent: 名前・名前系の別名で宛先が決まり、領域語は呼びかけにならない", () => {
  const p = PERSONA_DEFAULTS;
  assert.equal(detectAddressedAgent("ケイ、この問題ってどう考える？", p), "CODE");
  assert.equal(detectAddressedAgent("アオイに聞きたい。読解のコツは？", p), "READ");
  assert.equal(detectAddressedAgent("フミさん、文章を短くするには", p), "WRITE");
  assert.equal(detectAddressedAgent("リード、今日なにやる？", p), "LEADER");
  // 領域語（LOGIC / 論理 / READ …）は出題・作問の依頼と衝突するので呼びかけには使わない
  assert.equal(detectAddressedAgent("LOGIC の人、順番の問題むずかしい", p), null);
  assert.equal(detectAddressedAgent("けい、順番の問題むずかしい", p), "CODE");
  assert.equal(detectAddressedAgent("今日は疲れたけど何かやりたい", p), null);
});

test("detectAddressedAgent: ユーザーが名前を変えても拾う", () => {
  const p = { ...PERSONA_DEFAULTS, CODE: { ...PERSONA_DEFAULTS.CODE, name: "ロジ" } };
  assert.equal(detectAddressedAgent("ロジ、教えて", p), "CODE");
});
