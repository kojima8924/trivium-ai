// Flex Message の低レベル部品（色・テキスト・横棒・区切り線）。
// LINE の Flex は CSS 変数が使えないので、ライトテーマの色を固定値で持つ。
// 用途別のカード（プロフィール / ミッション / キャラの吹き出し / 教材）は flex.ts が組み立てる。
import type { messagingApi } from "@line/bot-sdk";
import type { DomainKey } from "@/lib/domain";

export type Box = messagingApi.FlexBox;
export type Component = messagingApi.FlexComponent;

export const COLOR: Record<DomainKey, string> = { READ: "#1d4ed8", WRITE: "#b45309", CODE: "#047857" };
export const INK = "#1c1c1a";
export const MUTED = "#6b6b66";
export const LINE_COLOR = "#e6e4dc";
export const TRACK = "#f0eee7";

export function text(t: string, extra: Partial<messagingApi.FlexText> = {}): messagingApi.FlexText {
  return { type: "text", text: t || " ", wrap: true, size: "sm", color: INK, ...extra };
}

/** 横棒。ratio は 0..1。LINE の Flex は width を % で指定できる */
export function bar(ratio: number, color: string): Box {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: TRACK,
    cornerRadius: "sm",
    height: "8px",
    contents: [
      {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        cornerRadius: "sm",
        height: "8px",
        // 0% だと LINE 側で描画エラーになることがあるので最小 1%
        width: `${Math.max(1, pct)}%`,
        contents: [],
      },
    ],
  };
}

export function separator(): messagingApi.FlexSeparator {
  return { type: "separator", color: LINE_COLOR };
}
