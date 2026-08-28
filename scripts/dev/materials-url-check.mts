// 教材カタログ（src/lib/materials/catalog.ts）の URL を全件検査する（開発用）。
//   npx tsx --conditions=react-server scripts/dev/materials-url-check.mts
//
// LINE 内ブラウザは証明書の警告を無視できないので、ホスト名不一致の証明書は「開けないリンク」になる。
// 外部ブラウザでは警告を押し切れば見えてしまい気づきにくいため、機械的に検査する。
// 注意: Cloudflare などの bot 対策で 403 を返すサイト（leetcode / codeforces など）は
//       実ブラウザでは開けるので、403 は「要確認」であって「壊れている」ではない。
import { MATERIALS } from "../../src/lib/materials/catalog";

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 Line/14.0";
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;

type Bad = { kind: "broken" | "blocked"; line: string };

const targets = MATERIALS.filter((m) => m.url).map((m) => ({ id: m.id, url: m.url! }));
const bad: Bad[] = [];
let cursor = 0;

async function worker() {
  while (cursor < targets.length) {
    const m = targets[cursor++];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(m.url, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA } });
      if (res.status === 403 || res.status === 429) bad.push({ kind: "blocked", line: `HTTP ${res.status}  ${m.id}  ${m.url}` });
      else if (res.status >= 400) bad.push({ kind: "broken", line: `HTTP ${res.status}  ${m.id}  ${m.url}` });
    } catch (e) {
      const cause = (e as Error).cause;
      bad.push({ kind: "broken", line: `${cause ? String(cause).slice(0, 100) : (e as Error).message}  ${m.id}  ${m.url}` });
    } finally {
      clearTimeout(timer);
    }
  }
}

console.log(`URL を持つ教材: ${targets.length} 件 / 全 ${MATERIALS.length} 件`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const broken = bad.filter((b) => b.kind === "broken");
const blocked = bad.filter((b) => b.kind === "blocked");
if (blocked.length > 0) {
  console.log(`\n要確認（bot 対策の可能性。実ブラウザで開けるなら問題なし）: ${blocked.length} 件`);
  for (const b of blocked) console.log("  " + b.line);
}
if (broken.length > 0) {
  console.log(`\n壊れているリンク: ${broken.length} 件`);
  for (const b of broken) console.log("  " + b.line);
  process.exitCode = 1;
} else {
  console.log("\n壊れているリンクはありません");
}
