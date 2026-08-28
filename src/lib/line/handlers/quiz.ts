// 出題まわりのハンドラ（出題・作問・ヒント・パス・回答/ギブアップ）。
// 時間のかかる処理（作問・決着後の集計）は先に受け付けを返し、after() で push する。
import "server-only";
import { rateLimit } from "@/lib/http";
import { requestHint, resolveTask } from "@/lib/learn/service";
import { notifyDailyDigestIfComplete } from "@/lib/learn/digest";
import type { DomainKey } from "@/lib/domain";
import { loadPersonas } from "@/lib/persona";
import { TODAY_ACTION, appUrlBase, noPendingTaskReply, staleTaskReply } from "../actions";
import { pushTo, replyTo } from "../push";
import {
  answerQuiz,
  generateAndBuildPush,
  generatingReply,
  giveUpQuiz,
  hintReply,
  passQuiz,
  planQuiz,
  settleAndBuildPush,
  startQuiz,
  type QuizPlan,
} from "../quiz";
import { loadLineUser, saveLineState, withPendingTask, withPreferredDifficulty, type LineState } from "../state";
import { GENERATE_LIMIT, requireLinked, warn, type AfterScheduler, type LineUser } from "./shared";

/**
 * 出題中の課題のヒントを 1 段出す（担当キャラ）。記録はヒント回数だけ。
 * テキストの「ヒント」と、出題メッセージの「💡 ヒント」ボタン（taskId 付き）の両方から呼ばれる。
 */
export async function handleHint(lineUserId: string, replyToken: string, lu: LineUser, taskId?: string): Promise<void> {
  const pending = lu.state.pendingTask;
  if (!lu.userId || !pending) {
    await replyTo(replyToken, noPendingTaskReply());
    return;
  }
  // 古い出題のボタンを押した場合は受け付けない（回答・パスと同じ扱い）
  if (taskId && pending.taskId !== taskId) {
    await replyTo(replyToken, staleTaskReply());
    return;
  }
  const [task, r, personas] = await Promise.all([resolveTask(lu.userId, pending.taskId), requestHint(lu.userId, pending.taskId), loadPersonas(lu.userId)]);
  if (!task || !r) {
    await replyTo(replyToken, noPendingTaskReply());
    return;
  }
  console.log(`[line] hint task=${task.id} count=${r.hintCount}`);
  await replyTo(replyToken, hintReply(task, personas[task.domain].name, r));
}

/** LINE 上の選択式出題（planQuiz で系統・難易度・在庫を決め、無ければ作問に切り替える）。 */
export async function handleQuiz(
  lineUserId: string,
  replyToken: string,
  lu: LineUser,
  opts: { domain: DomainKey | null; difficulty?: number; delta?: number; taskType?: string; scheduleAfter: AfterScheduler },
): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  const plan = await planQuiz(userId, lu.state, { domain: opts.domain, difficulty: opts.difficulty, delta: opts.delta, taskType: opts.taskType });
  await runQuizPlan(lineUserId, replyToken, { ...lu, userId }, plan, opts.scheduleAfter);
}

/** planQuiz の結果を実行する（出題 or 作問） */
async function runQuizPlan(
  lineUserId: string,
  replyToken: string,
  lu: LineUser & { userId: string },
  plan: QuizPlan,
  scheduleAfter: AfterScheduler,
): Promise<void> {
  if (plan.state !== lu.state) await saveLineState(lineUserId, plan.state);
  if (plan.kind === "generate") {
    // 指定難易度の近くに用意済みの課題が無い → その難易度で作問（文脈を無視した易しい出題を防ぐ）
    await handleGenerate(lineUserId, replyToken, { ...lu, state: plan.state }, plan.request, scheduleAfter, { domain: plan.domain, difficulty: plan.difficulty });
    return;
  }
  const reply = await startQuiz(lu.userId, lineUserId, plan.state, plan.domain, { difficulty: plan.target, preface: plan.preface, taskType: plan.taskType });
  await replyTo(replyToken, reply);
}

/** 自由文の作問依頼。即時返信後に生成し、push で届ける。 */
export async function handleGenerate(
  lineUserId: string,
  replyToken: string,
  lu: LineUser,
  request: string,
  scheduleAfter: AfterScheduler,
  opts: { domain?: DomainKey | null; difficulty?: number } = {},
): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  // 難易度指定は文脈として保存（以後の「次」「もう1問」もその難易度で出す。同じ系統・3 時間以内だけ）
  const state: LineState = opts.difficulty !== undefined ? withPreferredDifficulty(lu.state, opts.difficulty, opts.domain ?? null) : lu.state;
  if (state !== lu.state) await saveLineState(lineUserId, state);
  if (rateLimit(`line-generate:${userId}`, GENERATE_LIMIT.count, GENERATE_LIMIT.windowMs)) {
    await replyTo(replyToken, {
      text: "作問はしばらくお休み（10 分に 6 問まで）。用意してある問題なら今すぐ出せます。",
      quickReplies: [TODAY_ACTION],
    }).catch(warn("reply failed"));
    return;
  }
  // reply が失敗（token 失効など）しても作問は続け、push で届ける
  await replyTo(replyToken, generatingReply(request)).catch(warn("reply failed"));
  scheduleAfter(async () => {
    try {
      const reply = await generateAndBuildPush(userId, lineUserId, state, request, opts);
      await pushTo(lineUserId, reply).catch(warn("push failed"));
    } catch (err) {
      warn("generate failed")(err);
      await pushTo(lineUserId, { text: "今回は作れませんでした。通常の出題なら下のボタンからどうぞ。", quickReplies: [TODAY_ACTION] }).catch(() => undefined);
    }
  });
}

/** パス: 出題中の課題と一致するときだけ受け付け、記録せずに次の 1 問を出す */
export async function handlePass(lineUserId: string, replyToken: string, lu: LineUser, taskId: string, scheduleAfter: AfterScheduler): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  const pending = lu.state.pendingTask;
  if (!pending) {
    await replyTo(replyToken, noPendingTaskReply());
    return;
  }
  if (pending.taskId !== taskId) {
    await replyTo(replyToken, staleTaskReply());
    return;
  }
  const plan = await passQuiz(userId, lineUserId, lu.state, taskId);
  await runQuizPlan(lineUserId, replyToken, { ...lu, userId, state: plan.state }, plan, scheduleAfter);
}

/** 回答・ギブアップ。決着返信の後に集計し、push する順序を守る。 */
export async function handleAnswer(
  lineUserId: string,
  replyToken: string,
  lu: LineUser,
  action: "answer" | "giveup",
  params: URLSearchParams,
  scheduleAfter: AfterScheduler,
): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  const taskId = params.get("task") ?? "";
  const choice = Number(params.get("choice") ?? "-1");

  // 出題中の問題（pendingTask）と一致しない回答は、古い出題のボタンなので受け付けない
  const pending = lu.state.pendingTask;
  if (!pending || pending.taskId !== taskId) {
    await replyTo(replyToken, staleTaskReply(true));
    return;
  }
  // choice は選択肢の index（整数）だけ受け付ける（範囲は answerQuiz が課題を見て確認する）
  if (action === "answer" && !Number.isInteger(choice)) {
    await replyTo(replyToken, staleTaskReply());
    return;
  }

  const outcome =
    action === "giveup"
      ? await giveUpQuiz(userId, lineUserId, lu.state, taskId)
      : await answerQuiz(userId, lineUserId, lu.state, taskId, choice);

  // reply が失敗しても決着後の集計は必ず回す（記録は既に付いている）
  await replyTo(replyToken, outcome.reply).catch(warn("reply failed"));
  if (!outcome.settled) return;
  const { domain } = outcome.settled;
  scheduleAfter(async () => {
    try {
      const replies = await settleAndBuildPush(userId, domain);
      for (const reply of replies) {
        await pushTo(lineUserId, reply).catch(warn("push failed"));
      }
      // 今日の 3 問がそろった瞬間のミッション Flex は日次総評（digest）に一本化する（二重送信を避ける）
      await notifyDailyDigestIfComplete(userId);
    } catch (err) {
      warn("settle failed")(err);
      // 記録は付いているので、集計だけ失敗したことを伝えて Dashboard へ誘導する。
      // state は受付時のものではなく読み直してから pendingTask だけ外す（その間の難易度指定・パス履歴を消さない）
      await loadLineUser(lineUserId)
        .then((fresh) => saveLineState(lineUserId, withPendingTask(fresh.state, null)))
        .catch(() => undefined);
      await pushTo(lineUserId, {
        text: "集計に失敗しました。記録は保存されています。Dashboard で確認してください。",
        buttons: {
          title: "集計に失敗",
          text: "Dashboard で確認できます",
          actions: [{ type: "uri", label: "Dashboard を開く", uri: `${appUrlBase()}/dashboard` }],
        },
      }).catch(() => undefined);
    }
  });
}
