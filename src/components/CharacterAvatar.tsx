// AI 人格のちびキャラを丸く表示する（サーバー / クライアント両用の純粋 component）。
// 講評の吹き出し・結果画面・Dashboard・人格設定ページで使う。
import Image from "next/image";
import { CHARACTER_META, characterImagePath, type CharacterMood, type CharacterVariant } from "@/lib/characters";
import type { AgentKey } from "@/lib/persona";

export function CharacterAvatar({
  agent,
  size = 40,
  className = "",
  alt,
  variant = "face",
  mood = "normal",
}: {
  agent: AgentKey;
  /** 表示サイズ（px）。既定 40 */
  size?: number;
  className?: string;
  /** 省略時は「READ 担当のキャラクター」など */
  alt?: string;
  /** face = 丸い顔アイコン（既定） / full = 全身（枠なし・透過） */
  variant?: CharacterVariant;
  /** シチュエーション（正解 happy / 不正解 sad / もう一度 think / 祝福 cheer / 挨拶 wave / 深夜 sleepy） */
  mood?: CharacterMood;
}) {
  const meta = CHARACTER_META[agent];
  if (variant === "full") {
    return (
      <Image
        src={characterImagePath(agent, "full", mood)}
        alt={alt ?? meta.alt}
        width={size}
        height={size}
        className={`inline-block shrink-0 ${className}`}
        style={{ width: size, height: size, objectFit: "contain" }}
        unoptimized
      />
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-bg-elev ${className}`}
      style={{ width: size, height: size, borderColor: meta.cssColor, borderWidth: Math.max(1, Math.round(size / 32)) }}
    >
      <Image
        src={characterImagePath(agent, "face", mood)}
        alt={alt ?? meta.alt}
        width={size}
        height={size}
        // 顔のアップ版（LINE の吹き出しアイコンと同じ絵）
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        unoptimized
      />
    </span>
  );
}
