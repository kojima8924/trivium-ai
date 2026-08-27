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
import { generateTaskForUser, inferKind } from "@/lib/learn/generate";
import { loadPersonas, type AgentKey } from "@/lib/persona";
import type { Task } from "@/lib/tasks";
import { loadEvents } from "@/lib/profile";
import { computeXp, xpForEvent } from "@/lib/xp";
import { computeLevels, formatScore } from "@/lib/scoring";
import { ACHIEVEMENTS, TIER_LABEL } from "@/lib/achievement-defs";
import { XP, LINE } from "@/config/trivium.config";
import { agentReply, buildProfileFlex } from "./flex";
import type { messagingApi } from "@line/bot-sdk";
import { pickBalancedDomain, type LeaderAction, type LeaderReply } from "./leader";
import { activePreferredDifficulty, saveLineState, withPassedTask, withPendingTask, withPreferredDifficulty, type LineState } from "./state";

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
function quizReply(task: Task, personaName: string, preface?: string): LeaderReply {
  const m = DOMAIN_META[task.domain];
  const choices = (task.choices ?? []).map((c, i) => `${LETTERS[i]}. ${c}`).join("\n");
  const body = [
    preface ?? "",
    `【${m.label}】${task.title}（難易度 ${task.difficulty}）`,
    task.passage ? `\n${task.passage}` : "",
    `\n${task.prompt}`,
    choices ? `\n${choices}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");
  return agentReply(task.domain, personaName, body, {
    appUrl: appUrl(),
    footer: `下のボタンで答えてください（パスは記録に残りません）。分からないことは、そのまま話しかければ ${personaName} が答えます`,
    quickReplies: [
      { type: "postback", label: "パス", data: `action=pass&task=${encodeURIComponent(task.id)}`, displayText: "パス" },
      { type: "uri", label: "Webで解く", uri: learnUrl(task.domain, task.id) },
      ...choiceActions(task),
    ],
  });
}

/** choice 以外（short / free）は Web で解いてもらう */
function webTaskReply(task: Task, personaName: string): LeaderReply {
  const m = DOMAIN_META[task.domain];
  return agentReply(task.domain, personaName, `【${m.label}】${task.title}（難易度 ${task.difficulty}）\n\n${task.prompt}\n\nこの形式は Web で取り組みましょう。下のボタンから開けます。`, {
    appUrl: appUrl(),
    buttons: {
      title: `${m.label} — ${task.title}`.slice(0, 40),
      text: "Web で解く（記録に残ります）",
      actions: [{ type: "uri", label: "Web で解く", uri: learnUrl(task.domain, task.id) }],
    },
  });
}

/**
 * 出題の目標難易度を決める。
 *   difficulty（「難易度8」）: その値を使い、系統つきで state に記録する
 *   delta（「軽めに」= -2 / 「難しめ」= +2）: 推薦難易度 ± delta。指定難易度の文脈はリセット
 *   どちらも無し: 有効な難易度指定（同じ系統・3 時間以内）があればそれ、無ければ推薦（undefined）
 */
export async function resolveQuizTarget(
  userId: string,
  state: LineState,
  domain: DomainKey | null,
  opts: { difficulty?: number; delta?: number },
): Promise<{ domain: DomainKey; target: number | undefined; state: LineState }> {
  const d = domain ?? (await pickQuizDomain(userId, state));
  if (opts.difficulty !== undefined) {
    return { domain: d, target: opts.difficulty, state: withPreferredDifficulty(state, opts.difficulty, domain) };
  }
  if (opts.delta !== undefined) {
    const { targetDifficulty: rec } = await nextTask(userId, d, { kind: "choice", excludeTaskIds: state.passedTaskIds });
    const target = Math.min(10, Math.max(1, rec + opts.delta));
    return { domain: d, target, state: withPreferredDifficulty(state, undefined, null) };
  }
  return { domain: d, target: activePreferredDifficulty(state, d), state };
}

/**
 * 指定難易度 ±1 に未回答の選択式課題が用意されているか。
 * 無ければ呼び出し側が作問（generate）に切り替える（WRITE の選択式は難易度 3 までしか無い、など）。
 */
export async function staticQuizAvailable(
  userId: string,
  state: LineState,
  domain: DomainKey | null,
  difficulty: number,
): Promise<{ domain: DomainKey; available: boolean }> {
  const d = domain ?? (await pickQuizDomain(userId, state));
  const { task } = await nextTask(userId, d, { kind: "choice", targetDifficulty: difficulty, excludeTaskIds: state.passedTaskIds });
  const seen = await prisma.learningEvent.count({ where: { userId, taskId: task.id } });
  return { domain: d, available: seen === 0 && Math.abs(task.difficulty - difficulty) <= 1 };
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
  opts: { difficulty?: number; preface?: string } = {},
): Promise<LeaderReply> {
  const d = domain ?? (await pickQuizDomain(userId, state));
  // 本人が難易度を指定していれば（「難易度8」→「次」）、推薦ではなくその難易度を狙う（同じ系統・3 時間以内だけ）
  const targetDifficulty = opts.difficulty ?? activePreferredDifficulty(state, d);
  const [{ task }, personas] = await Promise.all([
    nextTask(userId, d, { kind: "choice", targetDifficulty, excludeTaskIds: state.passedTaskIds }),
    loadPersonas(userId),
  ]);
  console.log(`[line] quiz domain=${d} target=${targetDifficulty ?? "auto"} task=${task.id} d=${task.difficulty}`);
  await saveLineState(lineUserId, withPendingTask(state, { taskId: task.id, domain: d, sentAt: new Date().toISOString() }));
  return quizReply(task, personas[d].name, opts.preface);
}

type AnswerOutcome = {
  reply: LeaderReply;
  /** 決着したとき: after() で finalize してから push する内容を作るための情報 */
  settled: { domain: DomainKey; status: "success" | "failed" } | null;
};

function scoreLine(before: number, after: number): string {
  const diff = Math.round((after - before) * 10) / 10;
  if (Math.abs(diff) < 0.05) return `${formatScore(before)}（変化なし）`;
  return `${formatScore(before)} → ${formatScore(after)}（${diff > 0 ? "+" : ""}${diff.toFixed(1)}）`;
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
      reply: agentReply(task.domain, name, ["🔺 △ もう一度", stripName(result.feedback, name), result.hint ? `\nヒント ${result.hintCount}/3: ${result.hint}` : "", "\nもう一度選んでください。"].filter(Boolean).join("\n"), {
        appUrl: appUrl(),
        mood: "think",
        quickReplies: [
          { type: "postback", label: "パス", data: `action=pass&task=${encodeURIComponent(task.id)}`, displayText: "パス" },
          { type: "postback", label: "解説を見て終える", data: `action=giveup&task=${encodeURIComponent(task.id)}`, displayText: "解説を見て終える" },
          { type: "uri", label: "Webで解く", uri: learnUrl(task.domain, task.id) },
          ...choiceActions(task),
        ],
      }),
      settled: null,
    };
  }

  // 決着（success / failed）: pendingTask を消し、講評＋解説を返す。集計は after() で
  await saveLineState(lineUserId, withPendingTask(state, null));
  const head = result.status === "success" ? `⭕ ○ 正解（ヒント ${result.hintCount} 回）` : "❌ ✕ 今回は未達";
  return {
    reply: agentReply(task.domain, name, [head, stripName(result.feedback, name), `\n解説: ${result.explanation}`].join("\n"), {
      appUrl: appUrl(),
      mood: result.status === "success" ? "happy" : "sad",
      footer: "集計中…",
    }),
    settled: { domain: task.domain, status: result.status },
  };
}

/**
 * パス（postback action=pass）。記録は付けず、しばらく再出題しない。同じ系統・同じ難易度指定で次の 1 問を出す。
 */
export async function passQuiz(userId: string, lineUserId: string, state: LineState, taskId: string): Promise<LeaderReply> {
  const pending = state.pendingTask;
  const domain = pending?.domain ?? null;
  const next = withPendingTask(withPassedTask(state, taskId), null);
  await saveLineState(lineUserId, next);
  console.log(`[line] pass task=${taskId} domain=${domain ?? "-"}`);
  return startQuiz(userId, lineUserId, next, domain, { preface: "⏭ パス。次はこちら。" });
}

/** ギブアップ（postback action=giveup） */
export async function giveUpQuiz(userId: string, lineUserId: string, state: LineState, taskId: string): Promise<AnswerOutcome> {
  const task = await resolveTask(userId, taskId);
  if (!task) return { reply: { text: "この問題は見つかりませんでした。", quickReplies: todayActions() }, settled: null };
  const result = await submitAnswer(userId, taskId, { answer: "", giveUp: true, deferFinalize: true });
  if ("error" in result || result.status === "retry") return { reply: { text: "処理できませんでした。", quickReplies: todayActions() }, settled: null };
  await saveLineState(lineUserId, withPendingTask(state, null));
  return {
    reply: { text: [`❌ ✕ 今回はここまで。`, `解説: ${result.explanation}`, "\n（集計中…）"].join("\n") },
    settled: { domain: task.domain, status: "failed" },
  };
}

/** 決着後の再計算 → push 用メッセージ（after() の中で呼ぶ）。 */
export async function settleAndBuildPush(userId: string, domain: DomainKey): Promise<LeaderReply[]> {
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

  // 基本は「能力の変化 + XP」だけ。人格と案内役の寸評は commentEvery 問ごと（毎回は過剰）
  const levelLine =
    r.profile.levelAfter > r.profile.levelBefore
      ? `${m.label} Lv.${r.profile.levelBefore} → Lv.${r.profile.levelAfter} レベルアップ（${scoreLine(r.profile.before, r.profile.after)}）`
      : `${m.label} Lv.${r.profile.levelAfter}（${scoreLine(r.profile.before, r.profile.after)}）`;
  const withComment = events.length > 0 && events.length % LINE.commentEvery === 0;
  const lines = [levelLine, xpLine].filter(Boolean);
  const out: LeaderReply[] = [{ text: lines.join("\n") }];
  // 実績解除は目立つように、案内役（cheer）の独立した 1 通を先頭に置く
  if (r.newAchievements.length) {
    const ln = personas.LEADER.name;
    const body = ["🏅 実績解除！", ...r.newAchievements.map((k) => {
      const a = ACHIEVEMENTS[k];
      return a ? `${a.emoji} ${a.title}（${TIER_LABEL[a.tier]}）\n${a.description}` : k;
    })].join("\n");
    out.unshift(agentReply("LEADER", ln, body, { appUrl: appUrl(), mood: "cheer" }));
  }
  if (withComment) {
    // commentEvery 問ごとに、系統の人格と案内役がキャラの吹き出しで一言ずつ
    const dn = personas[domain].name;
    const up = r.profile.levelAfter > r.profile.levelBefore;
    if (r.profile.summary) out.push(agentReply(domain, dn, stripName(r.profile.summary, dn), { appUrl: appUrl(), mood: up ? "cheer" : "normal" }));
    if (r.leader) {
      const ln = personas.LEADER.name;
      const body = [stripName(r.leader.summary, ln), r.leader.recommendation ? `次のおすすめ: ${r.leader.recommendation}` : ""].filter(Boolean).join("\n");
      out.push(agentReply("LEADER", ln, body, { appUrl: appUrl(), mood: up ? "cheer" : "normal" }));
    }
  }
  // 最後の 1 通に「もう1問 / <担当>と話す / <案内役>と話す / Dashboard」
  const talk = withComment ? { agent: "LEADER" as AgentKey, name: personas.LEADER.name } : { agent: domain as AgentKey, name: personas[domain].name };
  out[out.length - 1] = { ...out[out.length - 1], quickReplies: todayActions(talk) };
  return out;
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

/** 講評の先頭に人格名が二重に付かないようにする（Mock は "名前: " を付けて返す） */
function stripName(text: string, name: string): string {
  return text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

function todayActions(talkTo?: { agent: AgentKey; name: string }): LeaderAction[] {
  return [
    { type: "postback", label: "もう1問", data: "action=today", displayText: "もう1問" },
    // 会話できることを常に見せる（押すと次の 1 通がその人格との会話になる）
    ...(talkTo
      ? [{ type: "postback" as const, label: `${talkTo.name}と話す`, data: `action=ask&agent=${talkTo.agent}`, displayText: `${talkTo.name}と話す` }]
      : []),
    { type: "uri", label: "Dashboard", uri: `${appUrl()}/dashboard` },
  ];
}

/** 作問依頼を受けたときの即時返信（実際の生成は after() で） */
export function generatingReply(request: string): LeaderReply {
  return { text: `「${request.slice(0, 40)}」で作っています… 10 秒ほどお待ちください。` };
}

/** 作問して push 用メッセージを作る（after() の中で呼ぶ）。choice なら LINE で解ける形、他は Web へ */
export async function generateAndBuildPush(
  userId: string,
  lineUserId: string,
  state: LineState,
  request: string,
  opts: { domain?: DomainKey | null; difficulty?: number } = {},
): Promise<LeaderReply> {
  try {
    // 難易度指定つきの依頼（「codeで難易度8」）は LINE で解ける選択式にする（「記述で」などの明示があれば従う）
    const kind = opts.difficulty !== undefined ? inferKind(request, "choice") : undefined;
    const { task, domain } = await generateTaskForUser(userId, {
      request,
      domain: opts.domain ?? undefined,
      difficulty: opts.difficulty,
      kind,
    });
    console.log(`[line] generated domain=${domain} difficulty=${task.difficulty} kind=${task.kind} task=${task.id}`);
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
