// 作問（generateTask）の疎通・品質チェック。npx tsx --conditions=react-server scripts/dev/gen-check.ts
import "dotenv/config";
import { learningAI, aiStatus } from "../../src/lib/ai";
import { SUBSKILLS } from "../../src/lib/domain";

async function main() {
  console.log("provider:", aiStatus());
  const t0 = Date.now();
  const t = await learningAI.generateTask({
    learnerRef: "dev-check",
    request: "論理パズルを1問出して",
    domain: "CODE",
    difficulty: 3,
    kind: "choice",
    allowedSkillTags: SUBSKILLS.CODE,
    recentTitles: [],
  });
  console.log(`(${Date.now() - t0} ms / ${aiStatus().lastUsed})`);
  console.log(JSON.stringify(t, null, 2));
  console.log("lastError:", aiStatus().lastError);
}
main().catch((e) => { console.error(e); process.exit(1); });
