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
  adaptiveTarget,
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
  // 2 勝 1 敗（正答率 0.65）: 昇格しきい値 0.7 は割るが降格しきい値 0.5 は割らないので Lv8 を維持（ヒステリシス）
  assert.equal(withFailure.code.level, 8);
  // CODE の進捗（次のレベル帯）は失敗の分だけ下がる
  assert.ok(withFailure.code.progress <= withoutFailure.code.progress);
});

test("降格: 1 回の失敗で 1 段以上落ちない。正答率が 0.5 を割ると落ちる", () => {
  // 成功 2 件は直前（新しさ重み ≈ 1）に置く。時系列は 成功 → 失敗 の順
  const base = [ev({ difficulty: 3, createdAt: new Date(NOW.getTime() - 2) }), ev({ difficulty: 3, createdAt: new Date(NOW.getTime() - 1) })];
  assert.equal(computeLevels(base, NOW).code.level, 3);
  // 推薦どおり難易度 4 に挑んで失敗 → 難易度 3 の判定は無傷（否定証拠は上方向にだけ効く）
  assert.equal(computeLevels([...base, ev({ difficulty: 4, success: false })], NOW).code.level, 3);
  // 同じ難易度 3 を 1 回落とす（2 勝 1 敗）→ 維持
  assert.equal(computeLevels([...base, ev({ difficulty: 3, success: false })], NOW).code.level, 3);
  // 2 回落とす（2 勝 2 敗 = 0.5）→ 維持。3 回落とす（0.4）→ 降格
  const twoFails = [...base, ev({ difficulty: 3, success: false }), ev({ difficulty: 3, success: false, createdAt: new Date(NOW.getTime() + 1) })];
  assert.equal(computeLevels(twoFails, NOW).code.level, 3);
  const threeFails = [...twoFails, ev({ difficulty: 3, success: false, createdAt: new Date(NOW.getTime() + 2) })];
  assert.ok(computeLevels(threeFails, NOW).code.level < 3);
});

test("複合課題の失敗は同点でも 1 系統（主系統）にしか帰属しない", () => {
  const events = [
    ev({ domain: "READ", difficulty: 3, createdAt: daysAgo(4) }),
    ev({ domain: "READ", difficulty: 3, createdAt: daysAgo(3) }),
    ev({ difficulty: 3, createdAt: daysAgo(2) }),
    ev({ difficulty: 3, createdAt: daysAgo(1) }),
  ];
  // READ Lv3 / CODE Lv3 の状態で複合 {read:3, code:3}（主系統 CODE）を 3 回落とす → CODE だけが落ち、READ は無傷
  const fails = [0, 1, 2].map((i) => ev({ domain: "CODE", difficulty: 3, axes: { read: 3, code: 3 }, success: false, createdAt: new Date(NOW.getTime() + i) }));
  const levels = computeLevels([...events, ...fails], NOW);
  assert.equal(levels.read.level, 3);
  assert.ok(levels.code.level < 3, `code=${levels.code.level}`);
});

test("時間が経っても到達レベルは消えない（件数で判定し、進捗だけが減衰する）", () => {
  const events = [ev({ difficulty: 3, createdAt: daysAgo(30) }), ev({ difficulty: 3, createdAt: daysAgo(29) })];
  const fresh = computeDomainScore("CODE", events, daysAgo(28));
  const later = computeDomainScore("CODE", events, NOW);
  assert.equal(fresh.level, 3);
  assert.equal(later.level, 3);
  assert.ok(later.score >= 30 && later.score <= fresh.score, `later=${later.score} fresh=${fresh.score}`);
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

test("recommendDifficultyは履歴なしなら低め（2）から始める", () => {
  assert.equal(recommendDifficulty("CODE", [], NOW), 2);
});

test("adaptiveTarget: 決定論的で、証拠が増えるほど推薦値の周辺に収束し、1〜10 に収まる", () => {
  // 同じ seed なら同じ値
  assert.equal(adaptiveTarget(4, 0, "u:CODE:0"), adaptiveTarget(4, 0, "u:CODE:0"));
  const spread = (n: number) => {
    const vals = new Set<number>();
    for (let i = 0; i < 200; i++) vals.add(adaptiveTarget(5, n, `user${i}:READ:${n}`));
    return vals;
  };
  const early = spread(0);
  const late = spread(20);
  assert.ok(early.has(6) || early.has(7), "序盤は上方向にも探索する");
  assert.ok([...late].every((v) => v >= 4 && v <= 6), "証拠が多いと ±1 に収束する");
  for (let i = 0; i < 100; i++) {
    const v = adaptiveTarget(10, 0, `x${i}`);
    assert.ok(v >= 1 && v <= 10);
    assert.ok(adaptiveTarget(1, 0, `y${i}`) >= 1);
  }
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

test("recommendDifficulty: 初回の正解で難易度が下がらない（2 → 3）。ヒントありなら据え置き、失敗なら 1 つ下げる", () => {
  const start = recommendDifficulty("CODE", [], NOW);
  assert.equal(start, 2);
  // 難易度 3 をヒントなしで正解 → 証拠は 1 件でレベルは付かないが、推薦は 4（逆行しない）
  assert.equal(recommendDifficulty("CODE", [ev({ difficulty: 3 })], NOW), 4);
  // ヒント 2 回で正解 → 3 で据え置き
  assert.equal(recommendDifficulty("CODE", [ev({ difficulty: 3, hintCount: 2 })], NOW), 3);
  // 失敗 → 2（1 まで落ちない）
  assert.equal(recommendDifficulty("CODE", [ev({ difficulty: 3, success: false })], NOW), 2);
  // 正解 → 次（4）で失敗 → 直近の成功難易度 3 で据え置き
  const upThenFail = [ev({ difficulty: 3, createdAt: daysAgo(1) }), ev({ difficulty: 4, success: false })];
  assert.equal(recommendDifficulty("CODE", upThenFail, NOW), 3);
  // 連続正解で単調に上がる（2 → 3 → 4 → …）。途中で下がらない
  let prev = 2;
  const events: ScorableEvent[] = [];
  for (let i = 0; i < 6; i++) {
    events.push(ev({ difficulty: prev, createdAt: new Date(NOW.getTime() + i * 60_000) }));
    const next = recommendDifficulty("CODE", events, new Date(NOW.getTime() + 10 * 60_000));
    assert.ok(next >= prev, `step ${i}: ${prev} -> ${next}`);
    prev = next;
  }
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
