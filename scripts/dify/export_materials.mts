// 教材カタログ（src/lib/materials/catalog.ts）を Dify ナレッジ用の Markdown に書き出す。
//
//   npx tsx scripts/dify/export_materials.mts            # dify/materials/<id>.md を 1 件 1 ファイルで生成
//   npx tsx scripts/dify/export_materials.mts --single   # dify/materials/ALL.md に 1 ファイルでまとめる（手動アップロード用）
//
// 見出し = title、本文に kind / domains / subskills / level / summary / why / tags / url。
// Dify 側では「セグメント = 1 教材」になるよう、1 件ずつ投入するのが検索精度上よい（upload_materials.mts が行う）。
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MATERIALS } from "../../src/lib/materials/catalog";
import { materialToMarkdown } from "./materials_markdown";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../../dify/materials");

// upload_materials.mts から import されたときは書き出さない（直接実行のときだけ）
const invokedDirectly = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
const args = process.argv.slice(2);
if (invokedDirectly) mkdirSync(OUT_DIR, { recursive: true });
if (!invokedDirectly) {
  // no-op
} else if (args.includes("--single")) {
  writeFileSync(path.join(OUT_DIR, "ALL.md"), MATERIALS.map(materialToMarkdown).join("\n\n---\n\n") + "\n");
  console.log(`wrote ${path.join(OUT_DIR, "ALL.md")} (${MATERIALS.length} materials)`);
} else {
  // 古い書き出しを消してから（カタログから外れた教材のファイルを残さない）
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith(".md") && f !== "ALL.md") rmSync(path.join(OUT_DIR, f));
  for (const m of MATERIALS) writeFileSync(path.join(OUT_DIR, `${m.id}.md`), materialToMarkdown(m) + "\n");
  console.log(`wrote ${MATERIALS.length} files to ${OUT_DIR}`);
}
