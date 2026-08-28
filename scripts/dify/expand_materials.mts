// Codex CLI（サブスク）で教材カタログを拡充・検証する（API 課金なし）
//
//   npx tsx scripts/dify/expand_materials.mts --verify            # 既存カタログ 1 件ずつ「実在・書誌・URL・レベル帯」を再検証 → out/materials_verify.json
//   npx tsx scripts/dify/expand_materials.mts --expand 20         # 系統ごとに 20 件の追加候補を Codex に出させ、別の Codex で検証 → out/materials_candidates.json
//
// 生成物は scripts/dify/out/ に置く（git 管理外）。採用は人が確認してから src/lib/materials/catalog.ts に追記する。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIALS } from "../../src/lib/materials/catalog";
import type { Material } from "../../src/lib/materials/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const CONCURRENCY = 4;
let seq = 0;

async function codexJson<T>(prompt: string, schema: object, effort: "low" | "medium" | "high" = "low"): Promise<T> {
  const dir = path.join(tmpdir(), "trivium-codex");
  mkdirSync(dir, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${seq++}`;
  const schemaFile = path.join(dir, `${id}.schema.json`);
  const outFile = path.join(dir, `${id}.out.json`);
  writeFileSync(schemaFile, JSON.stringify(schema));
  const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", dir, "--output-schema", schemaFile, "-o", outFile, "-c", `model_reasoning_effort="${effort}"`, "-"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex timeout"));
    }, 300_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exit ${code}: ${err.slice(-200)}`));
    });
  });
  let raw = "";
  try {
    raw = readFileSync(outFile, "utf8");
  } finally {
    for (const f of [schemaFile, outFile]) if (existsSync(f)) unlinkSync(f);
  }
  return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")) as T;
}

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    exists: { type: "boolean" },
    confidence: { type: "number" },
    title_ok: { type: "boolean" },
    author_ok: { type: "boolean" },
    url_ok: { type: "boolean" },
    level_ok: { type: "boolean" },
    suggested_level_min: { type: "integer" },
    suggested_level_max: { type: "integer" },
    issues: { type: "string" },
  },
  required: ["exists", "confidence", "title_ok", "author_ok", "url_ok", "level_ok", "suggested_level_min", "suggested_level_max", "issues"],
  additionalProperties: false,
};

const CANDIDATES_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          kind: { type: "string", enum: ["book", "web", "video", "course", "practice"] },
          author: { type: "string" },
          url: { type: "string" },
          domains: { type: "array", items: { type: "string", enum: ["READ", "WRITE", "CODE"] } },
          subskills: { type: "array", items: { type: "string" } },
          levelMin: { type: "integer" },
          levelMax: { type: "integer" },
          summary: { type: "string" },
          why: { type: "string" },
          free: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
        required: ["id", "title", "kind", "author", "url", "domains", "subskills", "levelMin", "levelMax", "summary", "why", "free", "tags", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const LEVEL_SCALE = "難易度スケール: 1=誰でも（小学校中学年）、2=小学校高学年、3=中学、4=高校入門、5=高校標準、6=大学入試基礎、7=大学入試応用・社会人実務、8=大学上級・専門職、9=専門家・競技、10=非常に難しい";
const SUBSKILLS = "READ: comprehension/inference/critical_reading、WRITE: structure/clarity/reasoning/revision、CODE: tracing/debugging/algorithms/design";

async function verifyAll(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const results: Record<string, unknown> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < MATERIALS.length) {
      const m = MATERIALS[cursor++];
      const prompt = [
        "あなたは日本の学習教材に詳しい司書。次の教材データが実在し、書誌情報（title/author/url）が正しいか、対象レベル帯が妥当かを判定する。",
        "確信が持てない場合は exists=false ではなく confidence を下げ、issues に理由を書く。URL は公式運営元かどうかだけ判断（アクセスはできない）。",
        LEVEL_SCALE,
        "<material>",
        JSON.stringify(m, null, 1),
        "</material>",
      ].join("\n");
      try {
        results[m.id] = await codexJson(prompt, VERIFY_SCHEMA, "low");
        const r = results[m.id] as { exists: boolean; confidence: number; issues: string };
        console.log(`${r.exists && r.confidence >= 0.7 ? "ok  " : "WARN"} ${m.id} (${r.confidence.toFixed(2)}) ${r.issues.slice(0, 80)}`);
      } catch (err) {
        console.log(`err  ${m.id}: ${(err as Error).message.slice(0, 100)}`);
      }
      writeFileSync(path.join(OUT, "materials_verify.json"), JSON.stringify(results, null, 2));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const warn = Object.entries(results).filter(([, r]) => !(r as { exists: boolean; confidence: number }).exists || (r as { confidence: number }).confidence < 0.7);
  console.log(`verify done: ${Object.keys(results).length} checked, ${warn.length} need review -> ${path.join(OUT, "materials_verify.json")}`);
}

async function expand(perDomain: number): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const existing = MATERIALS.map((m) => `${m.title}（${m.author ?? ""}）`);
  type Candidate = Material & { confidence: number };
  const all: Candidate[] = [];
  for (const domain of ["READ", "WRITE", "CODE"] as const) {
    const label = domain === "CODE" ? "LOGIC（論理パズル・数的推理・アルゴリズム・Python）" : domain === "READ" ? "READ（読解・要約・批判的読解・語彙）" : "WRITE（作文・文章術・論理的な書き方）";
    const prompt = [
      `日本語話者（高校生〜社会人）向けに ${label} を伸ばす教材を ${perDomain} 件、追加で提案する。`,
      "**実在が確実な定番書・公式サイト・公的機関・有名学習サービスだけ**（少しでも不確かな書名・著者・URL は出さず、その分は件数を減らしてよい）。既存リストと重複しない。",
      "書籍は正確な title/author（出版社を括弧で）、url は公式が確実な場合のみ（無ければ空文字）。Web/動画/講座は公式 URL 必須。",
      "各件に levelMin/levelMax、subskills（キーは指定のもの）、summary（1〜2 文）、why（どんな人に効くか）、free、tags、confidence（実在と書誌の確信 0〜1）。",
      "id は book-/web-/video-/course-/practice- 接頭辞＋英数字スラッグ。",
      LEVEL_SCALE,
      `subskills のキー: ${SUBSKILLS}`,
      "<existing>",
      existing.join("\n"),
      "</existing>",
    ].join("\n");
    try {
      const r = await codexJson<{ items: (Material & { confidence: number })[] }>(prompt, CANDIDATES_SCHEMA, "medium");
      console.log(`[${domain}] ${r.items.length} candidates`);
      all.push(...r.items.map((m) => ({ ...m, domains: m.domains.length ? m.domains : [domain] })));
    } catch (err) {
      console.log(`[${domain}] failed: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  // 別の Codex で 1 件ずつ検証
  const verified: (Candidate & { verify?: unknown })[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < all.length) {
      const m = all[cursor++];
      const prompt = ["次の教材データが実在し、書誌情報が正しいかを判定する（前の提案者とは独立に）。不確かなら confidence を下げる。", LEVEL_SCALE, "<material>", JSON.stringify(m, null, 1), "</material>"].join("\n");
      try {
        const v = await codexJson<{ exists: boolean; confidence: number; issues: string }>(prompt, VERIFY_SCHEMA, "low");
        console.log(`${v.exists && v.confidence >= 0.75 ? "ok  " : "drop"} ${m.id} ${m.title} (${v.confidence.toFixed(2)}) ${v.issues.slice(0, 60)}`);
        if (v.exists && v.confidence >= 0.75 && m.confidence >= 0.7) verified.push({ ...m, verify: v });
      } catch (err) {
        console.log(`err  ${m.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(path.join(OUT, "materials_candidates.json"), JSON.stringify(verified, null, 2));
  console.log(`expand done: ${verified.length}/${all.length} verified -> ${path.join(OUT, "materials_candidates.json")}`);
}

const args = process.argv.slice(2);
if (args.includes("--verify")) await verifyAll();
else if (args.includes("--expand")) await expand(Number(args[args.indexOf("--expand") + 1] || 20));
else console.log("usage: --verify | --expand <perDomain>");
