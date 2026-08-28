// LINE の出題まわりの「見た目」を作る部分（メッセージ本文・Quick Reply のボタン）。
// prisma / service を呼ばない純粋関数だけを置く。フロー（出題・採点・作問）は quiz.ts。
import { DOMAIN_META } from "@/lib/domain";
import type { Task } from "@/lib/tasks";
import type { AgentKey } from "@/lib/persona";
import { formatScore } from "@/lib/scoring";
import { agentReply } from "./flex";
import { appUrlBase, dashboardAction } from "./actions";
import { learnUrl } from "./urls";
import type { LeaderAction, LeaderReply } from "./types";

export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** 未連携のときの案内（出題はしない＝記録が付かないため） */
export function needLinkReply(): LeaderReply {
  return {
    text: "LINE で解いた結果を記録に残すには、Web アカウントとの連携が必要です。\n「連携」と送ると、15 分有効のリンクが届きます。",
    quickReplies: [
      { type: "postback", label: "連携する", data: "action=link", displayText: "連携" },
      dashboardAction("Webで解く"),
    ],
  };
}

export function choiceActions(task: Task): LeaderAction[] {
  const choices = task.choices ?? [];
  return choices.map((c, i) => ({
    type: "postback" as const,
    label: `${LETTERS[i]}: ${c}`.slice(0, 20),
    data: `action=answer&task=${encodeURIComponent(task.id)}&choice=${i}`,
    // displayText は LINE の上限 300 字。生成課題の長い選択肢でも超えないように切る
    displayText: `${LETTERS[i]}. ${c}`.slice(0, 280),
  }));
}

/**
 * 出題中の課題に添えるボタン（Quick Reply は 13 個まで）。
 * 「1 問ずつ・ヒントは一段ずつ」という説明どおりに操作できるよう、ヒントを先頭に置く。
 *   💡 ヒント / パス / （解説を見て終える）/ Webで解く / A〜D
 */
export function taskActions(task: Task, opts: { giveUp?: boolean } = {}): LeaderAction[] {
  const id = encodeURIComponent(task.id);
  return [
    { type: "postback", label: "💡 ヒント", data: `action=hint&task=${id}`, displayText: "ヒント" },
    { type: "postback", label: "パス", data: `action=pass&task=${id}`, displayText: "パス" },
    ...(opts.giveUp ? [{ type: "postback" as const, label: "解説を見て終える", data: `action=giveup&task=${id}`, displayText: "解説を見て終える" }] : []),
    { type: "uri", label: "Webで解く", uri: learnUrl(appUrlBase(), task.domain, task.id) },
    ...choiceActions(task),
  ];
}

/** 課題 → LINE の出題メッセージ（選択肢は Quick Reply。本文にも A〜D を列挙して全文が読めるようにする） */
export function quizReply(task: Task, personaName: string, preface?: string): LeaderReply {
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
    appUrl: appUrlBase(),
    footer: `下のボタンで答えてください。詰まったら「💡 ヒント」で一段ずつ（パスは記録に残りません）。質問はそのまま話しかければ ${personaName} が答えます`,
    quickReplies: taskActions(task),
  });
}

/** 出題中の課題へのヒント（担当キャラが think で一段だけ） */
export function hintReply(task: Task, personaName: string, r: { hint: string | null; hintCount: number; hintsRemaining: number }): LeaderReply {
  const body = r.hint
    ? [`💡 ヒント ${r.hintCount}/3`, r.hint, "", r.hintsRemaining > 0 ? `まだ足りなければ、もう一度「💡 ヒント」を押して。あと ${r.hintsRemaining} 回。` : "ヒントはこれで最後。下のボタンで答えてください。"].join("\n")
    : ["ヒントは使い切りました。", "答えを選ぶか、「解説を見て終える」か、「パス」（記録に残しません）を選んでください。"].join("\n");
  return agentReply(task.domain, personaName, body, {
    appUrl: appUrlBase(),
    mood: "think",
    // ヒントを押した後も続けて押せるようにする（3 段まで）
    quickReplies: taskActions(task, { giveUp: true }),
  });
}

/** 会話に渡す「いま出題中の課題」の要約（答えは含めない） */
export function taskContextFor(task: Task): string {
  const choices = (task.choices ?? []).map((c, i) => `${LETTERS[i]}. ${c}`).join("\n");
  return [`【${DOMAIN_META[task.domain].label}】${task.title}（難易度 ${task.difficulty}）`, task.passage ?? "", task.prompt, choices].filter(Boolean).join("\n").slice(0, 2500);
}

/** choice 以外（short / free）は Web で解いてもらう */
export function webTaskReply(task: Task, personaName: string): LeaderReply {
  const m = DOMAIN_META[task.domain];
  return agentReply(task.domain, personaName, `【${m.label}】${task.title}（難易度 ${task.difficulty}）\n\n${task.prompt}\n\nこの形式は Web で取り組みましょう。下のボタンから開けます。`, {
    appUrl: appUrlBase(),
    buttons: {
      title: `${m.label} — ${task.title}`.slice(0, 40),
      text: "Web で解く（記録に残ります）",
      actions: [{ type: "uri", label: "Web で解く", uri: learnUrl(appUrlBase(), task.domain, task.id) }],
    },
  });
}

export function scoreLine(before: number, after: number): string {
  const diff = Math.round((after - before) * 10) / 10;
  if (Math.abs(diff) < 0.05) return `${formatScore(before)}（変化なし）`;
  return `${formatScore(before)} → ${formatScore(after)}（${diff > 0 ? "+" : ""}${diff.toFixed(1)}）`;
}

export function stripName(text: string, name: string): string {
  return text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

export function todayActions(talkTo?: { agent: AgentKey; name: string }): LeaderAction[] {
  return [
    { type: "postback", label: "もう1問", data: "action=today", displayText: "もう1問" },
    // 会話できることを常に見せる（押すと次の 1 通がその人格との会話になる）
    ...(talkTo
      ? [{ type: "postback" as const, label: `${talkTo.name}と話す`, data: `action=ask&agent=${talkTo.agent}`, displayText: `${talkTo.name}と話す` }]
      : []),
    dashboardAction(),
  ];
}

/** 作問依頼を受けたときの即時返信（実際の生成は after() で） */
export function generatingReply(request: string): LeaderReply {
  return { text: `「${request.slice(0, 40)}」で作っています… 10 秒ほどお待ちください。` };
}
