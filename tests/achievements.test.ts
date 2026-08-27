// achievements.pure.ts の単体テスト（events からの決定論的な解除判定）
import assert from "node:assert/strict";
import { test } from "node:test";

import { ACHIEVEMENTS } from "../src/lib/achievement-defs";
import { longestRun, unlockedAchievements, type AchievementEvent } from "../src/lib/achievements.pure";

// JST 12:00 固定（時間帯・曜日の判定が実行時刻に依存しないように）
const NOW = new Date("2026-08-28T03:00:00Z"); // 2026-08-28 (金) 12:00 JST
const daysAgo = (n: number, hourJst = 12) => new Date(NOW.getTime() - n * 86_400_000 - (12 - hourJst) * 3_600_000);

function ev(over: Partial<AchievementEvent> = {}): AchievementEvent {
  return {
    domain: "CODE",
    taskId: "code-001",
    difficulty: 3,
    success: true,
    hintCount: 0,
    skillTags: ["tracing"],
    createdAt: NOW,
    ...over,
  };
}

test("定義は 40 個以上あり、必須フィールドが揃っている", () => {
  const keys = Object.keys(ACHIEVEMENTS);
  assert.ok(keys.length >= 40, `defs=${keys.length}`);
  for (const k of keys) {
    const a = ACHIEVEMENTS[k];
    assert.ok(a.title && a.description && a.emoji, k);
    assert.ok(["bronze", "silver", "gold"].includes(a.tier), k);
  }
});

test("解除判定が返す key はすべて定義済み", () => {
  const events = [ev(), ev({ domain: "READ", taskId: "read-001", skillTags: ["inference"] }), ev({ domain: "WRITE", taskId: "write-001", skillTags: ["structure"] })];
  for (const k of unlockedAchievements(events, NOW)) assert.ok(k in ACHIEVEMENTS, k);
});

test("0 件なら何も解除されない。1 件で first_step、正解なら系統の first_*", () => {
  assert.deepEqual(unlockedAchievements([], NOW), []);
  const got = unlockedAchievements([ev({ success: false })], NOW);
  assert.ok(got.includes("first_step"));
  assert.ok(!got.includes("first_logic"));
  const got2 = unlockedAchievements([ev()], NOW);
  assert.ok(got2.includes("first_logic"));
  assert.ok(got2.includes("no_hint"));
});

test("3 系統を同じ日に解くとミッション達成・trivium・perfect_mission", () => {
  const events = [
    ev({ domain: "READ", taskId: "read-001", skillTags: ["inference"] }),
    ev({ domain: "WRITE", taskId: "write-001", skillTags: ["structure"] }),
    ev({ domain: "CODE", taskId: "code-001" }),
  ];
  const got = unlockedAchievements(events, NOW);
  for (const k of ["trivium", "mission_first", "perfect_mission", "flawless_day"]) assert.ok(got.includes(k), k);
});

test("連続日数: 3 日連続で streak_3、途切れると数え直し", () => {
  const day = (n: number) => [
    ev({ domain: "READ", taskId: `read-${n}`, createdAt: daysAgo(n), skillTags: ["inference"] }),
    ev({ domain: "WRITE", taskId: `write-${n}`, createdAt: daysAgo(n), skillTags: ["structure"] }),
    ev({ domain: "CODE", taskId: `code-${n}`, createdAt: daysAgo(n) }),
  ];
  const got = unlockedAchievements([...day(0), ...day(1), ...day(2)], NOW);
  assert.ok(got.includes("streak_3"));
  assert.ok(!got.includes("streak_7"));
  assert.equal(longestRun(["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06"]), 3);
});

test("高難度・頂上・リベンジ・ノーヒント連続", () => {
  const events = [
    ev({ taskId: "code-010", difficulty: 9, success: false, createdAt: daysAgo(2) }),
    ev({ taskId: "code-010", difficulty: 9, success: true, hintCount: 1, createdAt: daysAgo(1) }),
    ev({ taskId: "code-014", difficulty: 10, success: true }),
    ...Array.from({ length: 5 }, (_, i) => ev({ taskId: `code-2${i}`, difficulty: 4, createdAt: new Date(NOW.getTime() + (i + 1) * 60_000) })),
  ];
  const got = unlockedAchievements(events, new Date(NOW.getTime() + 10 * 60_000));
  for (const k of ["hard_clear", "expert_clear", "summit", "revenge", "no_hint_5", "comeback"]) assert.ok(got.includes(k), k);
  assert.ok(!got.includes("no_hint_10"));
});

test("時間帯（JST）と曜日: 朝活・夜更かし・週末", () => {
  const morning = new Date("2026-08-27T22:30:00Z"); // 2026-08-28 07:30 JST（金）
  const night = new Date("2026-08-28T14:30:00Z"); // 2026-08-28 23:30 JST
  const weekend = new Date("2026-08-29T03:00:00Z"); // 2026-08-29 12:00 JST（土）
  const got = unlockedAchievements([ev({ createdAt: morning }), ev({ taskId: "code-002", createdAt: night }), ev({ taskId: "code-003", createdAt: weekend })], weekend);
  for (const k of ["early_bird", "night_owl", "weekend_learner"]) assert.ok(got.includes(k), k);
});

test("AI 作問・複合課題", () => {
  const events = [
    ev({ taskId: "gen-abc", generated: true }),
    ev({ taskId: "mix-001", domain: "READ", axes: { read: 4, code: 4 }, skillTags: ["inference"] }),
  ];
  const got = unlockedAchievements(events, NOW);
  assert.ok(got.includes("generated_clear"));
  assert.ok(got.includes("composite_clear"));
  assert.ok(!got.includes("composite_3"));
});

test("XP とランク: 累計で xp_100 / rank_apprentice が付く", () => {
  // 難易度 5 のノーヒント正解 = 50 XP。6 問で 300 XP（+同日 3 系統なら +50）
  const events = Array.from({ length: 6 }, (_, i) => ev({ taskId: `code-3${i}`, difficulty: 5, createdAt: new Date(NOW.getTime() + i * 60_000) }));
  const got = unlockedAchievements(events, new Date(NOW.getTime() + 10 * 60_000));
  assert.ok(got.includes("xp_100"));
  assert.ok(got.includes("rank_apprentice"));
  assert.ok(!got.includes("xp_1000"));
});
