// LINE Rich Menu セットアップ script
//
// 実行:
//   npm run line:richmenu
//   （= tsx --conditions=react-server scripts/line-richmenu.ts）
//
// 必要 env（.env から読む）:
//   LINE_CHANNEL_ACCESS_TOKEN   … Messaging API のチャネルアクセストークン（長期）
//   NEXT_PUBLIC_APP_URL         … Web アプリの公開URL（各ボタンのリンク先）
//
// 構成（2500×1686, 2行×3列）:
//   上段: READ | WRITE | LOGIC      → URI action（Web の /learn/*）
//   下段: 今日の学習 | 履歴 | PROFILE → postback action（action=today = LINE 上で1問 / history / profile）
//
// 画像:
//   public/line/richmenu.png があればそれを使う（2500×1686 推奨）。
//   無ければ、依存追加なしで単色背景＋区切り線の PNG を生成して使う（文字は描かない。
//   LINE 側の rich menu は画像必須のため、見栄えより「必ず作れる」ことを優先）。
//
// 既存の同名メニュー（name = RICH_MENU_NAME）は削除してから作り直す。
import "dotenv/config";
import { deflateSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { messagingApi } from "@line/bot-sdk";

const RICH_MENU_NAME = "trivium-main-v2";
const W = 2500;
const H = 1686;

function must(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`環境変数 ${name} が未設定です`);
    process.exit(1);
  }
  return v;
}

// ---- 依存なしの簡易 PNG 生成（RGB, 8bit, 無圧縮でも可だが deflate は zlib 標準で使える） ----

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 単色背景に 2×3 の区切り線と、上段/下段で色味を変えた PNG を生成 */
function generateFallbackPng(): Buffer {
  const top = [24, 32, 48]; // 上段: 濃紺
  const bottom = [38, 48, 66]; // 下段: 少し明るい
  const line = [96, 110, 130]; // 区切り線
  const accents: number[][] = [
    [37, 99, 235], // READ
    [217, 119, 6], // WRITE
    [5, 150, 105], // LOGIC
  ];
  const rowH = H / 2;
  const colW = W / 3;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0; // filter: none
    const isTop = y < rowH;
    const base = isTop ? top : bottom;
    for (let x = 0; x < W; x++) {
      let c = base;
      const col = Math.min(2, Math.floor(x / colW));
      // 上段の各セル上端にアクセントバー（domain 色）
      if (isTop && y < 28) c = accents[col];
      // 区切り線
      const nearCol = Math.abs((x % colW) - 0) < 3 && x > 0;
      const nearRow = Math.abs(y - rowH) < 3;
      if (nearCol || nearRow) c = line;
      raw[p++] = c[0];
      raw[p++] = c[1];
      raw[p++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function loadImage(): { buf: Buffer; source: string } {
  const path = join(process.cwd(), "public", "line", "richmenu.png");
  if (existsSync(path)) return { buf: readFileSync(path), source: path };
  return { buf: generateFallbackPng(), source: "(generated fallback)" };
}

async function main() {
  const token = must("LINE_CHANNEL_ACCESS_TOKEN");
  const appUrl = must("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");

  const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
  const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

  // 既存の同名メニューを削除
  const list = await client.getRichMenuList();
  for (const m of list.richmenus ?? []) {
    if (m.name === RICH_MENU_NAME) {
      await client.deleteRichMenu(m.richMenuId);
      console.log(`既存メニューを削除: ${m.richMenuId}`);
    }
  }

  const colW = Math.floor(W / 3);
  const rowH = Math.floor(H / 2);
  const cell = (col: number, row: number) => ({ x: col * colW, y: row * rowH, width: colW, height: rowH });

  const request: messagingApi.RichMenuRequest = {
    size: { width: W, height: H },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: "メニュー",
    areas: [
      { bounds: cell(0, 0), action: { type: "uri", label: "READ", uri: `${appUrl}/learn/read` } },
      { bounds: cell(1, 0), action: { type: "uri", label: "WRITE", uri: `${appUrl}/learn/write` } },
      { bounds: cell(2, 0), action: { type: "uri", label: "LOGIC", uri: `${appUrl}/learn/logic` } },
      { bounds: cell(0, 1), action: { type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" } },
      { bounds: cell(1, 1), action: { type: "postback", label: "履歴", data: "action=history", displayText: "履歴" } },
      { bounds: cell(2, 1), action: { type: "postback", label: "PROFILE", data: "action=profile", displayText: "PROFILE" } },
    ],
  };

  const { richMenuId } = await client.createRichMenu(request);
  console.log(`Rich Menu を作成: ${richMenuId}`);

  const img = loadImage();
  await blob.setRichMenuImage(richMenuId, new Blob([new Uint8Array(img.buf)], { type: "image/png" }));
  console.log(`画像を設定: ${img.source} (${img.buf.length} bytes)`);

  await client.setDefaultRichMenu(richMenuId);
  console.log("デフォルト Rich Menu に設定しました");
}

main().catch((e) => {
  console.error("失敗:", e?.message ?? e);
  if (e?.body) console.error(e.body);
  process.exit(1);
});
