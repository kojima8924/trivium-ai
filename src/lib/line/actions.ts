// LINE 返信で繰り返し使う定型（Quick Reply のボタン・定型文・URL）。
// handlers.ts / quiz.ts から参照して、文言や postback data を 1 か所で管理する。
import { env } from "@/lib/env";
import { dashboardUrl } from "./urls";
import type { LeaderAction, LeaderReply } from "./types";

/** Web アプリの公開 URL（末尾スラッシュなし） */
export function appUrlBase(): string {
  return env.appUrl.replace(/\/$/, "");
}

/** 「今日の学習」（案内役が系統を選んで LINE で 1 問） */
export const TODAY_ACTION: LeaderAction = { type: "postback", label: "今日の学習", data: "action=today", displayText: "今日の学習" };

export function dashboardAction(label = "Dashboard"): LeaderAction {
  return { type: "uri", label, uri: dashboardUrl(appUrlBase()) };
}

/** 古い出題のボタン（pendingTask と一致しない）を押したときの返信 */
export function staleTaskReply(withDashboard = false): LeaderReply {
  return {
    text: "その問題は終わっています。「今日の学習」で新しい問題を出します。",
    quickReplies: withDashboard ? [TODAY_ACTION, dashboardAction()] : [TODAY_ACTION],
  };
}

/** 出題中の課題が無いときにテキストで「パス」と言われたときの返信 */
export function noPendingTaskReply(): LeaderReply {
  return { text: "いま出題中の問題はありません。「今日の学習」で 1 問出します。", quickReplies: [TODAY_ACTION] };
}
