// scoring.ts の単体テスト（決定論的集計）
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  axesOf,
  computeDomainScore,
  computeLevels,
  confidenceFor,
  difficultyWeight,
  recencyWeight,
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
    createdAt: NOW,
    ...over,
  };
}

test("イベント0件ならスコア0・レベル0・信頼度lowになる", () => {
  const result = computeDomainScore("CODE", [], NOW);

  assert.equal(result.score, 0);
  assert.equal(result.level, 0);
  assert.equal(result.progress, 0);
  assert.equal(result.evidenceCount, 0);
  assert.equal(result.confidence, "low");
});

test("難易度6をヒントなしで3回成功するとレベル6になる", () => {
  const events = [0, 1, 2].map((n) => ev({ difficulty: 6, createdAt: daysAgo(n) }));
  const result = computeDomainScore("CODE", events, NOW);

  assert.equal(result.level, 6);
  assert.ok(result.score >= 60, `score=${result.score}`);
});

test("難易度8の失敗は難易度3の到達判定に影響しない", () => {
  const events = [
    ev({ difficulty: 3, createdAt: daysAgo(2) }),
    ev({ difficulty: 3, createdAt: daysAgo(1) }),
    ev({ difficulty: 8, success: false }),
  ];

  assert.equal(computeDomainScore("CODE", events, NOW).level, 3);
});

test("複合課題の失敗はボトルネックのCODEだけに否定証拠を与える", () => {
  const events = [
    ev({ domain: "READ", difficulty: 3, createdAt: daysAgo(6) }),
    ev({ domain: "READ", difficulty: 3, createdAt: daysAgo(5) }),
    ev({ domain: "WRITE", difficulty: 2, createdAt: daysAgo(4) }),
    ev({ domain: "WRITE", difficulty: 2, createdAt: daysAgo(3) }),
    ev({ difficulty: 8, createdAt: daysAgo(2) }),
    ev({ difficulty: 8, createdAt: daysAgo(1) }),
    ev({ axes: { read: 3, write: 2, code: 8 }, success: false }),
  ];
  const withoutFailure = computeLevels(events.slice(0, -1), NOW);
  const withFailure = computeLevels(events, NOW);

  assert.equal(withoutFailure.read.level, 3);
  assert.equal(withFailure.read.level, 3);
  assert.equal(withoutFailure.write.level, 2);
  assert.equal(withFailure.write.level, 2);
  assert.equal(withoutFailure.code.level, 8);
  assert.equal(withFailure.code.level, 6);
});

test("複合課題の成功は関与する3系統すべてに加点する", () => {
  const events = [
    ev({ axes: { read: 3, write: 2, code: 8 }, createdAt: daysAgo(1) }),
    ev({ axes: { read: 3, write: 2, code: 8 } }),
  ];
  const levels = computeLevels(events, NOW);

  assert.equal(levels.read.level, 3);
  assert.equal(levels.write.level, 2);
  assert.equal(levels.code.level, 8);
  assert.equal(computeDomainScore("READ", events, NOW).evidenceCount, 2);
  assert.equal(computeDomainScore("WRITE", events, NOW).evidenceCount, 2);
  assert.equal(computeDomainScore("CODE", events, NOW).evidenceCount, 2);
});

test("axesのない旧データは主系統だけに割り当てる", () => {
  const legacy = ev({ domain: "WRITE", difficulty: 4, axes: undefined });
  const events = [legacy, ev({ ...legacy, createdAt: daysAgo(1) })];

  assert.deepEqual(axesOf(legacy), { read: 0, write: 4, code: 0 });
  assert.equal(computeDomainScore("WRITE", events, NOW).level, 4);
  assert.equal(computeDomainScore("READ", events, NOW).evidenceCount, 0);
  assert.equal(computeDomainScore("CODE", events, NOW).evidenceCount, 0);
});

test("recommendDifficultyは履歴なしなら3を返す", () => {
  assert.equal(recommendDifficulty("CODE", [], NOW), 3);
});

test("recommendDifficultyは基本的に到達レベルの1つ上を返し上限10に収める", () => {
  const level4 = [ev({ difficulty: 4 }), ev({ difficulty: 4, createdAt: daysAgo(1) })];
  const level10 = [ev({ difficulty: 10 }), ev({ difficulty: 10, createdAt: daysAgo(1) })];

  assert.equal(recommendDifficulty("CODE", level4, NOW), 5);
  assert.equal(recommendDifficulty("CODE", level10, NOW), 10);
});

test("recommendDifficultyは直近3件中2件失敗なら到達レベルに据え置く", () => {
  const events = [
    ev({ difficulty: 4, createdAt: daysAgo(4) }),
    ev({ difficulty: 4, createdAt: daysAgo(3) }),
    ev({ difficulty: 4, createdAt: daysAgo(2) }),
    ev({ difficulty: 8, success: false, createdAt: daysAgo(1) }),
    ev({ difficulty: 8, success: false }),
  ];
  const noMastery = [ev({ difficulty: 1, success: false })];

  assert.equal(computeLevels(events, NOW).code.level, 4);
  assert.equal(recommendDifficulty("CODE", events, NOW), 4);
  assert.equal(recommendDifficulty("CODE", noMastery, NOW), 1);
});

test("difficultyWeightは難易度1から10まで0.7から1.3へ線形に増える", () => {
  assert.equal(difficultyWeight(1), 0.7);
  assert.ok(Math.abs(difficultyWeight(10) - 1.3) < 1e-12);
  assert.ok(Math.abs(difficultyWeight(5.5) - 1) < 1e-12);
  assert.equal(difficultyWeight(0), 0.7);
  assert.ok(Math.abs(difficultyWeight(11) - 1.3) < 1e-12);
});

test("recencyWeightは当日1・14日前0.5で未来日は1に収める", () => {
  assert.equal(recencyWeight(NOW, NOW), 1);
  assert.ok(Math.abs(recencyWeight(daysAgo(14), NOW) - 0.5) < 1e-12);
  assert.equal(recencyWeight(daysAgo(-1), NOW), 1);
  assert.ok(recencyWeight(daysAgo(7), NOW) > recencyWeight(daysAgo(8), NOW));
});

test("confidenceForは3件未満low・8件未満medium・それ以上highになる", () => {
  assert.equal(confidenceFor(0), "low");
  assert.equal(confidenceFor(2), "low");
  assert.equal(confidenceFor(3), "medium");
  assert.equal(confidenceFor(7), "medium");
  assert.equal(confidenceFor(8), "high");
});

test("computeLevelsのprogressはすべて0以上1以下になる", () => {
  const events = [
    ev({ domain: "READ", axes: { read: 3, write: 2 }, hintCount: 1, createdAt: daysAgo(2) }),
    ev({ axes: { read: 3, write: 2, code: 8 }, createdAt: daysAgo(1) }),
    ev({ axes: { read: 3, write: 2, code: 8 }, success: false }),
  ];

  for (const [axis, result] of Object.entries(computeLevels(events, NOW))) {
    assert.ok(result.progress >= 0, `${axis}: progress=${result.progress}`);
    assert.ok(result.progress <= 1, `${axis}: progress=${result.progress}`);
  }
});

test("score は小数 1 桁で、同じレベル内でも証拠が増えると 0.1 刻みで上がる（10 刻みにならない）", () => {
  // 1 問だけでは証拠量 1.0 < minEvidence 1.5 なのでレベルは 0。進捗は 1.0/1.5 ≈ 0.667 → 6.7（以前は 0 か 9.9 の二択だった）
  const one = computeDomainScore("CODE", [ev({ difficulty: 4 })], NOW);
  assert.equal(one.level, 0, `level=${one.level}`);
  assert.equal(one.score, 6.7);
  assert.equal(Math.round(one.score * 10) / 10, one.score);

  // ヒント 1 回（重み 0.8）の正解なら証拠量が少ない分だけ低い（0.8/1.5 ≈ 0.533 → 5.3）
  const hinted = computeDomainScore("CODE", [ev({ difficulty: 4, hintCount: 1 })], NOW);
  assert.ok(hinted.score < one.score && hinted.score > 3, `hinted=${hinted.score}`);

  // 2 問目で証拠量が閾値を超えるとレベル 4 に上がり、以後は次レベル帯の証拠で 0.1 刻みに増える
  const two = computeDomainScore("CODE", [ev({ difficulty: 4 }), ev({ difficulty: 4, createdAt: new Date(NOW.getTime() + 60_000) })], new Date(NOW.getTime() + 120_000));
  assert.equal(two.level, 4, `level=${two.level}`);
  assert.ok(two.score >= 40 && two.score < 50, `two=${two.score}`);

  // 成功が増えても score は減らない（単調）
  let prev = 0;
  const events = [];
  for (let i = 0; i < 6; i++) {
    events.push(ev({ difficulty: 4 + Math.floor(i / 2), createdAt: new Date(NOW.getTime() + i * 60_000) }));
    const s = computeDomainScore("CODE", events, new Date(NOW.getTime() + 10 * 60_000)).score;
    assert.ok(s >= prev, `step ${i}: ${prev} -> ${s}`);
    prev = s;
  }
});
