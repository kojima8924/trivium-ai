// xp.ts の単体テスト（行動の積み上げ）
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeXp, dayKey, rankFor, streakOf, xpForEvent, type XpEvent } from "../src/lib/xp";

const NOW = new Date("2026-08-28T03:00:00Z");

function ev(over: Partial<XpEvent> = {}): XpEvent {
  return {
    domain: "CODE",
    difficulty: 4,
    success: true,
    hintCount: 0,
    skillTags: [],
    createdAt: NOW,
    ...over,
  };
}

test("xpForEventは難易度合計に基礎点を掛ける", () => {
  assert.deepEqual(xpForEvent(ev({ difficulty: 4 })), {
    total: 40,
    byDomain: { READ: 0, WRITE: 0, CODE: 40 },
  });
});

test("xpForEventは成功時にヒント倍率を適用する", () => {
  assert.equal(xpForEvent(ev({ hintCount: 1 })).total, 32);
  assert.equal(xpForEvent(ev({ hintCount: 2 })).total, 24);
  assert.equal(xpForEvent(ev({ hintCount: 99 })).total, 20);
});

test("xpForEventは失敗倍率を適用する", () => {
  assert.equal(xpForEvent(ev({ success: false })).total, 10);
});

test("xpForEventは生成課題倍率を適用する", () => {
  assert.equal(xpForEvent(ev({ generated: true })).total, 48);
});

test("xpForEventは難易度比で系統別に按分し、端数は関与する系統のうち最も難しい系統へ寄せる", () => {
  const result = xpForEvent(
    ev({ axes: { read: 2, write: 1, code: 3 }, success: false }),
  );

  assert.equal(result.total, 15);
  // floor で 5 / 2 / 7 → 端数 1 は最も難しい CODE へ
  assert.deepEqual(result.byDomain, { READ: 5, WRITE: 2, CODE: 8 });
  assert.equal(Object.values(result.byDomain).reduce((sum, xp) => sum + xp, 0), result.total);
});

test("xpForEventは無関係な系統に負のXPを入れない", () => {
  const result = xpForEvent(ev({ axes: { read: 1, write: 1, code: 0 }, success: false }));
  assert.equal(result.total, 5);
  assert.deepEqual(result.byDomain, { READ: 3, WRITE: 2, CODE: 0 });
  assert.ok(Object.values(result.byDomain).every((xp) => xp >= 0));
});

test("missionDaysはJSTで3系統がそろった日だけを含む", () => {
  const events = [
    ev({ domain: "READ", difficulty: 1, createdAt: new Date("2026-08-26T15:00:00Z") }),
    ev({ domain: "WRITE", difficulty: 1, createdAt: new Date("2026-08-27T00:00:00Z") }),
    ev({ domain: "CODE", difficulty: 1, createdAt: new Date("2026-08-27T14:59:59Z") }),
    ev({ domain: "READ", difficulty: 1, createdAt: new Date("2026-08-27T15:00:00Z") }),
  ];
  const result = computeXp(events, NOW);

  assert.equal(dayKey(events[2].createdAt), "2026-08-27");
  assert.equal(dayKey(events[3].createdAt), "2026-08-28");
  assert.deepEqual(result.missionDays, ["2026-08-27"]);
  assert.equal(result.missionToday, false);
});

test("streakOfは今日未達なら昨日から数え途切れた時点で止まる", () => {
  assert.equal(streakOf(["2026-08-26", "2026-08-27"], NOW), 2);
  assert.equal(streakOf(["2026-08-24", "2026-08-26", "2026-08-27"], NOW), 2);
  assert.equal(streakOf(["2026-08-26"], NOW), 0);
});

test("rankForはしきい値境界でランク・次ランク・進捗を返す", () => {
  const boundaries = [
    { min: 0, short: "NOVICE", next: 250 },
    { min: 250, short: "APPRENTICE", next: 700 },
    { min: 700, short: "GRAMMARIAN", next: 1500 },
    { min: 1500, short: "LOGICIAN", next: 3000 },
    { min: 3000, short: "RHETOR", next: 5000 },
    { min: 5000, short: "MASTER", next: null },
  ] as const;

  for (const [index, boundary] of boundaries.entries()) {
    const atBoundary = rankFor(boundary.min);
    assert.equal(atBoundary.short, boundary.short);
    assert.equal(atBoundary.min, boundary.min);
    assert.equal(atBoundary.next, boundary.next);
    assert.equal(atBoundary.progress, boundary.next === null ? 1 : 0);
    if (index > 0) assert.equal(rankFor(boundary.min - 1).short, boundaries[index - 1].short);
  }

  assert.equal(rankFor(249).progress, 249 / 250);
});

test("computeXpは課題・ミッション・連続日数のXPを合計する", () => {
  const events = ["2026-08-27T00:00:00Z", "2026-08-28T00:00:00Z"].flatMap((createdAt) => [
    ev({ domain: "READ", difficulty: 1, createdAt: new Date(createdAt) }),
    ev({ domain: "WRITE", difficulty: 1, createdAt: new Date(createdAt) }),
    ev({ domain: "CODE", difficulty: 1, createdAt: new Date(createdAt) }),
  ]);
  const result = computeXp(events, NOW);

  assert.deepEqual(result.missionDays, ["2026-08-27", "2026-08-28"]);
  assert.equal(result.missionToday, true);
  assert.deepEqual(result.today, { READ: true, WRITE: true, CODE: true });
  assert.equal(result.streak, 2);
  assert.deepEqual(result.byDomain, { READ: 20, WRITE: 20, CODE: 20 });
  assert.deepEqual(result.breakdown, { tasks: 60, missions: 100, streak: 20 });
  assert.equal(result.total, 180);
  assert.equal(result.total, result.breakdown.tasks + result.breakdown.missions + result.breakdown.streak);
});
