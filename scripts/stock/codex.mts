// 構造化出力の呼び出し口。既定はサブスクの Codex CLI（codex exec --output-schema。API 課金なし）で、
// STOCK_BACKEND=openai のときだけ OpenAI Responses API を使う。呼び出し側はどちらかを意識しない。
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BACKEND, CODEX_MODEL, ROOT } from "./config.mjs";

// ---- OpenAI ----
const envText = existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "";
const apiKey = envText.split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="))?.slice("OPENAI_API_KEY=".length).trim().replace(/^"|"$/g, "");
if (BACKEND === "openai" && !apiKey) throw new Error("OPENAI_API_KEY not found in .env");
const client = apiKey ? new OpenAI({ apiKey }) : null;

export let codexSeq = 0;
/**
 * Codex CLI（サブスク）で構造化出力を得る。`codex exec --output-schema` の最終メッセージを JSON として読む。
 * stdin を閉じないとハングするので必ず ignore。読み取り専用サンドボックス・一時ディレクトリで実行。
 */
export async function codexParse<T extends z.ZodTypeAny>(instructions: string, input: string, schema: T, name: string, effort: "low" | "medium" | "high"): Promise<z.infer<T>> {
  const dir = path.join(tmpdir(), "trivium-codex");
  mkdirSync(dir, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${codexSeq++}`;
  const schemaFile = path.join(dir, `${id}.schema.json`);
  const outFile = path.join(dir, `${id}.out.json`);
  const jsonSchema = zodTextFormat(schema, name).schema;
  writeFileSync(schemaFile, JSON.stringify(jsonSchema));
  const prompt = `${instructions}\n\n以下の入力に対して、指定の JSON スキーマに従う JSON だけを最終回答として返す（説明文は不要）。\n\n${input}`;
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "-C",
    dir,
    "--output-schema",
    schemaFile,
    "-o",
    outFile,
    "-c",
    `model_reasoning_effort="${effort}"`,
    ...(CODEX_MODEL ? ["-m", CODEX_MODEL] : []),
    "-",
  ];
  // プロンプトは引数ではなく stdin で渡す（Windows の shell 経由だと <tag> がリダイレクト扱いになり本文が消える）
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex timeout"));
    }, 240_000);
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
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`codex output does not match schema: ${parsed.error.issues[0]?.message ?? "?"}`);
  return parsed.data as z.infer<T>;
}

export async function parse<T extends z.ZodTypeAny>(model: string, instructions: string, input: string, schema: T, name: string, effort: "low" | "medium" | "high", maxTokens: number): Promise<z.infer<T>> {
  if (BACKEND === "codex") return codexParse(instructions, input, schema, name, effort);
  if (!client) throw new Error("OPENAI_API_KEY not found");
  const res = await client.responses.parse({
    model,
    instructions,
    input,
    text: { format: zodTextFormat(schema, name) },
    reasoning: { effort },
    max_output_tokens: maxTokens,
    store: false,
  });
  const parsed = res.output_parsed as z.infer<T> | null | undefined;
  if (!parsed) throw new Error(`parse failed (${res.status ?? "?"})`);
  return parsed;
}
