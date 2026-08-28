// 教材カタログを Dify のナレッジ（Dataset）に投入する。
//
//   npx tsx scripts/dify/upload_materials.mts --dry-run   # 送る内容を表示するだけ
//   npx tsx scripts/dify/upload_materials.mts             # 投入（DIFY_DATASET_API_KEY が必要）
//
// 環境変数（.env）:
//   DIFY_DATASET_API_KEY        ナレッジ API キー（Dify → ナレッジ → API → API キー）。アプリの API キーとは別物
//   DIFY_MATERIALS_DATASET_ID   投入先の Dataset id。未設定なら "trivium-materials" という名前で作成して id を表示する
//   DIFY_BASE_URL               既定 https://api.dify.ai（セルフホストなら自分の URL）
//
// 手順: 既存ドキュメントを名前（教材 id）で照合し、あれば上書き（update-by-text）、無ければ作成（create-by-text）。
// 1 教材 = 1 ドキュメントにして、検索結果のセグメントが教材単位で返るようにする。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIALS } from "../../src/lib/materials/catalog";
import { materialToMarkdown } from "./materials_markdown";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
    }
  } catch {
    // .env が無ければ process.env だけ
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
const dryRun = process.argv.includes("--dry-run");
const BASE = (env.DIFY_BASE_URL ?? "https://api.dify.ai").replace(/\/$/, "");
const KEY = env.DIFY_DATASET_API_KEY;
const DATASET_NAME = "trivium-materials";

async function api<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type Doc = { id: string; name: string };

async function ensureDataset(): Promise<string> {
  if (env.DIFY_MATERIALS_DATASET_ID) return env.DIFY_MATERIALS_DATASET_ID;
  const list = await api<{ data: { id: string; name: string }[] }>("GET", "/datasets?page=1&limit=100");
  const found = list.data.find((d) => d.name === DATASET_NAME);
  if (found) return found.id;
  const created = await api<{ id: string }>("POST", "/datasets", { name: DATASET_NAME, permission: "only_me" });
  console.log(`created dataset ${DATASET_NAME}: ${created.id}（.env に DIFY_MATERIALS_DATASET_ID=${created.id} を追記してください）`);
  return created.id;
}

async function listDocs(datasetId: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (let page = 1; page < 20; page++) {
    const r = await api<{ data: Doc[]; has_more?: boolean }>("GET", `/datasets/${datasetId}/documents?page=${page}&limit=100`);
    docs.push(...r.data);
    if (!r.has_more) break;
  }
  return docs;
}

async function main() {
  const docsBody = MATERIALS.map((m) => ({ name: m.id, text: materialToMarkdown(m) }));
  if (dryRun) {
    console.log(`[dry-run] ${docsBody.length} documents -> ${BASE} (dataset: ${env.DIFY_MATERIALS_DATASET_ID ?? `(create "${DATASET_NAME}")`})`);
    console.log(docsBody[0].text);
    return;
  }
  if (!KEY) throw new Error("DIFY_DATASET_API_KEY が未設定です（ナレッジの API キー。アプリの API キーとは別）");
  const datasetId = await ensureDataset();
  const existing = new Map((await listDocs(datasetId)).map((d) => [d.name, d.id]));
  let created = 0;
  let updated = 0;
  for (const d of docsBody) {
    const rule = { indexing_technique: "high_quality", process_rule: { mode: "automatic" } };
    const id = existing.get(d.name);
    if (id) {
      await api("POST", `/datasets/${datasetId}/documents/${id}/update-by-text`, { name: d.name, text: d.text, ...rule });
      updated++;
    } else {
      await api("POST", `/datasets/${datasetId}/document/create-by-text`, { name: d.name, text: d.text, ...rule });
      created++;
    }
    // レート制限に配慮して少し待つ
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`done: dataset=${datasetId} created=${created} updated=${updated}`);
}

await main();
