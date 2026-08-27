// ちびキャラのシチュエーション差分（mood）を、基準の全身絵（public/characters/<agent>.png）から
// OpenAI 画像編集（gpt-image-1.5）で生成し、全身 512px と顔アップ 256px を public/characters に書き出す。
//
//   npx tsx scripts/characters/gen_moods.mts            # 4 キャラ × 全 mood（既存ファイルはスキップ）
//   npx tsx scripts/characters/gen_moods.mts --agent code --mood happy,sad
//   npx tsx scripts/characters/gen_moods.mts --force   # 既存も作り直す
//
// 顔アップは Python(Pillow) ではなく sharp で切り出す（依存追加なし）。
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DIR = path.join(ROOT, "public/characters");
const MODEL = "gpt-image-1.5";
const CONCURRENCY = 4;

const AGENTS = ["read", "write", "code", "leader"] as const;
type Agent = (typeof AGENTS)[number];

/** キャラの見た目の要約（編集時に崩れないよう毎回明示する） */
const LOOK: Record<Agent, string> = {
  read: "a young man librarian of the underworld: black bob hair, sleepy half-closed eyes, indigo-blue kimono with dark haori, a small fox mask on the side of his head, a small paper lantern",
  write: "a high-school girl newspaper club president: brown high ponytail, sailor-style uniform with a yellow ribbon, an armband, a red pen behind her ear, manuscript papers",
  code: "a young man programmer: messy brown hair, white lab coat over a dark hoodie, a monocle on one eye, green headphones around his neck, a small laptop",
  leader: "a tsundere girl guide at a crossroads: silver-white twin-tails with purple ribbons, white hooded cape with lavender trim, a wooden signpost with three arrows (blue, yellow, green)",
};

/** シチュエーション → 表情・ポーズの指示 */
const MOODS: Record<string, string> = {
  happy: "big happy smile with sparkling eyes, one hand raised in a cheerful thumbs-up. Celebrating a correct answer.",
  sad: "gentle troubled expression with slightly downturned eyebrows, one hand scratching the back of the head, encouraging mood (not crying). After a wrong answer.",
  think: "thinking pose: hand on chin, eyes looking up, a small question mark floating beside the head. Waiting for another try.",
  cheer: "both arms raised high in triumph, confetti and small stars around, excited open-mouth smile. Level up celebration.",
  wave: "friendly greeting: waving one hand, warm smile, slight lean forward. Welcome / hello.",
  sleepy: "sleepy: eyes closed, small yawn, a tiny 'zzz' beside the head, relaxed posture. Late night rest.",
};
// ツンデレの案内役だけ、happy は「照れながら」に寄せる
const OVERRIDES: Partial<Record<Agent, Partial<Record<string, string>>>> = {
  leader: {
    happy: "proud tsundere smile with a light blush, arms crossed but clearly pleased, slight glance to the side. 'It's not like I'm happy for you.'",
    sad: "pouting with a light blush, looking away, one hand on hip, secretly worried. After the learner's wrong answer.",
  },
};

const STYLE =
  "Keep exactly the same character design, outfit, colors, art style (LINE sticker style chibi, 2-heads-tall, thick clean outlines, flat pastel cel shading), full body, centered, single character, transparent background, no text, no letters, no watermark.";

function envKey(): string {
  const env = readFileSync(path.join(ROOT, ".env"), "utf8");
  const k = env.split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="))?.slice("OPENAI_API_KEY=".length).trim().replace(/^"|"$/g, "");
  if (!k) throw new Error("OPENAI_API_KEY not found");
  return k;
}
const client = new OpenAI({ apiKey: envKey() });

async function faceCrop(fullPng: Buffer): Promise<Buffer> {
  // 透明部分をトリムしてから、上 55% を正方形に切り出す（二頭身なので顔は上半分）
  const trimmed = await sharp(fullPng).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const w = meta.width ?? 512;
  const h = meta.height ?? 512;
  const side = Math.min(w, Math.round(h * 0.55));
  const left = Math.max(0, Math.round(w / 2 - side / 2));
  const top = Math.round(h * 0.02);
  const pad = Math.round(side * 0.08);
  // sharp は resize を extend より先に適用するので、切り出し＋余白と縮小は 2 段に分ける
  const padded = await sharp(trimmed)
    .extract({ left, top, width: side, height: Math.min(side, h - top) })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(padded).resize(256, 256).png().toBuffer();
}

async function fullNormalize(png: Buffer): Promise<Buffer> {
  // 余白トリム → 正方形に戻す → 512px
  const trimmed = await sharp(png).trim().png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const w = meta.width ?? 512;
  const h = meta.height ?? 512;
  const s = Math.max(w, h) + 40;
  // composite は resize の後に適用されるため、正方形化と縮小は 2 段に分ける
  const square = await sharp({ create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed, left: Math.round((s - w) / 2), top: Math.round((s - h) / 2) }])
    .png()
    .toBuffer();
  return sharp(square).resize(512, 512).png().toBuffer();
}

async function gen(agent: Agent, mood: string, force: boolean): Promise<string> {
  const outFull = path.join(DIR, `${agent}-${mood}.png`);
  const outFace = path.join(DIR, `${agent}-${mood}-face.png`);
  if (!force && existsSync(outFull) && existsSync(outFace)) return `skip ${agent}-${mood}`;
  const base = readFileSync(path.join(DIR, `${agent}.png`));
  const pose = OVERRIDES[agent]?.[mood] ?? MOODS[mood];
  const prompt = `Redraw this character (${LOOK[agent]}) with a new expression and pose: ${pose} ${STYLE}`;
  const res = await client.images.edit({
    model: MODEL,
    image: await toFile(base, `${agent}.png`, { type: "image/png" }),
    prompt,
    size: "1024x1024",
    quality: "medium",
    background: "transparent",
    output_format: "png",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("no image");
  const raw = Buffer.from(b64, "base64");
  writeFileSync(outFull, await fullNormalize(raw));
  writeFileSync(outFace, await faceCrop(raw));
  return `ok ${agent}-${mood}`;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const agents = (args.includes("--agent") ? args[args.indexOf("--agent") + 1].split(",") : [...AGENTS]) as Agent[];
const moods = args.includes("--mood") ? args[args.indexOf("--mood") + 1].split(",") : Object.keys(MOODS);
const jobs = agents.flatMap((a) => moods.map((m) => ({ a, m })));
let cursor = 0;
const failures: string[] = [];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const { a, m } = jobs[cursor++];
      try {
        console.log(await gen(a, m, force));
      } catch (err) {
        failures.push(`${a}-${m}: ${(err as Error).message.slice(0, 120)}`);
        console.log(`fail ${a}-${m}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }),
);
if (failures.length) {
  console.error(`FAILED ${failures.length}:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("done");
