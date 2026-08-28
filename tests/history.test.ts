// history.pure.ts の単体テスト（Dashboard の時系列表示の整形）
import assert from "node:assert/strict";
import { test } from "node:test";

import { foldDailyTrend, jstDayKey, markersOnTrend, shortLabel, toAchievementTimeline } from "../src/lib/history.pure";

const d = (iso: string) => new Date(iso);

test("jstDayKey / shortLabel: JST で日付が決まる（UTC 15:00 は翌日）", () => {
  assert.equal(jstDayKey(d("2026-08-27T15:00:00Z")), "2026-08-28");
  assert.equal(jstDayKey(d("2026-08-27T14:59:00Z")), "2026-08-27");
  assert.equal(shortLabel("2026-08-28"), "08/28");
});

test("foldDailyTrend: 同じ日は最後の値を採る・日付順に並ぶ・小数1桁", () => {
  const trend = foldDailyTrend([
    { read: 10, write: 5, code: 20, createdAt: d("2026-08-26T01:00:00Z") },
    // 同じ JST 日の後の時刻 → こちらが採用される
    { read: 12.34, write: 6, code: 22, createdAt: d("2026-08-26T09:00:00Z") },
    // 入力が時刻順でなくても並べ替える
    { read: 30, write: 8, code: 25, createdAt: d("2026-08-25T02:00:00Z") },
  ]);
  assert.deepEqual(
    trend.map((p) => p.day),
    ["2026-08-25", "2026-08-26"],
  );
  assert.equal(trend[1].read, 12.3);
  assert.equal(trend[1].label, "08/26");
  assert.equal(trend[0].read, 30);
});

test("foldDailyTrend: 欠損日は補間しない（点を作らない）", () => {
  const trend = foldDailyTrend([
    { read: 1, write: 1, code: 1, createdAt: d("2026-08-20T03:00:00Z") },
    { read: 2, write: 2, code: 2, createdAt: d("2026-08-24T03:00:00Z") },
  ]);
  assert.equal(trend.length, 2);
});

test("foldDailyTrend: 空なら空配列", () => {
  assert.deepEqual(foldDailyTrend([]), []);
});

test("toAchievementTimeline: 新しい順・limit・定義が無いキーも落とさない", () => {
  const items = toAchievementTimeline(
    [
      { key: "first_step", unlockedAt: d("2026-08-20T03:00:00Z") },
      { key: "no_hint", unlockedAt: d("2026-08-26T03:00:00Z") },
      { key: "__unknown__", unlockedAt: d("2026-08-27T03:00:00Z") },
    ],
    2,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].key, "__unknown__");
  assert.equal(items[0].emoji, "🏅");
  assert.equal(items[0].title, "__unknown__");
  assert.equal(items[1].key, "no_hint");
  assert.equal(items[1].title, "ノーヒント");
  assert.equal(items[1].day, "2026-08-26");
});

test("markersOnTrend: トレンドにある日だけ・同じ日はまとめる", () => {
  const trend = foldDailyTrend([
    { read: 1, write: 1, code: 1, createdAt: d("2026-08-26T03:00:00Z") },
    { read: 2, write: 2, code: 2, createdAt: d("2026-08-27T03:00:00Z") },
  ]);
  const items = toAchievementTimeline([
    { key: "first_step", unlockedAt: d("2026-08-26T04:00:00Z") },
    { key: "no_hint", unlockedAt: d("2026-08-26T05:00:00Z") },
    // トレンドに無い日 → マーカーにしない
    { key: "first_read", unlockedAt: d("2026-08-10T05:00:00Z") },
  ]);
  const markers = markersOnTrend(trend, items);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].day, "2026-08-26");
  assert.equal(markers[0].count, 2);
  assert.equal(markers[0].label, "08/26");
});
