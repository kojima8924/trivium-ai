import type { MetadataRoute } from "next";

// PWA マニフェスト（/manifest.webmanifest として配信される）。
// LINE からスマホで開く導線があるため、ホーム画面に追加したときの見た目を整える。
// アイコンは scripts/brand-assets.ts が公式ロゴから生成した不透明 PNG。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trivium — READ / WRITE / CODE の学習ループ",
    short_name: "Trivium",
    description:
      "AI does not do the work for you. It helps you take the next step. 読む・書く・コードを読む学習と、行動から更新される能力プロフィール。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "ja",
    background_color: "#fafaf7", // globals.css の --bg（ライト）
    theme_color: "#fafaf7",
    categories: ["education", "productivity"],
    icons: [
      { src: "/brand/mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/mark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
