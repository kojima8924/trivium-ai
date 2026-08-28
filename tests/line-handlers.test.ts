// LINE テキストの振り分け（routeMessage）と state の純粋関数のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { intentFromGuess, routeMessage } from "../src/lib/line/handlers.pure";
import { classifyIntent } from "../src/lib/line/leader";

const base = { linked: true, addressed: null, askedAgent: null, isShort: true } as const;

test("routeMessage: 呼びかけは link/unlink/help より優先して会話へ", () => {
  const r = routeMessage({ ...base, intent: classifyIntent("ロゴス、ブロックの解除ってどうやるの？"), addressed: "CODE", isShort: false });
  assert.deepEqual(r, { route: "chat", agent: "CODE", offerQuiz: false, consumeAsk: false });
  // 呼びかけ＋出題依頼は会話に渡しつつ出題ボタンを添える
  const r2 = routeMessage({ ...base, intent: classifyIntent("ケイ、論理パズル出して"), addressed: "CODE", isShort: false });
  assert.equal(r2.route, "chat");
  assert.equal((r2 as { offerQuiz: boolean }).offerQuiz, true);
});

test("routeMessage: 連携解除は連携済みなら確認、未連携なら案内（rule）", () => {
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "unlink" } }), { route: "unlink_confirm" });
  assert.deepEqual(routeMessage({ ...base, linked: false, intent: { kind: "unlink" } }), { route: "rule" });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "link" } }), { route: "rule" });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "help" } }), { route: "rule" });
});

test("routeMessage: 「〜と話す」の続きは会話へ。ただし短いコマンド（出題・作問・パス）はコマンド優先", () => {
  const chat = routeMessage({ ...base, intent: { kind: "unknown" }, askedAgent: "READ", isShort: false });
  assert.deepEqual(chat, { route: "chat", agent: "READ", offerQuiz: false, consumeAsk: true });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "quiz", domain: null }, askedAgent: "READ" }), { route: "quiz" });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "pass" }, askedAgent: "READ" }), { route: "pass" });
  // 長い作問依頼は宛先の人格との会話（ボタン付き）
  const long = routeMessage({ ...base, intent: { kind: "generate", request: "x" }, askedAgent: "CODE", isShort: false });
  assert.equal(long.route, "chat");
});

test("routeMessage: 既知の意図は未連携か短文ならルール、長い自由文は会話。未連携の unknown はルール", () => {
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "today" } }), { route: "rule" });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "tired" }, isShort: false }), { route: "chat", agent: "LEADER", offerQuiz: false, consumeAsk: false });
  assert.deepEqual(routeMessage({ ...base, linked: false, intent: { kind: "tired" }, isShort: false }), { route: "rule" });
  assert.deepEqual(routeMessage({ ...base, linked: false, intent: { kind: "unknown" } }), { route: "rule" });
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "unknown" } }), { route: "chat", agent: "LEADER", offerQuiz: false, consumeAsk: false });
});

test("出題中の課題があれば、ヒントはその課題へ、自由文はその担当との会話へ（答えは言わない文脈つき）", () => {
  const base = { linked: true, addressed: null, askedAgent: null, isShort: true };
  assert.deepEqual(routeMessage({ ...base, intent: { kind: "hint" }, pendingDomain: "CODE" }), { route: "hint" });
  const chat = routeMessage({ ...base, isShort: false, intent: { kind: "unknown" }, pendingDomain: "CODE" });
  assert.equal(chat.route, "chat");
  if (chat.route === "chat") {
    assert.equal(chat.agent, "CODE");
    assert.equal(chat.taskHelp, true);
  }
  // 出題中でなければ案内役との会話
  const noPending = routeMessage({ ...base, intent: { kind: "hint" }, pendingDomain: null });
  assert.equal(noPending.route, "chat");
  if (noPending.route === "chat") assert.equal(noPending.agent, "LEADER");
});

test("AI 判定の写像: 確信が低い／chat は null、それ以外は Intent に", () => {
  assert.equal(intentFromGuess(null, "x"), null);
  assert.equal(intentFromGuess({ kind: "chat", domain: null, difficulty: null, confidence: 0.9 }, "x"), null);
  assert.equal(intentFromGuess({ kind: "profile", domain: null, difficulty: null, confidence: 0.3 }, "x"), null);
  assert.deepEqual(intentFromGuess({ kind: "profile", domain: null, difficulty: null, confidence: 0.9 }, "僕の能力ってどのくらい？"), { kind: "profile" });
  assert.deepEqual(intentFromGuess({ kind: "quiz", domain: "CODE", difficulty: 7, confidence: 0.8 }, "x"), { kind: "quiz", domain: "CODE", difficulty: 7 });
  const m = intentFromGuess({ kind: "materials", domain: "READ", difficulty: null, confidence: 0.8 }, "読解を伸ばす本ない？");
  assert.equal(m?.kind, "materials");
});
