// 選択式の講評キャッシュを事前生成する（デモ前に実行。LINE の即答・API 節約用）
//   npm run warm-cache -- --email demo+demo-learner@trivium.local [--all] [--levels 0,1,2]
//   既定は全 domain の choice タスク × 各選択肢 × ヒント段階 0。--levels で段階を増やせる。
// 人格（/settings）が変わるとキャッシュキーも変わるので、人格を決めてから実行する。
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { warmFeedbackCache } from "../src/lib/learn/service";
import { ALL_TASKS } from "../src/lib/tasks";
import { aiStatus } from "../src/lib/ai";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("--email") ?? "demo+demo-learner@trivium.local";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`user not found: ${email}`);
  const levels = (arg("--levels") ?? "0").split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);
  const ids = ALL_TASKS.filter((t) => t.kind === "choice").map((t) => t.id);
  console.log(`provider=${aiStatus().provider} / user=${user.id} / choice tasks=${ids.length} / levels=${levels.join(",")}`);
  const t0 = Date.now();
  const n = await warmFeedbackCache(user.id, ids, { hintLevels: levels, concurrency: 4 });
  const total = await prisma.taskFeedbackCache.count();
  console.log(`done: ${n} 件を処理（キャッシュ総数 ${total}）、${Math.round((Date.now() - t0) / 1000)} 秒`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
