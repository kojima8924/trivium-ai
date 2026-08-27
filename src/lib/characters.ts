// AI 人格のちびキャラ画像（public/characters/*.png・512×512 透過 PNG）。
// 純粋モジュール: server-only を付けない（クライアント component と LINE の Flex 生成の両方から使う）。
// 内部キーは AgentKey（READ / WRITE / CODE / LEADER）のまま。表示名（LOGIC / ADVISOR）とは切り離す。
import type { AgentKey } from "@/lib/persona";

/** 画像を差し替えたら上げる（LINE / ブラウザのキャッシュ対策） */
export const CHARACTER_VERSION = 1;

export const CHARACTER_META: Record<
  AgentKey,
  {
    /** public/characters/ 配下のファイル名 */
    file: string;
    /** 系統色（Web。CSS 変数でダークモードに追従） */
    cssColor: string;
    /** 系統色（LINE の Flex は CSS 変数が使えないので hex 固定） */
    hex: string;
    /** 既定の alt 文言 */
    alt: string;
  }
> = {
  READ: { file: "read.png", cssColor: "var(--read)", hex: "#1d4ed8", alt: "READ 担当のキャラクター" },
  WRITE: { file: "write.png", cssColor: "var(--write)", hex: "#b45309", alt: "WRITE 担当のキャラクター" },
  CODE: { file: "code.png", cssColor: "var(--code)", hex: "#047857", alt: "LOGIC 担当のキャラクター" },
  // LEADER（表示名 ADVISOR）はラベンダー。ライト/ダーク両方で読める中間の明度
  LEADER: { file: "leader.png", cssColor: "#8b5cf6", hex: "#7c3aed", alt: "ADVISOR のキャラクター" },
};

/** 画像の種類: full = 全身（512px）、face = 顔のアップ（256px。アイコン・LINE の吹き出し用） */
export type CharacterVariant = "full" | "face";

/**
 * シチュエーション（表情差分）。scripts/characters/gen_moods.mts が `<agent>-<mood>.png` / `<agent>-<mood>-face.png` を生成する。
 *   normal: 通常（出題・説明）  happy: 正解  sad: 不正解（励まし）  think: もう一度・ヒント・作問中
 *   cheer: レベルアップ・ミッション達成・総評  wave: 挨拶・連携完了・使い方  sleepy: 深夜・休憩
 */
export type CharacterMood = "normal" | "happy" | "sad" | "think" | "cheer" | "wave" | "sleepy";
export const CHARACTER_MOODS: readonly CharacterMood[] = ["normal", "happy", "sad", "think", "cheer", "wave", "sleepy"];

/** 課題の結果 → mood（○=happy / △=think / ✕=sad） */
export function moodForMark(mark: "○" | "△" | "✕" | undefined): CharacterMood {
  return mark === "○" ? "happy" : mark === "△" ? "think" : mark === "✕" ? "sad" : "normal";
}

/** サイト内の相対パス（`/characters/read.png?v=1` / `/characters/read-happy-face.png?v=1`） */
export function characterImagePath(agent: AgentKey, variant: CharacterVariant = "full", mood: CharacterMood = "normal"): string {
  const base = CHARACTER_META[agent].file.replace(/\.png$/, "");
  const name = `${base}${mood === "normal" ? "" : `-${mood}`}${variant === "face" ? "-face" : ""}.png`;
  return `/characters/${name}?v=${CHARACTER_VERSION}`;
}

/**
 * 絶対 URL（LINE が取得するので HTTPS の絶対 URL が必須）。
 * appUrl は `env.appUrl`（server）か `LeaderContext.appUrl` を渡す。末尾の `/` は除く。
 */
export function characterImageUrl(agent: AgentKey, appUrl: string, variant: CharacterVariant = "face", mood: CharacterMood = "normal"): string {
  return `${appUrl.replace(/\/$/, "")}${characterImagePath(agent, variant, mood)}`;
}

/** 系統色（LINE 用 hex） */
export function characterHex(agent: AgentKey): string {
  return CHARACTER_META[agent].hex;
}
