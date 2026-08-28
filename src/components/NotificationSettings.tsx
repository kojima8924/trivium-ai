"use client";

import { useState } from "react";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { REMINDER_TIMES, type NotifyPrefs } from "@/lib/notify.pure";

// LINE への通知設定。デイリーミッション（3 系統 1 問ずつ）のリマインダーと、3 問そろったときの総評。
// 保存は /api/settings/notifications（LeaderProfile.preferences の notify キー）。初期値は server から props で渡す。
export function NotificationSettings({ initial, linked }: { initial: NotifyPrefs; linked: boolean }) {
  const [prefs, setPrefs] = useState<NotifyPrefs>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "ng"; text: string } | null>(null);

  function update(patch: Partial<NotifyPrefs>) {
    setPrefs((p) => ({ ...p, ...patch }));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminderEnabled: prefs.reminderEnabled, reminderTime: prefs.reminderTime, digestEnabled: prefs.digestEnabled }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: "通知設定を保存しました。" });
    } catch (e) {
      setMsg({ kind: "ng", text: `保存できませんでした: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <CharacterAvatar agent="LEADER" size={40} mood="wave" />
        <div>
          <h2 className="text-base font-bold">LINE の通知</h2>
          <p className="text-xs text-muted">
            1 日 3 問（READ / WRITE / LOGIC を 1 問ずつ）がデイリーミッションです。まだ残っている日だけ、ADVISOR が指定の時刻に一声かけます。達成済みの日や、すでに送った日は送りません。
          </p>
        </div>
      </div>

      {!linked && (
        <p className="rounded-lg border border-line bg-bg-elev px-3 py-2 text-xs text-muted">
          LINE と連携していないため、通知は届きません（設定は保存できます）。LINE で「連携」と送ると繋げられます。
        </p>
      )}

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm">
        <input type="checkbox" checked={prefs.reminderEnabled} onChange={(e) => update({ reminderEnabled: e.target.checked })} className="mt-1" disabled={busy} />
        <span>
          <span className="font-medium">デイリーミッションのリマインダー</span>
          <span className="block text-[11px] leading-snug text-muted">残っている系統を挙げて「1 問だけでもどう？」と送ります（1 日 1 回まで）。</span>
        </span>
      </label>

      <label className="flex max-w-xs flex-col gap-1 text-xs text-muted">
        リマインダーの時刻（日本時間）
        <select
          value={prefs.reminderTime}
          onChange={(e) => update({ reminderTime: e.target.value })}
          className="min-h-11 rounded-lg border border-line bg-bg px-2 py-2 text-sm text-fg"
          disabled={busy || !prefs.reminderEnabled}
        >
          {REMINDER_TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm">
        <input type="checkbox" checked={prefs.digestEnabled} onChange={(e) => update({ digestEnabled: e.target.checked })} className="mt-1" disabled={busy} />
        <span>
          <span className="font-medium">今日の総評を受け取る</span>
          <span className="block text-[11px] leading-snug text-muted">3 系統そろった日に、ADVISOR の総評・XP・今日の 1 冊が届きます。</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "保存しています…" : "通知設定を保存"}
        </button>
        {msg && (
          <span role="status" aria-live="polite" className={`text-sm ${msg.kind === "ok" ? "text-ok" : "text-ng"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
