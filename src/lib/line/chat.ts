// LINE 上で 4 人格と会話する。
// 履歴切り詰めの純粋部分は chat.pure.ts に置く。
//   - 宛先は「ケイ、〜」のような呼びかけで決める（無ければ案内役 LEADER）
//   - 人格の観察メモ（LEADER は 4 つ分）・本人の能力サマリ・直近 N 往復を input に渡す（system には混ぜない）
//   - 発話と返答を ChatTurn に保存し、人格ごとに直近 N 往復だけを prompt に載せる
import "server-only";
import { formatScore } from "@/lib/scoring";
import { EXTERNAL } from "@/config/trivium.config";
import { prisma } from "@/lib/prisma";
import { learningAI, type ChatTurnInput } from "@/lib/ai";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { getAllMemories, getMemory } from "@/lib/memory";
import { agentReply } from "./flex";
import { loadPersonas, personaPrompts, type AgentKey } from "@/lib/persona";
import { getDashboardData } from "@/lib/profile";
import type { LeaderAction, LeaderReply } from "./leader";
import { trimHistory } from "./chat.pure";

type ChatResult = { agent: AgentKey; text: string; suggestDomain: DomainKey | null; usedSearch: boolean };

/** 能力サマリ（数値は集計値のみ。文章は寸評）。LEADER には 3 系統、系統人格には自分の系統だけ */
async function profileSummaryFor(userId: string, agent: AgentKey): Promise<string> {
  const data = await getDashboardData(userId);
  if (data.totalEvents === 0) return "";
  const domains = agent === "LEADER" ? data.domains : data.domains.filter((d) => d.domain === agent);
  const lines = domains.map((d) => {
    const label = DOMAIN_META[d.domain].label;
    if (d.evidenceCount === 0) return `${label}: 未計測`;
    return `${label}: ${formatScore(d.score)}（信頼度 ${d.confidence}・${d.evidenceCount}件）${d.summary ? ` / ${d.summary}` : ""}`;
  });
  if (agent === "LEADER" && data.leader) {
    lines.push(`総評: ${data.leader.summary}`);
    if (data.leader.recommendation) lines.push(`次のおすすめ: ${data.leader.recommendation}`);
  }
  return lines.join("\n");
}

async function loadHistory(userId: string, agent: AgentKey): Promise<ChatTurnInput[]> {
  const rows = await prisma.chatTurn.findMany({
    where: { userId, agent },
    orderBy: { createdAt: "desc" },
    take: EXTERNAL.chatHistoryTurns * 2 + 2,
    select: { role: true, text: true },
  });
  const turns = rows.reverse().map((r) => ({ role: r.role === "assistant" ? ("assistant" as const) : ("user" as const), text: r.text }));
  return trimHistory(turns);
}

/**
 * 人格と 1 往復する。発話→返答の順に ChatTurn へ保存。
 * LLM が失敗したときは LearningAIService が Mock に落とすので、ここでは投げない。
 */
export async function chatWithAgent(userId: string, agent: AgentKey, userText: string): Promise<ChatResult> {
  const [personas, history] = await Promise.all([personaPrompts(userId), loadHistory(userId, agent)]);
  const memoryNotes =
    agent === "LEADER"
      ? await getAllMemories(userId).then((m) =>
          (["LEADER", "READ", "WRITE", "CODE"] as const)
            .filter((a) => m[a])
            .map((a) => `[${a}] ${m[a]}`)
            .join("\n"),
        )
      : await getMemory(userId, agent);
  const profileSummary = await profileSummaryFor(userId, agent);

  await prisma.chatTurn.create({ data: { userId, agent, role: "user", text: userText.slice(0, 2000) } });
  const out = await learningAI.chat({
    learnerRef: userId,
    persona: personas[agent],
    userText: userText.slice(0, 2000),
    history,
    memoryNotes,
    profileSummary,
    allowSearch: EXTERNAL.webSearchAllowed.chat,
  });
  const text = out.text.trim().slice(0, 1500);
  await prisma.chatTurn.create({ data: { userId, agent, role: "assistant", text } });
  // 古い履歴は残しても害は無いが、無限に増えないよう人格ごとに 100 件を超えた分は削る
  await pruneHistory(userId, agent).catch(() => undefined);
  return { agent, text, suggestDomain: out.suggestDomain, usedSearch: out.usedSearch };
}

async function pruneHistory(userId: string, agent: AgentKey, keep = 100): Promise<void> {
  const old = await prisma.chatTurn.findMany({
    where: { userId, agent },
    orderBy: { createdAt: "desc" },
    skip: keep,
    select: { id: true },
  });
  if (old.length) await prisma.chatTurn.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/** 「〜に聞く」の Quick Reply（名前はユーザー設定を反映）＋「今日の学習」 */
export async function agentQuickReplies(userId: string, appUrl: string): Promise<LeaderAction[]> {
  const personas = await loadPersonas(userId);
  const ask: LeaderAction[] = (["READ", "WRITE", "CODE", "LEADER"] as const).map((a) => ({
    type: "postback",
    label: `${personas[a].name}に聞く`.slice(0, 20),
    data: `action=ask&agent=${a}`,
    displayText: `${personas[a].name}に聞く`,
  }));
  return [
    ...ask,
    { type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" },
    { type: "uri", label: "Dashboard", uri: `${appUrl.replace(/\/$/, "")}/dashboard` },
  ];
}

/** 返答を LINE メッセージにする。勧める系統があればそのボタンを先頭に */
export async function chatReply(
  userId: string,
  appUrl: string,
  r: ChatResult,
  opts: { offerQuiz?: boolean } = {},
): Promise<LeaderReply> {
  const personas = await loadPersonas(userId);
  const name = personas[r.agent].name;
  const text = r.text.startsWith(`${name}: `) ? r.text : `${name}: ${r.text}`;
  const quick = await agentQuickReplies(userId, appUrl);
  const suggest: LeaderAction[] =
    r.suggestDomain && (DOMAINS as readonly string[]).includes(r.suggestDomain)
      ? [
          {
            type: "postback",
            label: `${DOMAIN_META[r.suggestDomain].label}で1問`,
            data: `action=quiz&domain=${r.suggestDomain}`,
            displayText: `${DOMAIN_META[r.suggestDomain].label}で1問`,
          },
        ]
      : [];
  // 呼びかけ＋依頼（「ケイ、論理パズル出して」）のときは、その人格の系統で 1 問出す近道を先頭に置く
  const offer: LeaderAction[] =
    opts.offerQuiz && r.agent !== "LEADER"
      ? [{ type: "postback", label: "LINEで1問", data: `action=quiz&domain=${r.agent}`, displayText: `${DOMAIN_META[r.agent].label}で1問` }]
      : opts.offerQuiz
        ? [{ type: "postback", label: "LINEで1問", data: "action=today", displayText: "今日の学習" }]
        : [];
  const merged = [...offer, ...suggest, ...quick].filter((a, i, arr) => arr.findIndex((b) => b.label === a.label) === i);
  // 人格の返答はキャラの吹き出し（Flex）で。text にも「名前: 本文」を残す（ログ・フォールバック用）
  const body = r.text.startsWith(`${name}: `) ? r.text.slice(name.length + 2) : r.text;
  void text;
  return agentReply(r.agent, name, body, { appUrl, quickReplies: merged.slice(0, 13), suggestedDomain: r.suggestDomain ?? undefined });
}

/** 「〜に聞く」を押した直後の案内（次の発話をその人格宛てにする） */
export function askPrompt(agent: AgentKey, name: string): LeaderReply {
  const what = agent === "LEADER" ? "今日なにをやるか、迷っていることを" : `${DOMAIN_META[agent].label} について気になることを`;
  return { text: `${name}: 呼んだ？ ${what}そのまま送って。` };
}
