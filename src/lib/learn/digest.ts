// 「今日の3問」完了通知。JST の今日、READ / WRITE / LOGIC(CODE) の3領域すべてに記録が付いた瞬間に、
// LINE 連携済みなら Leader の総評と今日の変化を push する（1日1回。DailyDigest で冪等）。
// Web / LINE どちらの回答でも呼ばれる想定（service.finalize の末尾から）。
import "server-only";
import { prisma } from "@/lib/prisma";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { getTask } from "@/lib/tasks";
import { loadPersonas } from "@/lib/persona";
import { pushFlex, pushTo } from "@/lib/line/push";
import { loadEvents } from "@/lib/profile";
import { computeXp, dayKey, xpForEvent } from "@/lib/xp";
import { recommendationLine } from "@/lib/recommend";
import { dailyMaterialPick } from "@/lib/materials/daily";
import { XP } from "@/config/trivium.config";
import { agentReply, buildMissionFlex } from "@/lib/line/flex";

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

    // XP・streak・推薦（決定論）。DB 読み出しは直列（ローカル PG は並列に弱い）
    const all = await loadEvents(userId);
    const xp = computeXp(all, now);
    const todayKey = dayKey(now);
    const todayXp = all.filter((e) => dayKey(e.createdAt) === todayKey).reduce((a, e) => a + xpForEvent(e).total, 0);
    const streakBonus = Math.min(XP.streakBonusMax, xp.streak * XP.streakBonusPerDay);
    // 今日の 1 冊: 能力プロフィール（弱い系統・小分類）に合わせて教材カタログから 1 件（同じ日は同じ 1 件）
    const rec = await dailyMaterialPick(userId, day, now);

    const text = [
      `今日の3問、おつかれさまでした。`,
      ...rows,
      `+${todayXp + XP.dailyMissionBonus} XP（今日の課題 ${todayXp} / ミッション +${XP.dailyMissionBonus}）→ 合計 ${xp.total} XP・${xp.rank.title}・🔥 ${xp.streak} 日連続`,
      "",
      leader?.summary ? `${personas.LEADER.name}: ${leader.summary.replace(new RegExp(`^${personas.LEADER.name}: `), "")}` : "",
      leader?.recommendation ? `明日のおすすめ: ${leader.recommendation}` : "",
      rec ? `今日の 1 冊: ${recommendationLine(rec)}` : "",
    ]
      .filter((s) => s !== undefined && s !== "")
      .join("\n")
      .trim();

    await prisma.dailyDigest.update({ where: { userId_day: { userId, day } }, data: { summary: text.slice(0, 2000) } });
    const dashboardUrl = `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard`;
    const flex = buildMissionFlex({
      xp,
      earned: { tasks: todayXp, bonus: XP.dailyMissionBonus, streakBonus },
      recommendation: rec,
      rows,
      dashboardUrl,
    });
    // 1 通目: 今日の結果（テキスト）/ 2 通目: 案内役の総評（cheer のキャラ吹き出し）＋ミッション達成カード
    const statsText = [`今日の3問、おつかれさまでした。`, ...rows, `+${todayXp + XP.dailyMissionBonus} XP（今日の課題 ${todayXp} / ミッション +${XP.dailyMissionBonus}）→ 合計 ${xp.total} XP・${xp.rank.title}・🔥 ${xp.streak} 日連続`].join("\n");
    const leaderName = personas.LEADER.name;
    const leaderBody = [
      leader?.summary ? leader.summary.replace(new RegExp(`^${leaderName}: `), "") : "今日の3問、達成。…ま、まあ悪くないんじゃない。",
      leader?.recommendation ? `明日のおすすめ: ${leader.recommendation}` : "",
      rec ? `今日の 1 冊: ${recommendationLine(rec)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const appUrl = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    for (const l of links) {
      // 直列に送る（1 件の失敗が残りに影響しないように）
      await pushTo(l.lineUserId, { text: statsText }).catch((err) => console.warn("[digest] push failed:", (err as Error).message));
      await pushFlex(
        l.lineUserId,
        "今日の3問、達成！",
        flex,
        // Dashboard への導線は最後に送る達成カードのボタンに任せる（先行メッセージの Quick Reply は LINE では表示されない）
        agentReply("LEADER", leaderName, leaderBody, { appUrl, mood: "cheer" }),
      ).catch((err) => console.warn("[digest] push failed:", (err as Error).message));
    }
    return true;
  } catch (err) {
    console.warn("[digest] failed:", (err as Error).message);
    return false;
  }
}
