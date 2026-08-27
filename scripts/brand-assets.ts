// ブランド素材の生成スクリプト
//   元画像: public/brand/mark.png（Tマーク）/ public/brand/logo.png（横組みロゴ）
//   出力  : 余白を切り、白背景を透明化し、用途別サイズに縮小した PNG
//
//   npx tsx scripts/brand-assets.ts
//
// 生成物（いずれもコミット対象）:
//   src/app/icon.png              ファビコン（Next の app icon 規約）
//   src/app/apple-icon.png        iOS ホーム画面用
//   public/brand/mark-192.png     PWA アイコン（192）
//   public/brand/mark-512.png     PWA アイコン（512）
//   public/brand/logo-wide.png    ヘッダー・ヒーロー用の横組みロゴ（透過）
//   src/app/opengraph-image.png   OGP（1200×630。静的PNGなので実行時依存が無い）
//   src/app/twitter-image.png     同上（Twitter カード）
//
// LINE Rich Menu の画像は別スクリプト: scripts/line-richmenu-image.ts
import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";

const SRC_MARK = "public/brand/mark.png";
const SRC_LOGO = "public/brand/logo.png";

const BG_COLOR = { r: 0xfa, g: 0xfa, b: 0xf7, alpha: 1 }; // globals.css の --bg と同じ

/** 周囲の余白を落とす（元画像の背景は #f7f7f5 程度なので閾値を緩める） */
function trimmed(path: string) {
  return sharp(path).trim({ threshold: 12 });
}

/**
 * 背景の白～オフホワイトを透明にする。
 * sharp の unflatten は「純白」しか抜けず、元画像の #f7f7f5 が残ってしまうため、
 * 明度でアルファを作る（245 以上は完全透明、225 以下は不透明。間はなだらかに）。
 * 文字や図の内部にある白も抜けるが、ロゴでは輪郭が主なので実用上問題ない。
 */
async function transparentLogo(path: string, height: number): Promise<Buffer> {
  const { data, info } = await trimmed(path)
    .resize({ height, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const HI = 245;
  const LO = 225;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let a = 255;
    if (luma >= HI) a = 0;
    else if (luma > LO) a = Math.round(((HI - luma) / (HI - LO)) * 255);
    data[i + 3] = Math.min(data[i + 3], a);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** マーク（アプリアイコン）は不透明に。内部の白い図版を抜かないため背景色で塗り潰す */
function opaqueMark(size: number) {
  return trimmed(SRC_MARK)
    .resize(size, size, { fit: "contain", background: BG_COLOR })
    .flatten({ background: BG_COLOR });
}

async function main() {
  await mkdir("public/brand", { recursive: true });

  // マーク（正方形）: ファビコン・PWA アイコン
  for (const [out, size] of [
    ["src/app/icon.png", 256],
    ["src/app/apple-icon.png", 180],
    ["public/brand/mark-192.png", 192],
    ["public/brand/mark-512.png", 512],
  ] as const) {
    await opaqueMark(size).png({ compressionLevel: 9 }).toFile(out);
    console.log("wrote", out, `${size}px`);
  }

  // 横組みロゴ: ヘッダー/ヒーロー用（透過・高さ基準で 2 倍解像度）
  const wideBuf = await transparentLogo(SRC_LOGO, 96);
  const wide = await sharp(wideBuf).toFile("public/brand/logo-wide.png");
  console.log("wrote public/brand/logo-wide.png", `${wide.width}x${wide.height}`);

  await buildOgpImage();
}

/** OGP 画像（1200×630）。ImageResponse を使わず静的 PNG にして、standalone Docker での実行時依存を無くす */
async function buildOgpImage() {
  const W = 1200;
  const H = 630;
  const JP = "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif";
  const chips: [string, string, string][] = [
    ["READ", "読む", "#2563eb"],
    ["WRITE", "書く", "#d97706"],
    ["CODE", "コード", "#059669"],
  ];
  const chipW = 230;
  const chipGap = 24;
  const chipY = 452;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#FAFAF7" />
    <rect x="0" y="0" width="${W}" height="10" fill="#2563eb" />
    <rect x="${W / 3}" y="0" width="${W / 3}" height="10" fill="#d97706" />
    <rect x="${(W / 3) * 2}" y="0" width="${W / 3}" height="10" fill="#059669" />
    <text x="80" y="268" font-family="${JP}" font-size="52" font-weight="800" fill="#1C1C1A">AI does not do the work for you.</text>
    <text x="80" y="336" font-family="${JP}" font-size="52" font-weight="500" fill="#6B6B66">It helps you take the next step.</text>
    <text x="80" y="404" font-family="${JP}" font-size="27" font-weight="500" fill="#6B6B66">READ / WRITE / CODE の学習ループと、行動から更新される能力プロフィール</text>
    ${chips
      .map(([en, jp, color], i) => {
        const x = 80 + i * (chipW + chipGap);
        return `<g>
          <rect x="${x}" y="${chipY}" width="${chipW}" height="76" rx="16" fill="#FFFFFF" stroke="${color}" stroke-width="3" />
          <text x="${x + 26}" y="${chipY + 50}" font-family="${JP}" font-size="34" font-weight="800" letter-spacing="3" fill="${color}">${en}</text>
          <text x="${x + chipW - 26}" y="${chipY + 50}" text-anchor="end" font-family="${JP}" font-size="26" font-weight="500" fill="#6B6B66">${jp}</text>
        </g>`;
      })
      .join("")}
  </svg>`;

  const logo = await transparentLogo(SRC_LOGO, 84);

  // 右側の透かし: マークを薄くして文字の背面に置く
  const MARK_H = 300;
  const markSolid = await transparentLogo(SRC_MARK, MARK_H);
  const mark = await sharp(markSolid)
    .composite([
      { input: Buffer.from([255, 255, 255, 38]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" },
    ])
    .png()
    .toBuffer();

  const info = await sharp(Buffer.from(svg))
    .composite([
      { input: mark, top: 250, left: W - MARK_H - 56 },
      { input: logo, top: 96, left: 80 },
    ])
    .png({ compressionLevel: 9 })
    .toFile("src/app/opengraph-image.png");
  await copyFile("src/app/opengraph-image.png", "src/app/twitter-image.png");
  console.log("wrote src/app/opengraph-image.png", `${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`);
  console.log("wrote src/app/twitter-image.png (同一画像)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
