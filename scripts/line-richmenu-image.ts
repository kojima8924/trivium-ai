// LINE Rich Menu の画像（2500×1686）を生成する
//
//   npx tsx scripts/line-richmenu-image.ts
//   → public/line/richmenu.png
//
// このファイルが存在すると scripts/line-richmenu.ts（アップロード側）がそれを使う。
// タップ領域は line-richmenu.ts 側で「幅を3等分・高さを2等分」した6セルなので、
// 見た目のカードもその 6 セルの内側に収める（ズレるとボタンと絵柄が食い違う）。
//
//   上段: READ | WRITE | CODE        → Web の /learn/* を開く
//   下段: 今日の学習 | 履歴 | PROFILE → postback（Leader が LINE 上で応答）
//
// 依存は sharp（devDependency）のみ。日本語は Windows の Noto Sans JP を SVG 経由で描画する。
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const W = 2500;
const H = 1686;
const COL = Math.floor(W / 3); // 833
const ROW = Math.floor(H / 2); // 843
const INSET = 30; // タップセルの内側に置くカードの余白
const CARD_W = COL - INSET * 2;
const CARD_H = ROW - INSET * 2;
const RADIUS = 32;

const BG = "#FAFAF7";
const INK = "#1C1C1A";
const MUTED = "#6B6B66";
const LINE = "#E6E4DC";

const JP = "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif";
const MONO = "Consolas, DejaVu Sans Mono, monospace";

type Cell = { col: number; row: number };

function cardBox({ col, row }: Cell) {
  return { x: col * COL + INSET, y: row * ROW + INSET, w: CARD_W, h: CARD_H };
}

/** READ: 開いた本 */
function bookIcon(cx: number, cy: number, color: string): string {
  const s = 1.9; // 100pt を基準にした拡大率
  const t = (x: number, y: number) => `${cx + (x - 50) * s},${cy + (y - 50) * s}`;
  return `
    <path d="M ${t(8, 24)} C ${t(28, 12)} ${t(43, 15)} ${t(50, 24)} L ${t(50, 84)} C ${t(43, 75)} ${t(28, 72)} ${t(8, 84)} Z"
          fill="${color}" />
    <path d="M ${t(92, 24)} C ${t(72, 12)} ${t(57, 15)} ${t(50, 24)} L ${t(50, 84)} C ${t(57, 75)} ${t(72, 72)} ${t(92, 84)} Z"
          fill="${color}" opacity="0.82" />
    <g stroke="#FFFFFF" stroke-width="${2.6 * s}" stroke-linecap="round" opacity="0.9">
      <line x1="${t(17, 40).split(",")[0]}" y1="${t(17, 40).split(",")[1]}" x2="${t(41, 36).split(",")[0]}" y2="${t(41, 36).split(",")[1]}" />
      <line x1="${t(17, 55).split(",")[0]}" y1="${t(17, 55).split(",")[1]}" x2="${t(41, 51).split(",")[0]}" y2="${t(41, 51).split(",")[1]}" />
      <line x1="${t(59, 36).split(",")[0]}" y1="${t(59, 36).split(",")[1]}" x2="${t(83, 40).split(",")[0]}" y2="${t(83, 40).split(",")[1]}" />
      <line x1="${t(59, 51).split(",")[0]}" y1="${t(59, 51).split(",")[1]}" x2="${t(83, 55).split(",")[0]}" y2="${t(83, 55).split(",")[1]}" />
    </g>`;
}

/** WRITE: ペン先 */
function penIcon(cx: number, cy: number, color: string): string {
  const s = 1.9;
  const t = (x: number, y: number) => `${cx + (x - 50) * s},${cy + (y - 50) * s}`;
  return `
    <path d="M ${t(26, 82)} L ${t(34, 46)} L ${t(64, 16)} L ${t(86, 38)} L ${t(56, 68)} Z" fill="${color}" />
    <circle cx="${cx + (60 - 50) * s}" cy="${cy + (42 - 50) * s}" r="${7 * s}" fill="#FFFFFF" />
    <line x1="${t(26, 82).split(",")[0]}" y1="${t(26, 82).split(",")[1]}" x2="${t(44, 64).split(",")[0]}" y2="${t(44, 64).split(",")[1]}"
          stroke="${color}" stroke-width="${4 * s}" stroke-linecap="round" />
    <line x1="${t(10, 88).split(",")[0]}" y1="${t(10, 88).split(",")[1]}" x2="${t(90, 88).split(",")[0]}" y2="${t(90, 88).split(",")[1]}"
          stroke="${color}" stroke-width="${5 * s}" stroke-linecap="round" opacity="0.5" />`;
}

/** CODE: </> */
function codeIcon(cx: number, cy: number, color: string): string {
  return `<text x="${cx}" y="${cy + 62}" text-anchor="middle" font-family="${MONO}" font-size="170" font-weight="700" fill="${color}">&lt;/&gt;</text>`;
}

/** 今日の学習: 円＋再生三角 */
function todayIcon(cx: number, cy: number, color: string): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="86" fill="none" stroke="${color}" stroke-width="12" />
    <path d="M ${cx - 26} ${cy - 44} L ${cx + 50} ${cy} L ${cx - 26} ${cy + 44} Z" fill="${color}" />`;
}

/** 履歴: 時計 */
function clockIcon(cx: number, cy: number, color: string): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="86" fill="none" stroke="${color}" stroke-width="12" />
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 50}" stroke="${color}" stroke-width="12" stroke-linecap="round" />
    <line x1="${cx}" y1="${cy}" x2="${cx + 40}" y2="${cy + 14}" stroke="${color}" stroke-width="12" stroke-linecap="round" />`;
}

/** PROFILE: 三角形レーダー（アプリの能力プロフィールと同じ形） */
function radarIcon(cx: number, cy: number, color: string): string {
  const R = 92;
  const pt = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + Math.cos(rad) * r).toFixed(1)},${(cy + Math.sin(rad) * r).toFixed(1)}`;
  };
  return `
    <polygon points="${pt(0, R)} ${pt(120, R)} ${pt(240, R)}" fill="none" stroke="${color}" stroke-width="10" opacity="0.45" />
    <polygon points="${pt(0, R * 0.72)} ${pt(120, R * 0.5)} ${pt(240, R * 0.88)}" fill="${color}" fill-opacity="0.42" stroke="${color}" stroke-width="12" />
    ${[0, 120, 240].map((d) => `<circle cx="${pt(d, d === 0 ? R * 0.72 : d === 120 ? R * 0.5 : R * 0.88).split(",")[0]}" cy="${pt(d, d === 0 ? R * 0.72 : d === 120 ? R * 0.5 : R * 0.88).split(",")[1]}" r="11" fill="${color}" />`).join("")}`;
}

/** 上段: 白カード＋domain色の帯・アイコン */
function domainCard(cell: Cell, color: string, label: string, jp: string, icon: (cx: number, cy: number, c: string) => string): string {
  const b = cardBox(cell);
  const cx = b.x + b.w / 2;
  return `
    <g>
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${RADIUS}" fill="${color}" />
      <rect x="${b.x}" y="${b.y + 18}" width="${b.w}" height="${b.h - 18}" rx="${RADIUS}" fill="#FFFFFF" stroke="${LINE}" stroke-width="3" />
      ${icon(cx, b.y + 300, color)}
      <text x="${cx}" y="${b.y + 545}" text-anchor="middle" font-family="${JP}" font-size="104" font-weight="800" letter-spacing="10" fill="${color}">${label}</text>
      <text x="${cx}" y="${b.y + 640}" text-anchor="middle" font-family="${JP}" font-size="56" font-weight="500" fill="${MUTED}">${jp}</text>
    </g>`;
}

/** 下段: 濃色カード（アプリの primary ボタンと同じ語彙） */
function actionCard(cell: Cell, label: string, sub: string, icon: (cx: number, cy: number, c: string) => string, accent: string): string {
  const b = cardBox(cell);
  const cx = b.x + b.w / 2;
  return `
    <g>
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${RADIUS}" fill="${INK}" />
      ${icon(cx, b.y + 300, accent)}
      <text x="${cx}" y="${b.y + 545}" text-anchor="middle" font-family="${JP}" font-size="82" font-weight="700" fill="#FFFFFF">${label}</text>
      <text x="${cx}" y="${b.y + 630}" text-anchor="middle" font-family="${JP}" font-size="48" font-weight="400" fill="#A3A29B">${sub}</text>
    </g>`;
}

function buildSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}" />
  ${domainCard({ col: 0, row: 0 }, "#2563eb", "READ", "読む", bookIcon)}
  ${domainCard({ col: 1, row: 0 }, "#d97706", "WRITE", "書く", penIcon)}
  ${domainCard({ col: 2, row: 0 }, "#059669", "CODE", "コード", codeIcon)}
  ${actionCard({ col: 0, row: 1 }, "今日の学習", "次の一歩を提案", todayIcon, "#F5F4EF")}
  ${actionCard({ col: 1, row: 1 }, "履歴", "最近の学習を見る", clockIcon, "#F5F4EF")}
  ${actionCard({ col: 2, row: 1 }, "PROFILE", "能力プロフィール", radarIcon, "#F5F4EF")}
</svg>`;
}

async function main() {
  await mkdir("public/line", { recursive: true });

  const base = sharp(Buffer.from(buildSvg())).png({ compressionLevel: 9, palette: true });

  // 上下段の間（カードの外側にある背景の帯）に横組みロゴを置く。
  // カードに重ならないので、ボタンの意味を邪魔しないブランドの署名になる。
  const logo = await sharp("public/brand/logo.png")
    .trim({ threshold: 12 })
    .ensureAlpha()
    .unflatten()
    .resize({ height: 52, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const logoW = logoMeta.width ?? 200;

  const info = await base
    .composite([
      {
        input: logo,
        top: ROW - Math.round(52 / 2), // 行の境界（= 帯の中心）
        left: Math.round((W - logoW) / 2),
        blend: "over",
      },
    ])
    .toFile("public/line/richmenu.png");

  console.log(`wrote public/line/richmenu.png ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)}KB`);
  if (info.size > 1_000_000) console.warn("警告: LINE の rich menu 画像は 1MB 以下にする必要があります");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
