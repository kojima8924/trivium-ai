// ブランド素材の生成スクリプト
//   元画像: public/brand/mark.png（Tマーク）/ public/brand/logo.png（横組みロゴ）
//   出力  : 余白を切り、白背景を透明化し、用途別サイズに縮小した PNG
//
//   npx tsx scripts/brand-assets.ts
//
// 生成物（いずれもコミット対象）:
//   src/app/icon.png            ファビコン（Next の app icon 規約）
//   src/app/apple-icon.png      iOS ホーム画面用
//   public/brand/mark-192.png   PWA/OGP 等の汎用マーク
//   public/brand/logo-wide.png  ヘッダー・ヒーロー用の横組みロゴ（透過）
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC_MARK = "public/brand/mark.png";
const SRC_LOGO = "public/brand/logo.png";

/** 周囲の白～オフホワイト余白を切り落とし、白背景を透明にする */
function clean(path: string) {
  return sharp(path)
    .trim({ threshold: 12 }) // 元画像の背景は #f7f7f5 程度なので閾値を少し緩める
    .ensureAlpha()
    .unflatten(); // 白に近い画素を透明化
}

async function main() {
  await mkdir("public/brand", { recursive: true });

  // マーク（正方形）: ファビコン等
  for (const [out, size] of [
    ["src/app/icon.png", 256],
    ["src/app/apple-icon.png", 180],
    ["public/brand/mark-192.png", 192],
  ] as const) {
    await clean(SRC_MARK)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log("wrote", out, `${size}px`);
  }

  // 横組みロゴ: ヘッダー/ヒーロー用（高さ基準で 2 倍解像度）
  const wide = await clean(SRC_LOGO)
    .resize({ height: 96, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile("public/brand/logo-wide.png");
  console.log("wrote public/brand/logo-wide.png", `${wide.width}x${wide.height}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
