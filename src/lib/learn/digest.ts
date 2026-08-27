// 「今日の3問」完了通知。JST の今日、READ / WRITE / LOGIC(CODE) の3領域すべてに記録が付いた瞬間に、
// LINE 連携済みなら Leader の総評と今日の変化を push する（1日1回。DailyDigest で冪等）。
// Web / LINE どちらの回答でも呼ばれる想定（service.finalize の末尾から）。
import "server-only";
import { prisma } from "@/lib/prisma";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { getTask } from "@/lib/tasks";
import { loadPersonas } from "@/lib/persona";
import { pushTo } from "@/lib/line/push";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の日付キー（YYYY-MM-DD）と、その日の開始時刻（UTC） */
export function jstDay(now: Date = new Date()): { day: string; start: Date } {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  const day = shifted.toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${day}T00:00:00+09:00`));
  return { day, start };
}

/**
 * 条件を満たせば総評を push して DailyDigest に記録し true を返す。それ以外は false。
 * 失敗しても例外は投げない（学習ループを止めない）。
 */
export async function notifyDailyDigestIfComplete(userId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { day, start } = jstDay(now);
    const [sent, links] = await Promise.all([
      prisma.dailyDigest.findUnique({ where: { userId_day: { userId, day } } }),
      prisma.lineUser.findMany({ where: { userId }, select: { lineUserId: true } }),
    ]);
    if (sent || links.length === 0) return false;

    const events = await prisma.learningEvent.findMany({
      where: { userId, createdAt: { gte: start } },
      orderBy: { createdAt: "asc" },
      select: { domain: true, taskId: true, success: true, hintCount: true, difficulty: true },
    });
    const covered = new Set(events.map((e) => e.domain as DomainKey));
    if (!DOMAINS.every((d) => covered.has(d))) return false;

    // 先に記録して二重送信を防ぐ（同時に3問目が決着した場合の競合対策）
    const created = await prisma.dailyDigest
      .create({ data: { userId, day } })
      .then(() => true)
      .catch(() => false);
    if (!created) return false;

    const [leader, snapshots, personas] = await Promise.all([
      prisma.leaderProfile.findUnique({ where: { userId } }),
      prisma.profileSnapshot.findMany({ where: { userId, createdAt: { gte: start } }, orderBy: { createdAt: "asc" } }),
      loadPersonas(userId),
    ]);

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const delta = (d: DomainKey): string => {
      if (!first || !last) return "";
      const key = d === "READ" ? "read" : d === "WRITE" ? "write" : "code";
      const a = first[key];
      const b = last[key];
      return b === a ? `${b}` : `${a} → ${b}（${b > a ? "+" : ""}${b - a}）`;
    };

    // 今日の各領域の最新の決着（domain ごとに最後の1件）
    const lastByDomain = new Map<DomainKey, (typeof events)[number]>();
    for (const e of events) lastByDomain.set(e.domain as DomainKey, e);
    const rows = DOMAINS.map((d) => {
      const e = lastByDomain.get(d)!;
      const title = getTask(e.taskId)?.title ?? "（作問した課題）";
      const how = e.success ? (e.hintCount === 0 ? "ヒントなしで正解" : `ヒント${e.hintCount}回で正解`) : "未達";
      const sc = delta(d);
      return `・${DOMAIN_META[d].label}: ${title}（難易度${e.difficulty}）— ${how}${sc ? ` / ${sc}` : ""}`;
    });

    const text = [
      `今日の3問、おつかれさまでした。`,
      ...rows,
      "",
      leader?.summary ? `${personas.LEADER.name}: ${leader.summary.replace(new RegExp(`^${personas.LEADER.name}: `), "")}` : "",
      leader?.recommendation ? `明日のおすすめ: ${leader.recommendation}` : "",
    ]
      .filter((s) => s !== undefined)
      .join("\n")
      .trim();

    await prisma.dailyDigest.update({ where: { userId_day: { userId, day } }, data: { summary: text.slice(0, 2000) } });
    await Promise.all(
      links.map((l) =>
        pushTo(l.lineUserId, {
          text,
          quickReplies: [{ type: "uri", label: "Dashboard", uri: `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard` }],
        }).catch((err) => console.warn("[digest] push failed:", (err as Error).message)),
      ),
    );
    return true;
  } catch (err) {
    console.warn("[digest] failed:", (err as Error).message);
    return false;
  }
}
