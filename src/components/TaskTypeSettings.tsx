"use client";

import { useState } from "react";
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";
import { COMPOSITE_TYPE, TASK_TYPES, type TaskPrefs } from "@/lib/task-types";
import { CharacterAvatar } from "@/components/CharacterAvatar";

// 出題する問題タイプの設定。系統ごとにチェックボックス（外したタイプは出題・作問しない）＋複合問題のトグル。
// 保存は /api/settings/task-types（LeaderProfile.preferences に保存）。初期値はサーバー側で読んで props で渡す。
export function TaskTypeSettings({ initial, colors }: { initial: TaskPrefs; colors: Record<DomainKey, string> }) {
  const [prefs, setPrefs] = useState<TaskPrefs>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "ng"; text: string } | null>(null);

  function toggle(domain: DomainKey, key: string, on: boolean) {
    setPrefs((p) => {
      const cur = p.excludedTaskTypes[domain];
      const next = on ? cur.filter((k) => k !== key) : cur.includes(key) ? cur : [...cur, key];
      return { ...p, excludedTaskTypes: { ...p.excludedTaskTypes, [domain]: next } };
    });
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/task-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMsg({ kind: "ok", text: "出題設定を保存しました。次の出題から反映されます。" });
    } catch (e) {
      setMsg({ kind: "ng", text: `保存できませんでした: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-base font-bold">出題する問題タイプ</h2>
        <p className="text-xs text-muted">
          チェックを外したタイプは、Web・LINE の出題と AI 作問の両方から外れます（例: 「Python 読解」を外すと LOGIC は論理パズルや数的推理だけになります）。系統ごとに 1 つ以上は残してください。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {DOMAINS.map((d) => {
          const excluded = prefs.excludedTaskTypes[d];
          const remaining = TASK_TYPES[d].length - excluded.length;
          return (
            <fieldset key={d} className="flex flex-col gap-2 rounded-lg border border-line p-3" style={{ borderTopColor: colors[d], borderTopWidth: 3 }}>
              <legend className="sr-only">{DOMAIN_META[d].label} の問題タイプ</legend>
              <div className="flex items-center gap-2">
                <CharacterAvatar agent={d} size={32} />
                <span className="wordmark text-sm" style={{ color: colors[d] }}>
                  {DOMAIN_META[d].label}
                </span>
                <span className="ml-auto text-[11px] text-muted">
                  {remaining} / {TASK_TYPES[d].length}
                </span>
              </div>
              {TASK_TYPES[d].map((t) => {
                const on = !excluded.includes(t.key);
                return (
                  <label key={t.key} className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(d, t.key, e.target.checked)} className="mt-1" disabled={busy} />
                    <span>
                      <span className="font-medium">{t.label}</span>
                      <span className="block text-[11px] leading-snug text-muted">{t.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm">
        <input
          type="checkbox"
          checked={!prefs.excludeComposite}
          onChange={(e) => {
            setPrefs((p) => ({ ...p, excludeComposite: !e.target.checked }));
            setMsg(null);
          }}
          className="mt-1"
          disabled={busy}
        />
        <span>
          <span className="font-medium">{COMPOSITE_TYPE.label}を出す</span>
          <span className="block text-[11px] leading-snug text-muted">{COMPOSITE_TYPE.description}。成功すると関わった系統すべてに、失敗は一番弱い系統だけに記録されます。</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "保存しています…" : "出題設定を保存"}
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
