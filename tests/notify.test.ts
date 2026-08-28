// 通知設定とリマインダー判定（純粋関数）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFY_PREFS,
  NOTIFY_PREFS_KEY,
  REMINDER_TIMES,
  jstDayAndSlot,
  notifyPrefsFromPreferences,
  parseNotifyPrefs,
  reminderBody,
  reminderDecision,
  remainingLabel,
} from "../src/lib/notify.pure";

test("時刻の選択肢は 30 分刻みで 48 個・重複なし", () => {
  assert.equal(REMINDER_TIMES.length, 48);
  assert.equal(new Set(REMINDER_TIMES).size, 48);
  assert.equal(REMINDER_TIMES[0], "00:00");
  assert.equal(REMINDER_TIMES[1], "00:30");
  assert.equal(REMINDER_TIMES.at(-1), "23:30");
  assert.ok(REMINDER_TIMES.includes(DEFAULT_NOTIFY_PREFS.reminderTime));
});

test("parseNotifyPrefs: 不正な値は既定に落ち、正しい値は残る", () => {
  assert.deepEqual(parseNotifyPrefs(null), DEFAULT_NOTIFY_PREFS);
  assert.deepEqual(parseNotifyPrefs({ reminderTime: "20:15" }).reminderTime, "20:00"); // 30 分刻み以外
  assert.deepEqual(parseNotifyPrefs({ reminderTime: "24:00" }).reminderTime, "20:00"); // 範囲外
  assert.equal(parseNotifyPrefs({ reminderTime: "07:30" }).reminderTime, "07:30");
  assert.equal(parseNotifyPrefs({ reminderEnabled: false }).reminderEnabled, false);
  assert.equal(parseNotifyPrefs({ reminderEnabled: "no" }).reminderEnabled, DEFAULT_NOTIFY_PREFS.reminderEnabled);
  assert.equal(parseNotifyPrefs({ lastReminderDay: "2026-08-28" }).lastReminderDay, "2026-08-28");
  assert.equal(parseNotifyPrefs({ lastReminderDay: "8/28" }).lastReminderDay, "");
});

test("notifyPrefsFromPreferences: preferences の notify キーだけ読む", () => {
  const prefs = notifyPrefsFromPreferences({ excludeComposite: true, [NOTIFY_PREFS_KEY]: { reminderTime: "07:00", digestEnabled: false } });
  assert.equal(prefs.reminderTime, "07:00");
  assert.equal(prefs.digestEnabled, false);
  assert.deepEqual(notifyPrefsFromPreferences({ excludeComposite: true }), DEFAULT_NOTIFY_PREFS);
});

test("jstDayAndSlot: JST の日付と 30 分枠（切り下げ）", () => {
  // 2026-08-28T11:05:00Z = JST 20:05 → 20:00 枠
  assert.deepEqual(jstDayAndSlot(new Date("2026-08-28T11:05:00Z")), { day: "2026-08-28", slot: "20:00" });
  // JST 20:35 → 20:30 枠
  assert.deepEqual(jstDayAndSlot(new Date("2026-08-28T11:35:00Z")), { day: "2026-08-28", slot: "20:30" });
  // UTC 2026-08-28T16:00 = JST 翌日 01:00（日付が変わる）
  assert.deepEqual(jstDayAndSlot(new Date("2026-08-28T16:00:00Z")), { day: "2026-08-29", slot: "01:00" });
});

test("reminderDecision: 送るのは 連携済み・ON・時刻一致・未送信・未達成 のときだけ", () => {
  const base = { reminderEnabled: true, reminderTime: "20:00", digestEnabled: true, lastReminderDay: "" };
  const today = "2026-08-28";

  // 送る（READ だけ済み → WRITE と LOGIC が残る）
  const ok = reminderDecision({ prefs: base, covered: ["READ"], linked: true }, "20:00", today);
  assert.equal(ok.send, true);
  if (ok.send) assert.deepEqual(ok.remaining, ["WRITE", "CODE"]);

  // 送らない各ケース
  assert.deepEqual(reminderDecision({ prefs: base, covered: [], linked: false }, "20:00", today), { send: false, reason: "no-line" });
  assert.deepEqual(reminderDecision({ prefs: { ...base, reminderEnabled: false }, covered: [], linked: true }, "20:00", today), { send: false, reason: "disabled" });
  assert.deepEqual(reminderDecision({ prefs: base, covered: [], linked: true }, "20:30", today), { send: false, reason: "not-slot" });
  assert.deepEqual(reminderDecision({ prefs: { ...base, lastReminderDay: today }, covered: [], linked: true }, "20:00", today), { send: false, reason: "already-sent" });
  assert.deepEqual(reminderDecision({ prefs: base, covered: ["READ", "WRITE", "CODE"], linked: true }, "20:00", today), { send: false, reason: "mission-done" });
  // 前日に送っていれば今日は送れる
  assert.equal(reminderDecision({ prefs: { ...base, lastReminderDay: "2026-08-27" }, covered: [], linked: true }, "20:00", today).send, true);
});

test("文面: 残りの系統を具体的に言い、次の一歩を 1 つ示す", () => {
  assert.equal(remainingLabel(["WRITE", "CODE"]), "WRITEとLOGIC");
  const two = reminderBody(["WRITE", "CODE"]);
  assert.match(two, /WRITEとLOGIC/);
  assert.match(two, /次の一歩: WRITE/);
  const all = reminderBody(["READ", "WRITE", "CODE"]);
  assert.match(all, /1 問も解いていない/);
  const one = reminderBody(["CODE"]);
  assert.match(one, /LOGIC が残っている/);
  assert.match(one, /あと 1 問/);
});
