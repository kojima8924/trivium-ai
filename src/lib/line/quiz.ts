// LINE 上の出題・回答・作問（server-only）。
//   - 出題は選択式のみ（Quick Reply で A〜D をタップ）。採点は決定論、講評はキャッシュ → 即答
//   - 回答の決着後は先に返信し、profile / Leader の再計算は after() で回して結果を push する
//   - 作問（自由文）は 7〜8 秒かかるので「作っています…」を返してから push
// 記録を付けるには Web アカウントと連携済み（LineUser.userId）であることが必要。
import "server-only";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";
import { nextTask, resolveTask, submitAnswer, finalize } from "@/lib/learn/service";
import { generateTaskForUser } from "@/lib/learn/generate";
import { loadPersonas } from "@/lib/persona";
import type { Task } from "@/lib/tasks";
import { loadEvents } from "@/lib/profile";
import { computeXp, xpForEvent } from "@/lib/xp";
import { computeLevels } from "@/lib/scoring";
import { XP } from "@/config/trivium.config";
import { buildProfileFlex } from "./flex";
import type { messagingApi } from "@line/bot-sdk";
import { pickBalancedDomain, type LeaderAction, type LeaderReply } from "./leader";
import { saveLineState, withPendingTask, type LineState } from "./state";

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

function appUrl(): string {
  return env.appUrl.replace(/\/$/, "");
}

function learnUrl(domain: DomainKey, taskId?: string): string {
  const base = `${appUrl()}${DOMAIN_META[domain].path}`;
  return taskId ? `${base}?task=${encodeURIComponent(taskId)}` : base;
}

/** 未連携のときの案内（出題はしない＝記録が付かないため） */
export function needLinkReply(): LeaderReply {
  return {
    text: "LINE で解いた結果を記録に残すには、Web アカウントとの連携が必要です。\n「連携」と送ると、15 分有効のリンクが届きます。",
    quickReplies: [
      { type: "postback", label: "連携する", data: "action=link", displayText: "連携" },
      { type: "uri", label: "Webで解く", uri: `${appUrl()}/dashboard` },
    ],
  };
}

/** 出題する domain を決める（Leader の推薦 → LINE 側のバランス） */
async function pickQuizDomain(userId: string, state: LineState): Promise<DomainKey> {
  const lp = await prisma.leaderProfile.findUnique({ where: { userId }, select: { preferences: true } });
  const prefs = (lp?.preferences ?? {}) as Record<string, unknown>;
  const rd = typeof prefs.recommendedDomain === "string" ? prefs.recommendedDomain : "";
  if ((DOMAINS as readonly string[]).includes(rd)) return rd as DomainKey;
  return pickBalancedDomain(state).domain;
}

function choiceActions(task: Task): LeaderAction[] {
  const choices = task.choices ?? [];
  return choices.map((c, i) => ({
    type: "postback" as const,
    label: `${LETTERS[i]}: ${c}`.slice(0, 20),
    data: `action=answer&task=${encodeURIComponent(task.id)}&choice=${i}`,
    // displayText は LINE の上限 300 字。生成課題の長い選択肢でも超えないように切る
    displayText: `${LETTERS[i]}. ${c}`.slice(0, 280),
  }));
}

/** 課題 → LINE の出題メッセージ（選択肢は Quick Reply。本文にも A〜D を列挙して全文が読めるようにする） */
function quizReply(task: Task, personaName: string): LeaderReply {
  const m = DOMAIN_META[task.domain];
  const choices = (task.choices ?? []).map((c, i) => `${LETTERS[i]}. ${c}`).join("\n");
  const text = [
    `【${m.label}】${task.title}（難易度 ${task.difficulty}）`,
    task.passage ? `\n${task.passage}` : "",
    `\n${task.prompt}`,
    choices ? `\n${choices}` : "",
    `\n— ${personaName}: 下のボタンで答えてください。`,
  ]
    .filter((s) => s !== "")
    .join("\n");
  return {
    text,
    quickReplies: [
      ...choiceActions(task),
      { type: "uri", label: "Webで解く", uri: learnUrl(task.domain, task.id) },
    ],
  };
}

/** choice 以外（short / free）は Web で解いてもらう */
function webTaskReply(task: Task, personaName: string): LeaderReply {
  const m = DOMAIN_META[task.domain];
  return {
    text: `【${m.label}】${task.title}（難易度 ${task.difficulty}）\n\n${task.prompt}\n\n— ${personaName}: この形式は Web で取り組みましょう。下のボタンから開けます。`,
    buttons: {
      title: `${m.label} — ${task.title}`.slice(0, 40),
      text: "Web で解く（記録に残ります）",
      actions: [{ type: "uri", label: "Web で解く", uri: learnUrl(task.domain, task.id) }],
    },
  };
}

/**
 * 出題。連携済みユーザー向け。domain 未指定なら Leader の推薦から選ぶ。
 * state に pendingTask を保存する。
 */
export async function startQuiz(
  userId: string,
  lineUserId: string,
  state: LineState,
  domain: DomainKey | null,
): Promise<LeaderReply> {
  const d = domain ?? (await pickQuizDomain(userId, state));
  const [{ task }, personas] = await Promise.all([nextTask(userId, d, { kind: "choice" }), loadPersonas(userId)]);
  await saveLineState(lineUserId, withPendingTask(state, { taskId: task.id, domain: d, sentAt: new Date().toISOString() }));
  return quizReply(task, personas[d].name);
}

type AnswerOutcome = {
  reply: LeaderReply;
  /** 決着したとき: after() で finalize してから push する内容を作るための情報 */
  settled: { domain: DomainKey; status: "success" | "failed" } | null;
};

function scoreLine(before: number, after: number): string {
  if (after === before) return `${before}（変化なし）`;
  return `${before} → ${after}（${after > before ? "+" : ""}${after - before}）`;
}

/** 回答（postback action=answer）を処理する。返信内容と、決着時の後処理情報を返す */
export async function answerQuiz(
  userId: string,
  lineUserId: string,
  state: LineState,
  taskId: string,
  choice: number,
): Promise<AnswerOutcome> {
  const task = await resolveTask(userId, taskId);
  if (!task) {
    return { reply: { text: "この問題は見つかりませんでした。「今日の学習」からもう一度どうぞ。", quickReplies: todayActions() }, settled: null };
  }
  const personas = await loadPersonas(userId);
  const name = personas[task.domain].name;
  const result = await submitAnswer(userId, taskId, { answer: String(choice), deferFinalize: true });
  if ("error" in result) {
    return { reply: { text: "この問題は見つかりませんでした。", quickReplies: todayActions() }, settled: null };
  }

  if (result.status === "retry") {
    return {
      reply: {
        text: [
          `${name}: ${stripName(result.feedback, name)}`,
          result.hint ? `\nヒント ${result.hintCount}/3: ${result.hint}` : "",
          `\nもう一度選んでください。`,
        ]
          .filter(Boolean)
          .join("\n"),
        quickReplies: [...choiceActions(task), { type: "postback", label: "解説を見て終える", data: `action=giveup&task=${encodeURIComponent(task.id)}`, displayText: "解説を見て終える" }],
      },
      settled: null,
    };
  }

  // 決着（success / failed）: pendingTask を消し、講評＋解説を返す。集計は after() で
  await saveLineState(lineUserId, withPendingTask(state, null));
  const head = result.status === "success" ? `正解（ヒント ${result.hintCount} 回）` : "今回は未達";
  return {
    reply: {
      text: [`${head}`, `${name}: ${stripName(result.feedback, name)}`, `\n解説: ${result.explanation}`, "\n（集計中… 数秒後に結果を送ります）"].join("\n"),
    },
    settled: { domain: task.domain, status: result.status },
  };
}

/** ギブアップ（postback action=giveup） */
export async function giveUpQuiz(userId: string, lineUserId: string, state: LineState, taskId: string): Promise<AnswerOutcome> {
  const task = await resolveTask(userId, taskId);
  if (!task) return { reply: { text: "この問題は見つかりませんでした。", quickReplies: todayActions() }, settled: null };
  const result = await submitAnswer(userId, taskId, { answer: "", giveUp: true, deferFinalize: true });
  if ("error" in result || result.status === "retry") return { reply: { text: "処理できませんでした。", quickReplies: todayActions() }, settled: null };
  await saveLineState(lineUserId, withPendingTask(state, null));
  return {
    reply: { text: [`今回はここまで。`, `解説: ${result.explanation}`, "\n（集計中… 数秒後に結果を送ります）"].join("\n") },
    settled: { domain: task.domain, status: "failed" },
  };
}

/** 決着後の再計算 → push 用メッセージ（after() の中で呼ぶ）。 */
export async function settleAndBuildPush(userId: string, domain: DomainKey): Promise<LeaderReply> {
  // 決着前の状態（この 1 件を除いた集計）をミッション達成の判定に使う
  const now = new Date();
  const eventsBefore = await loadEvents(userId);
  const xpBefore = computeXp(eventsBefore.slice(0, -1), now);

  const r = await finalize(userId, domain);
  const personas = await loadPersonas(userId);
  const m = DOMAIN_META[domain];

  // XP（決定論）: 直近 1 件の獲得と合計
  const events = await loadEvents(userId);
  const last = events[events.length - 1];
  const xp = computeXp(events, now);
  const earnedTask = last ? xpForEvent(last).total : 0;
  const missionJustDone = xp.missionToday && !xpBefore.missionToday;
  const streakBonus = Math.max(
    0,
    Math.min(XP.streakBonusMax, xp.streak * XP.streakBonusPerDay) - Math.min(XP.streakBonusMax, xpBefore.streak * XP.streakBonusPerDay),
  );
  const bonus = missionJustDone ? XP.dailyMissionBonus : 0;
  const xpLine = `+${earnedTask + bonus + streakBonus} XP（課題 ${earnedTask}${bonus ? ` / ミッション +${bonus}` : ""}${streakBonus > 0 ? ` / 連続 +${streakBonus}` : ""}）→ 合計 ${xp.total} XP・${xp.rank.title}`;

  const lines = [
    `${m.label} ${scoreLine(r.profile.before, r.profile.after)}`,
    xpLine,
    r.profile.summary ? `${personas[domain].name}: ${stripName(r.profile.summary, personas[domain].name)}` : "",
    r.leader ? `\n${personas.LEADER.name}: ${stripName(r.leader.summary, personas.LEADER.name)}` : "",
    r.leader?.recommendation ? `次のおすすめ: ${r.leader.recommendation}` : "",
    r.newAchievements.length ? `\n🏅 ${r.newAchievements.map(achievementLabel).join("、")}` : "",
  ].filter(Boolean);

  return { text: lines.join("\n"), quickReplies: todayActions() };
}

const AXIS_KEY = { READ: "read", WRITE: "write", CODE: "code" } as const;

/** 「プロフィール」用の Flex カード（XP・到達レベル・今日のミッション）。webhook の action=profile から呼ぶ */
export async function buildProfileCard(userId: string, displayName: string): Promise<messagingApi.FlexBubble> {
  const now = new Date();
  const events = await loadEvents(userId);
  const levels = computeLevels(events, now);
  const xp = computeXp(events, now);
  const profiles = await prisma.domainProfile.findMany({ where: { userId }, select: { domain: true, score: true, evidenceCount: true } });
  const domains = DOMAINS.map((d) => {
    const p = profiles.find((x) => x.domain === d);
    return { domain: d, score: p?.score ?? 0, level: levels[AXIS_KEY[d]].level, evidenceCount: p?.evidenceCount ?? 0 };
  });
  return buildProfileFlex({ name: displayName, xp, domains, dashboardUrl: `${appUrl()}/dashboard` });
}

function achievementLabel(key: string): string {
  const map: Record<string, string> = {
    first_step: "最初の一歩",
    no_hint: "ノーヒント",
    comeback: "立て直し",
    trivium: "TRIVIUM",
    ten_events: "継続",
    hard_clear: "高難度クリア",
  };
  return map[key] ?? key;
}

/** 講評の先頭に人格名が二重に付かないようにする（Mock は "名前: " を付けて返す） */
function stripName(text: string, name: string): string {
  return text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

function todayActions(): LeaderAction[] {
  return [
    { type: "postback", label: "もう1問", data: "action=today", displayText: "もう1問" },
    { type: "uri", label: "Dashboard", uri: `${appUrl()}/dashboard` },
  ];
}

/** 作問依頼を受けたときの即時返信（実際の生成は after() で） */
export function generatingReply(request: string): LeaderReply {
  return { text: `「${request.slice(0, 40)}」で作っています… 10 秒ほどお待ちください。` };
}

/** 作問して push 用メッセージを作る（after() の中で呼ぶ）。choice なら LINE で解ける形、他は Web へ */
export async function generateAndBuildPush(userId: string, lineUserId: string, state: LineState, request: string): Promise<LeaderReply> {
  try {
    const { task, domain } = await generateTaskForUser(userId, { request });
    const personas = await loadPersonas(userId);
    if (task.kind === "choice" && (task.choices?.length ?? 0) >= 2) {
      await saveLineState(lineUserId, withPendingTask(state, { taskId: task.id, domain, sentAt: new Date().toISOString() }));
      return quizReply(task, personas[domain].name);
    }
    return webTaskReply(task, personas[domain].name);
  } catch (err) {
    console.warn("[line] generate failed:", (err as Error).message);
    return {
      text: "今回は作れませんでした。通常の出題なら下のボタンからどうぞ。",
      quickReplies: todayActions(),
    };
  }
}
