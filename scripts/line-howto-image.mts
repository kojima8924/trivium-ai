// LINE で配る「使い方」画像（1080×1440）を生成する。
//
//   npx tsx scripts/line-howto-image.mts
//   → public/line/howto.png（友だち追加時と「使い方」ボタンで配信）
//
// 画像生成 AI ではなく SVG 合成で作る（日本語が崩れないため）。キャラの顔は public/characters/*-face.png を埋め込む。
// 絵文字はフォントに無いことがあるので使わず、必要な記号は図形で描く。
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";

const W = 1080;
const H = 1440;
const BG = "#FAFAF7";
const INK = "#1C1C1A";
const MUTED = "#6B6B66";
const LINE_C = "#E6E4DC";
const READ = "#2563eb";
const WRITE = "#d97706";
const LOGIC = "#059669";
const ADVISOR = "#7c3aed";
const JP = "Noto Sans JP, Yu Gothic, Meiryo, sans-serif";

async function faceDataUri(name: string): Promise<string> {
  const buf = await readFile(`public/characters/${name}`);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** 丸く切り抜いた顔 */
function face(id: string, href: string, cx: number, cy: number, r: number, color: string): string {
  return `
    <defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}" /></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" />
    <image href="${href}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="5" />`;
}

/** 電球アイコン（絵文字はフォント依存なので図形で描く） */
function bulb(cx: number, cy: number, s: number, color: string): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="${s}" fill="none" stroke="${color}" stroke-width="5" />
    <rect x="${cx - s * 0.35}" y="${cy + s * 0.75}" width="${s * 0.7}" height="${s * 0.5}" rx="${s * 0.15}" fill="${color}" />
    <line x1="${cx}" y1="${cy - s * 0.45}" x2="${cx}" y2="${cy + s * 0.35}" stroke="${color}" stroke-width="5" stroke-linecap="round" />`;
}

/** 複数行テキスト（行は呼び出し側で決める。自動折返しだと句読点が行頭に来るため） */
function lines(rows: string[], x: number, y: number, size: number, fill = MUTED, lh = 44): string {
  return rows.map((r, i) => `<text x="${x}" y="${y + i * lh}" font-family="${JP}" font-size="${size}" fill="${fill}">${r}</text>`).join("\n");
}

/** 手順カード 1 枚（本文は顔にかからない幅で折り返す） */
function step(n: number, y: number, title: string, body: string[], color: string, faceSvg: string, titleIcon = ""): string {
  return `
  <g>
    <rect x="60" y="${y}" width="${W - 120}" height="230" rx="24" fill="#ffffff" stroke="${LINE_C}" stroke-width="2" />
    <circle cx="130" cy="${y + 62}" r="30" fill="${color}" />
    <text x="130" y="${y + 76}" text-anchor="middle" font-family="${JP}" font-size="38" font-weight="800" fill="#ffffff">${n}</text>
    <text x="180" y="${y + 76}" font-family="${JP}" font-size="42" font-weight="800" fill="${INK}">${title}</text>
    ${titleIcon}
    ${lines(body, 92, y + 140, 30)}
    ${faceSvg}
  </g>`;
}

async function buildSvg(): Promise<string> {
  const [read, write, code, leader] = await Promise.all([
    faceDataUri("read-face.png"),
    faceDataUri("write-face.png"),
    faceDataUri("code-face.png"),
    faceDataUri("leader-wave-face.png"),
  ]);
  const tri = (cx: number, cy: number, r: number) => {
    const pt = (deg: number, rr: number) => `${cx + rr * Math.cos(((deg - 90) * Math.PI) / 180)},${cy + rr * Math.sin(((deg - 90) * Math.PI) / 180)}`;
    return `
      <polygon points="${pt(0, r)} ${pt(120, r)} ${pt(240, r)}" fill="none" stroke="${LINE_C}" stroke-width="4" />
      <polygon points="${pt(0, r * 0.8)} ${pt(120, r * 0.5)} ${pt(240, r * 0.95)}" fill="${LOGIC}" fill-opacity="0.18" stroke="${LOGIC}" stroke-width="5" />`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}" />

  <text x="${W / 2}" y="98" text-anchor="middle" font-family="${JP}" font-size="56" font-weight="800" letter-spacing="6" fill="${INK}">TRIVIUM の使い方</text>
  <text x="${W / 2}" y="152" text-anchor="middle" font-family="${JP}" font-size="30" fill="${MUTED}">「読み・書き・そろばん」を、いまの形で 1 日 3 問</text>

  ${step(1, 200, "「連携」でつなぐ", ["Web アカウントと繋ぐと記録が残ります。", "下の「連携する」ボタンから。"], ADVISOR, face("f0", leader, W - 150, 200 + 148, 58, ADVISOR))}
  ${step(
    2,
    460,
    "1 日 3 問",
    ["READ・WRITE・LOGIC を 1 問ずつ。", "3 つそろえば今日のミッション達成。"],
    READ,
    `
      ${face("f1", read, W - 260, 460 + 148, 48, READ)}
      ${face("f2", write, W - 155, 460 + 148, 48, WRITE)}
      ${face("f3", code, W - 50, 460 + 148, 48, LOGIC)}`,
  )}
  ${step(
    3,
    720,
    "詰まったら ヒント",
    ["AI は答えを教えません。ボタンを押すと", "一段ずつヒントが出ます（最大 3 回）。"],
    LOGIC,
    face("f4", code, W - 150, 720 + 148, 58, LOGIC),
    bulb(560, 720 + 62, 22, LOGIC),
  )}

  <rect x="60" y="980" width="${W - 120}" height="252" rx="24" fill="#ffffff" stroke="${LINE_C}" stroke-width="2" />
  <text x="92" y="1042" font-family="${JP}" font-size="38" font-weight="800" fill="${INK}">解いた記録が、三角形になる</text>
  ${lines(["得意と伸ばしどころが見えます。", "「読解の本を教えて」で教材も提案。", "気が乗らない問題は「パス」でOK。"], 92, 1098, 29, MUTED, 50)}
  ${tri(W - 175, 1112, 82)}
  <text x="${W - 175}" y="1016" text-anchor="middle" font-family="${JP}" font-size="22" font-weight="700" fill="${READ}">READ</text>
  <text x="${W - 285}" y="1214" text-anchor="middle" font-family="${JP}" font-size="22" font-weight="700" fill="${WRITE}">WRITE</text>
  <text x="${W - 68}" y="1214" text-anchor="middle" font-family="${JP}" font-size="22" font-weight="700" fill="${LOGIC}">LOGIC</text>

  <text x="${W / 2}" y="1312" text-anchor="middle" font-family="${JP}" font-size="34" font-weight="700" fill="${INK}">下のメニューから、いつでも 1 問。</text>
  <text x="${W / 2}" y="1364" text-anchor="middle" font-family="${JP}" font-size="29" fill="${MUTED}">質問・相談は、そのまま話しかけてください。</text>
</svg>`;
}

async function main() {
  await mkdir("public/line", { recursive: true });
  const svg = await buildSvg();
  const out = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await sharp(out).toFile("public/line/howto.png");
  const meta = await sharp(out).metadata();
  console.log(`wrote public/line/howto.png ${meta.width}x${meta.height} ${Math.round(out.length / 1024)}KB`);
}

await main();
