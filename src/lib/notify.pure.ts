// 通知設定（デイリーミッションのリマインダー / 今日の総評）の純粋関数。
// server-only は付けない: cron ルート・設定 API・テストの三方から使う。
// 保存先は LeaderProfile.preferences の "notify" キー 1 つだけ（migration 不要・引き継ぎも 1 キーで済む）。
import { DOMAINS, DOMAIN_META, type DomainKey } from "./domain";

export type NotifyPrefs = {
  /** デイリーミッション（3 系統 1 問ずつ）のリマインダーを LINE に送るか */
  reminderEnabled: boolean;
  /** リマインダーの時刻。JST の "HH:MM"（30 分刻み） */
  reminderTime: string;
  /** 3 問そろったときの総評を LINE で受け取るか */
  digestEnabled: boolean;
  /** 最後にリマインダーを送った JST の日付（YYYY-MM-DD）。同じ日の二重送信を防ぐ */
  lastReminderDay: string;
};

/** LeaderProfile.preferences 内のキー。ADVISOR 再計算のときはこのキーごと引き継ぐ */
export const NOTIFY_PREFS_KEY = "notify";

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  reminderEnabled: true,
  reminderTime: "20:00",
  digestEnabled: true,
  lastReminderDay: "",
};

/** 選べる時刻（JST・30 分刻み） */
export const REMINDER_TIMES: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 未知の JSON から NotifyPrefs を組み立てる（不正な値は既定に落とす） */
export function parseNotifyPrefs(raw: unknown): NotifyPrefs {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const time = typeof o.reminderTime === "string" && TIME_RE.test(o.reminderTime) ? o.reminderTime : DEFAULT_NOTIFY_PREFS.reminderTime;
  return {
    reminderEnabled: typeof o.reminderEnabled === "boolean" ? o.reminderEnabled : DEFAULT_NOTIFY_PREFS.reminderEnabled,
    reminderTime: time,
    digestEnabled: typeof o.digestEnabled === "boolean" ? o.digestEnabled : DEFAULT_NOTIFY_PREFS.digestEnabled,
    lastReminderDay: typeof o.lastReminderDay === "string" && DAY_RE.test(o.lastReminderDay) ? o.lastReminderDay : "",
  };
}

/** preferences（Json 全体）から通知設定だけ取り出す */
export function notifyPrefsFromPreferences(preferences: unknown): NotifyPrefs {
  const o = (preferences && typeof preferences === "object" && !Array.isArray(preferences) ? preferences : {}) as Record<string, unknown>;
  return parseNotifyPrefs(o[NOTIFY_PREFS_KEY]);
}

// ---- JST の日付と 30 分枠 ----

/** JST の "YYYY-MM-DD" と "HH:MM"（30 分単位に切り下げ） */
export function jstDayAndSlot(now: Date): { day: string; slot: string } {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // sv-SE は "2026-08-28 20:05" 形式
  const [day, time] = f.format(now).split(" ");
  const [hh, mm] = time.split(":");
  const slot = `${hh}:${Number(mm) < 30 ? "00" : "30"}`;
  return { day, slot };
}

// ---- 送信判定 ----

export type ReminderDecision =
  | { send: true; remaining: DomainKey[] }
  | { send: false; reason: "no-line" | "disabled" | "not-slot" | "already-sent" | "mission-done" };

/**
 * この 30 分枠でリマインダーを送るか。
 * 送るのは「LINE 連携済み・リマインダー ON・時刻が一致・今日まだ送っていない・今日のミッションが未達成」のときだけ。
 */
export function reminderDecision(
  input: { prefs: NotifyPrefs; covered: DomainKey[]; linked: boolean },
  slot: string,
  today: string,
): ReminderDecision {
  if (!input.linked) return { send: false, reason: "no-line" };
  if (!input.prefs.reminderEnabled) return { send: false, reason: "disabled" };
  if (input.prefs.reminderTime !== slot) return { send: false, reason: "not-slot" };
  if (input.prefs.lastReminderDay === today) return { send: false, reason: "already-sent" };
  const remaining = DOMAINS.filter((d) => !input.covered.includes(d));
  if (remaining.length === 0) return { send: false, reason: "mission-done" };
  return { send: true, remaining };
}

/** 残っている系統を「READ と WRITE」のように並べる */
export function remainingLabel(remaining: DomainKey[]): string {
  return remaining.map((d) => DOMAIN_META[d].label).join("と");
}

/** リマインダー本文（ADVISOR＝ミチが話す前提。答えは出さず、次の一歩を 1 つだけ示す） */
export function reminderBody(remaining: DomainKey[]): string {
  if (remaining.length >= DOMAINS.length) {
    return ["今日はまだ 1 問も解いていないわね。", "READ・WRITE・LOGIC のどれでもいいから、1 問だけ。3 分で終わるわ。", "", "次の一歩: 下の「今日の学習」を押す。"].join("\n");
  }
  const label = remainingLabel(remaining);
  const first = DOMAIN_META[remaining[0]].label;
  return [
    `今日はまだ ${label} が残っているわ。`,
    remaining.length === 1 ? "あと 1 問でミッション達成。ここまで来たなら、やっておきなさい。" : "1 問だけでもいい。べ、別にあなたのためじゃないけど。",
    "",
    `次の一歩: ${first} を 1 問。`,
  ].join("\n");
}
