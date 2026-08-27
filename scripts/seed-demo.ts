// デモ用seed CLI
//   npm run seed:demo -- --email someone@example.com [--reset]
//   npm run seed:demo -- --name "Demo Learner"        （ユーザーが無ければ作成）
// ※ server-only モジュールを Node から読むため、npm script 側で --conditions=react-server を付けている
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { seedDemoForUser } from "../src/lib/demo-seed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("--email");
  const name = arg("--name") ?? "Demo Learner";
  const reset = process.argv.includes("--reset");

  let user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (!user) {
    const fallbackEmail = email ?? `demo+${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@trivium.local`;
    user = await prisma.user.upsert({
      where: { email: fallbackEmail },
      update: {},
      create: { email: fallbackEmail, name },
    });
    console.log(`ユーザーを作成/取得: ${user.email}`);
  }
  const r = await seedDemoForUser(user.id, { reset });
  console.log(`seed完了: ${r.inserted} 件の learning_events を投入しました (user=${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
