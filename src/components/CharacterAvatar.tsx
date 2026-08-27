// AI 人格のちびキャラを丸く表示する（サーバー / クライアント両用の純粋 component）。
// 講評の吹き出し・結果画面・Dashboard・人格設定ページで使う。
import Image from "next/image";
import { CHARACTER_META, characterImagePath } from "@/lib/characters";
import type { AgentKey } from "@/lib/persona";

export function CharacterAvatar({
  agent,
  size = 40,
  className = "",
  alt,
}: {
  agent: AgentKey;
  /** 表示サイズ（px）。既定 40 */
  size?: number;
  className?: string;
  /** 省略時は「READ 担当のキャラクター」など */
  alt?: string;
}) {
  const meta = CHARACTER_META[agent];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-bg-elev ${className}`}
      style={{ width: size, height: size, borderColor: meta.cssColor, borderWidth: Math.max(1, Math.round(size / 32)) }}
    >
      <Image
        src={characterImagePath(agent, "face")}
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
