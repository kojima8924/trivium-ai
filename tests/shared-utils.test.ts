// 共有ユーティリティ（hash.ts / date.ts / scoring.core.ts / profile.pure.ts）のテスト。
// リファクタで各所の重複実装を 1 か所へ寄せたので、「寄せる前と同じ値か」をここで固定する。
import assert from "node:assert/strict";
import { test } from "node:test";

import { fnv1a, unitOf } from "../src/lib/hash";
import { jstDayKey } from "../src/lib/date";
import { dayKey } from "../src/lib/xp";
import { stableHash } from "../src/lib/learn/generate.pure";
import { AXIS_OF, clampDifficulty, MAX_LEVEL } from "../src/lib/scoring";
import { liveDomainStats } from "../src/lib/profile.pure";
import { allDomainScores, type ScorableEvent } from "../src/lib/scoring";

/** 統合前に service.ts / scoring.ts / generate.pure.ts が各自持っていた実装（比較用の参照実装） */
function legacyHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

test("fnv1a: 統合前の各実装と同じ値を返し、決定論的", () => {
  for (const s of ["", "u1:0", "u1:1", "user-42:READ:3", "あ", "🍣x", "a".repeat(200)]) {
    assert.equal(fnv1a(s), legacyHash(s), s);
  }
  assert.equal(fnv1a("u1:0"), fnv1a("u1:0"));
  assert.notEqual(fnv1a("u1:0"), fnv1a("u1:1"));
  // generate.pure.ts の stableHash は fnv1a の別名（旧実装の末尾 `>>> 0` は 32bit 値には無影響）
  assert.equal(stableHash("u1:0"), fnv1a("u1:0"));
});

test("unitOf: 0 以上 1 未満に写す（旧 seededUnit と同じ割り算）", () => {
  for (const s of ["", "seed", "u1:READ:7"]) {
    const u = unitOf(s);
    assert.ok(u >= 0 && u < 1, `${s} -> ${u}`);
    assert.equal(u, legacyHash(s) / 0x100000000);
  }
});

test("clampDifficulty: 1..MAX_LEVEL に収める（旧 Math.min(10, Math.max(1, n)) と同じ）", () => {
  for (const n of [-5, 0, 0.4, 1, 2.5, 9, 10, 11, 99]) {
    assert.equal(clampDifficulty(n), Math.min(10, Math.max(1, n)), String(n));
  }
  assert.equal(MAX_LEVEL, 10);
  // レベルの clamp（下限 0）と違い、難易度の下限は 1
  assert.equal(clampDifficulty(0), 1);
});

test("jstDayKey: xp.dayKey と同じ実体で、JST の日付境界で切り替わる", () => {
  assert.equal(dayKey, jstDayKey);
  // 2026-08-27T14:59:59Z = JST 2026-08-27 23:59:59 / 15:00:00Z = JST 翌日 00:00
  assert.equal(jstDayKey(new Date("2026-08-27T14:59:59Z")), "2026-08-27");
  assert.equal(jstDayKey(new Date("2026-08-27T15:00:00Z")), "2026-08-28");
});

test("AXIS_OF: 系統 → 軸の対応（achievements と scoring で同じ表を使う）", () => {
  assert.deepEqual(AXIS_OF, { READ: "read", WRITE: "write", CODE: "code" });
});

test("liveDomainStats: allDomainScores と同じ結果（profile.pure から公開しているだけ）", () => {
  const now = new Date("2026-08-27T12:00:00Z");
  const events: ScorableEvent[] = [
    { domain: "READ", difficulty: 3, success: true, hintCount: 0, createdAt: new Date("2026-08-26T00:00:00Z"), skillTags: ["main_idea"] },
    { domain: "CODE", difficulty: 5, success: false, hintCount: 2, createdAt: new Date("2026-08-25T00:00:00Z"), skillTags: [] },
    { domain: "WRITE", difficulty: 2, success: true, hintCount: 1, createdAt: new Date("2026-08-24T00:00:00Z"), skillTags: [], axes: { read: 2, write: 2, code: 0 } },
  ];
  assert.deepEqual(liveDomainStats(events, now), allDomainScores(events, now));
});
