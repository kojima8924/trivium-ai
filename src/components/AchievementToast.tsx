"use client";
// 実績解除の演出。画面中央に大きく「実績解除！」＋タイトル＋担当キャラ（cheer）を出し、紙吹雪（CSS のみ）で祝う。
// 複数あるときは 1 つずつ順に表示。閉じるボタンと自動クローズ（5 秒）。
import { useEffect, useState } from "react";
import { ACHIEVEMENTS, TIER_LABEL } from "@/lib/achievement-defs";
import type { AgentKey } from "@/lib/persona";
import { CharacterAvatar } from "@/components/CharacterAvatar";

const AUTO_CLOSE_MS = 5000;
const PIECES = 18;
const COLORS = ["#2563eb", "#d97706", "#059669", "#8b5cf6", "#ef4444", "#f59e0b"];

const TIER_STYLE: Record<string, string> = {
  bronze: "linear-gradient(135deg, #b45309, #f59e0b)",
  silver: "linear-gradient(135deg, #64748b, #cbd5e1)",
  gold: "linear-gradient(135deg, #b45309, #fbbf24 60%, #fde68a)",
};

export function AchievementToast({ keys, agent, onDone }: { keys: string[]; agent: AgentKey; onDone?: () => void }) {
  const [index, setIndex] = useState(0);
  const key = keys[index];
  const def = key ? ACHIEVEMENTS[key] : undefined;

  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => setIndex((i) => i + 1), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [key]);

  useEffect(() => {
    if (index >= keys.length) onDone?.();
  }, [index, keys.length, onDone]);

  if (!key || !def) return null;
  const next = () => setIndex((i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="実績解除" onClick={next}>
      <style>{`
        @keyframes trv-pop { 0% { transform: scale(.7); opacity: 0 } 60% { transform: scale(1.05); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes trv-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1 } 100% { transform: translateY(420px) rotate(540deg); opacity: 0 } }
        @keyframes trv-shine { 0% { background-position: 0% 50% } 100% { background-position: 100% 50% } }
        .trv-pop { animation: trv-pop .45s cubic-bezier(.2,.9,.3,1.2) both }
        .trv-piece { position: absolute; top: 0; width: 10px; height: 14px; border-radius: 2px; animation: trv-fall 2.6s ease-in forwards }
        @media (prefers-reduced-motion: reduce) { .trv-pop, .trv-piece { animation: none } }
      `}</style>
      <div
        className="trv-pop relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-bg-elev p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 紙吹雪 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: PIECES }, (_, i) => (
            <span
              key={`${key}-${i}`}
              className="trv-piece"
              style={{
                left: `${(i * 53) % 100}%`,
                background: COLORS[i % COLORS.length],
                animationDelay: `${(i % 6) * 0.12}s`,
                animationDuration: `${2.2 + (i % 4) * 0.3}s`,
              }}
            />
          ))}
        </div>

        <div className="wordmark text-[11px] text-muted">
          実績解除 {keys.length > 1 ? `${index + 1} / ${keys.length}` : ""}
        </div>
        <div className="mt-1 text-2xl font-black">🏅 実績解除！</div>
        <div className="mt-4 flex justify-center">
          <CharacterAvatar agent={agent} variant="full" mood="cheer" size={120} />
        </div>
        <div className="mt-3 text-4xl" aria-hidden="true">
          {def.emoji}
        </div>
        <div className="mt-1 text-xl font-bold">{def.title}</div>
        <div className="mt-1 text-sm text-muted">{def.description}</div>
        <span
          className="mt-3 inline-block rounded-full px-3 py-0.5 text-[11px] font-bold text-white"
          style={{ backgroundImage: TIER_STYLE[def.tier], backgroundSize: "200% 100%", animation: "trv-shine 2s linear infinite alternate" }}
        >
          {TIER_LABEL[def.tier]}
        </span>
        <div className="mt-5">
          <button type="button" className="btn btn-primary min-w-32" onClick={next}>
            {index + 1 < keys.length ? "次へ" : "閉じる"}
          </button>
        </div>
      </div>
    </div>
  );
}
