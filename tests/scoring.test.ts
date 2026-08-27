// scoring.ts の単体テスト（決定論的集計）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseScore,
  difficultyWeight,
  recencyWeight,
  confidenceFor,
  computeDomainScore,
  recommendDifficulty,
  type ScorableEvent,
} from "../src/lib/scoring";

const NOW = new Date("2026-08-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function ev(over: Partial<ScorableEvent> = {}): ScorableEvent {
  return {
    domain: "CODE",
    difficulty: 3,
    success: true,
    hintCount: 0,
    skillTags: ["tracing"],
    createdAt: daysAgo(0),
    ...over,
  };
}

test("baseScore の表", () => {
  assert.equal(baseScore(true, 0), 1.0);
  assert.equal(baseScore(true, 1), 0.8);
  assert.equal(baseScore(true, 2), 0.6);
  assert.equal(baseScore(true, 3), 0.5);
  assert.equal(baseScore(true, 10), 0.5);
  assert.equal(baseScore(false, 0), 0.2);
  assert.equal(baseScore(false, 3), 0.2);
});

test("difficultyWeight は 1→0.7, 3→1.0, 5→1.3 で範囲外はクランプ", () => {
  assert.ok(Math.abs(difficultyWeight(1) - 0.7) < 1e-9);
  assert.ok(Math.abs(difficultyWeight(3) - 1.0) < 1e-9);
  assert.ok(Math.abs(difficultyWeight(5) - 1.3) < 1e-9);
  assert.equal(difficultyWeight(0), difficultyWeight(1));
  assert.equal(difficultyWeight(9), difficultyWeight(5));
  for (let d = 1; d <= 5; d++) {
    assert.ok(difficultyWeight(d) >= 0.7 && difficultyWeight(d) <= 1.3);
  }
});

test("recencyWeight は単調減少で、今日=1、半減期14日で0.5", () => {
  assert.equal(recencyWeight(daysAgo(0), NOW), 1);
  assert.ok(Math.abs(recencyWeight(daysAgo(14), NOW) - 0.5) < 1e-9);
  let prev = 2;
  for (const d of [0, 1, 3, 7, 14, 30, 90]) {
    const w = recencyWeight(daysAgo(d), NOW);
    assert.ok(w < prev, `day ${d}: ${w} < ${prev}`);
    assert.ok(w > 0 && w <= 1);
    prev = w;
  }
  // 未来の日付は 1 にクランプ
  assert.equal(recencyWeight(daysAgo(-5), NOW), 1);
});

test("confidenceFor の閾値は 3 / 8", () => {
  assert.equal(confidenceFor(0), "low");
  assert.equal(confidenceFor(2), "low");
  assert.equal(confidenceFor(3), "medium");
  assert.equal(confidenceFor(7), "medium");
  assert.equal(confidenceFor(8), "high");
});

test("computeDomainScore: イベント0件 → score 0・confidence low・subskills 空", () => {
  const r = computeDomainScore("CODE", [], NOW);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, "low");
  assert.equal(r.evidenceCount, 0);
  assert.deepEqual(r.subskills, {});
  assert.equal(r.successRate, 0);
});

test("computeDomainScore: 失敗1件だけでは 0.2 に張り付かず事前分布で緩和される", () => {
  const r = computeDomainScore("CODE", [ev({ success: false, hintCount: 3 })], NOW);
  assert.ok(r.score > 20, `score=${r.score}`);
  assert.ok(r.score < 50, `score=${r.score}`);
  assert.ok(r.subskills.tracing > 20 && r.subskills.tracing < 50);
  assert.equal(r.confidence, "low");
});

test("computeDomainScore: 難易度高・ヒントなし成功が続けば高スコア", () => {
  const events = Array.from({ length: 10 }, (_, i) =>
    ev({ difficulty: 5, hintCount: 0, createdAt: daysAgo(i) }),
  );
  const r = computeDomainScore("CODE", events, NOW);
  assert.ok(r.score >= 90, `score=${r.score}`);
  assert.equal(r.confidence, "high");
  assert.equal(r.successRate, 1);
  assert.equal(r.avgHints, 0);
  assert.equal(r.avgDifficulty, 5);
});

test("computeDomainScore: 他 domain のイベントは無視される", () => {
  const r = computeDomainScore("READ", [ev({ domain: "CODE" })], NOW);
  assert.equal(r.evidenceCount, 0);
  assert.equal(r.score, 0);
});

test("computeDomainScore: subskill はタグのあるものだけ、domain 外のタグは無視", () => {
  const r = computeDomainScore(
    "CODE",
    [ev({ skillTags: ["tracing", "comprehension"] }), ev({ skillTags: ["debugging"] })],
    NOW,
  );
  assert.deepEqual(Object.keys(r.subskills).sort(), ["debugging", "tracing"]);
  assert.ok(!("comprehension" in r.subskills));
  assert.ok(!("algorithms" in r.subskills));
});

test("computeDomainScore: 古い失敗より新しい成功のほうが重く効く", () => {
  const recentFailOldSuccess = computeDomainScore(
    "CODE",
    [ev({ success: true, createdAt: daysAgo(60) }), ev({ success: false, createdAt: daysAgo(0) })],
    NOW,
  );
  const recentSuccessOldFail = computeDomainScore(
    "CODE",
    [ev({ success: false, createdAt: daysAgo(60) }), ev({ success: true, createdAt: daysAgo(0) })],
    NOW,
  );
  assert.ok(recentSuccessOldFail.score > recentFailOldSuccess.score);
});

test("computeDomainScore: confidence は件数 3 / 8 で切り替わる", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ev({ createdAt: daysAgo(i) }));
  assert.equal(computeDomainScore("CODE", mk(2), NOW).confidence, "low");
  assert.equal(computeDomainScore("CODE", mk(3), NOW).confidence, "medium");
  assert.equal(computeDomainScore("CODE", mk(7), NOW).confidence, "medium");
  assert.equal(computeDomainScore("CODE", mk(8), NOW).confidence, "high");
});

test("recommendDifficulty: 履歴なしは 2", () => {
  assert.equal(recommendDifficulty("CODE", []), 2);
});

test("recommendDifficulty: 直近5件中3件がヒント≤1で成功なら +1（上限5）", () => {
  const events = [0, 1, 2].map((i) => ev({ difficulty: 3, hintCount: i === 0 ? 0 : 1, createdAt: daysAgo(i) }));
  assert.equal(recommendDifficulty("CODE", events), 4);
  const top = [0, 1, 2].map((i) => ev({ difficulty: 5, createdAt: daysAgo(i) }));
  assert.equal(recommendDifficulty("CODE", top), 5);
});

test("recommendDifficulty: 直近5件中2件失敗なら -1（下限1）", () => {
  const events = [
    ev({ difficulty: 3, success: false, createdAt: daysAgo(0) }),
    ev({ difficulty: 3, success: false, createdAt: daysAgo(1) }),
    ev({ difficulty: 3, success: true, createdAt: daysAgo(2) }),
  ];
  assert.equal(recommendDifficulty("CODE", events), 2);
  const bottom = [
    ev({ difficulty: 1, success: false, createdAt: daysAgo(0) }),
    ev({ difficulty: 1, success: false, createdAt: daysAgo(1) }),
  ];
  assert.equal(recommendDifficulty("CODE", bottom), 1);
});

test("recommendDifficulty: 条件に当たらなければ直近の難易度を維持", () => {
  const events = [
    ev({ difficulty: 4, success: true, hintCount: 2, createdAt: daysAgo(0) }),
    ev({ difficulty: 3, success: false, createdAt: daysAgo(1) }),
  ];
  assert.equal(recommendDifficulty("CODE", events), 4);
});
