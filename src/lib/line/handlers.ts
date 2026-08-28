// LINE webhook の意図別ハンドラ（server-only）。HTTP 契約と署名検証は route.ts が担当する。
//
// テキストの振り分けは handlers.pure.ts の routeMessage（純粋関数）で決める:
//   (0) 人格の名前での呼びかけ → その人格との会話
//   (1) link / help / unlink（unlink は確認ボタン）
//   (2) 直前に「〜と話す」を押していた（30 分以内） → その人格との会話。短いコマンドはコマンド優先
//   (3) quiz / generate / pass
//   (4) その他の既知の意図 → 未連携、または短いコマンドならルールベース
//   (5) 残り → 連携済みなら案内役（LEADER）との会話、未連携はルールベース（連携案内つき）
import "server-only";
import { LINE } from "@/config/trivium.config";
import type { webhook } from "@line/bot-sdk";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/http";
import { learningAI } from "@/lib/ai";
import { requestHint, resolveTask } from "@/lib/learn/service";
import { notifyDailyDigestIfComplete } from "@/lib/learn/digest";
import { parseDomain, type DomainKey } from "@/lib/domain";
import { AGENTS, loadPersonas, type AgentKey } from "@/lib/persona";
import { detectAddressedAgent } from "@/lib/persona.pure";
import { TODAY_ACTION, appUrlBase, noPendingTaskReply, staleTaskReply } from "./actions";
import { agentQuickReplies, askPrompt, chatReply, chatWithAgent } from "./chat";
import { intentFromGuess, routeMessage } from "./handlers.pure";
import { handleMaterials } from "./materials";
import {
  buildPostbackReply,
  buildReply,
  classifyIntent,
  confirmUnlinkReply,
  domainOf,
  welcomeReply,
  type Intent,
  type LeaderContext,
  type LeaderReply,
} from "./leader";
import { issueLinkToken, unlinkLineUser } from "./link";
import { pushTo, replyFlex, replyTo } from "./push";
import {
  answerQuiz,
  buildProfileCard,
  generateAndBuildPush,
  generatingReply,
  giveUpQuiz,
  needLinkReply,
  passQuiz,
  planQuiz,
  settleAndBuildPush,
  startQuiz,
  type QuizPlan,
  hintReply,
  taskContextFor,
} from "./quiz";
import {
  askedAgentOf,
  loadLineUser,
  noteSuggestion,
  saveLineState,
  withAskNote,
  withPendingTask,
  withPreferredDifficulty,
  withoutNote,
  type LineState,
} from "./state";

type LineUser = Awaited<ReturnType<typeof loadLineUser>>;
type AfterScheduler = (task: () => void | Promise<void>) => void;

/** LINE 経由の LLM 呼び出しの利用者単位の上限（Web API の制限を迂回させない） */
const CHAT_LIMIT = { count: 20, windowMs: 10 * 60_000 };
const GENERATE_LIMIT = { count: 6, windowMs: 10 * 60_000 };

const warn = (label: string) => (err: unknown) => console.warn(`[line] ${label}:`, (err as Error).message);

/** 検証済みイベントを種類ごとのハンドラへ振り分ける。 */
export async function handleLineEvent(event: webhook.Event, scheduleAfter: AfterScheduler): Promise<void> {
  const lineUserId = event.source?.type === "user" ? event.source.userId : undefined;
  if (!lineUserId) return; // グループ/ルームは対象外

  if (event.type === "follow") {
    const lu = await loadLineUser(lineUserId);
    await replyTo(event.replyToken, welcomeReply(await contextFor(lu)));
    return;
  }
  if (event.type === "message") {
    if (event.message.type !== "text" || !event.replyToken) return;
    await handleMessage(lineUserId, event.replyToken, event.message.text, scheduleAfter);
    return;
  }
  if (event.type === "postback") {
    if (!event.replyToken) return;
    await handlePostback(lineUserId, event.replyToken, event.postback.data, scheduleAfter);
  }
  // それ以外（unfollow 等）は無視
}

/** 未連携なら案内を返して null（出題・記録には連携が必要） */
async function requireLinked(lu: LineUser, replyToken: string): Promise<string | null> {
  if (lu.userId) return lu.userId;
  await replyTo(replyToken, needLinkReply());
  return null;
}

async function handleMessage(lineUserId: string, replyToken: string, text: string, scheduleAfter: AfterScheduler): Promise<void> {
  const lu = await loadLineUser(lineUserId);
  let intent: Intent = classifyIntent(text);
  const linked = Boolean(lu.userId);
  const addressed = lu.userId ? detectAddressedAgent(text, await loadPersonas(lu.userId)) : null;
  const askedRaw = askedAgentOf(lu.state);
  const askedAgent: AgentKey | null = askedRaw && (AGENTS as readonly string[]).includes(askedRaw) ? (askedRaw as AgentKey) : null;
  const pendingDomain = lu.state.pendingTask?.domain ?? null;
  // 意図判定は LLM を主にする（明示語ではなく意味で分岐。ai-chatbot-system の分類→エスカレーションと同じ考え方）。
  // 正規表現は「パス」「ヒント」「連携」「使い方」などの短い定型コマンドの補助。LLM が失敗・低確信なら正規表現の結果 → 会話へ
  const EXACT_COMMANDS = new Set(["pass", "hint", "link", "unlink", "help"]);
  if (linked && !addressed && learningAI.classifyLineIntent && text.trim().length >= 2 && !EXACT_COMMANDS.has(intent.kind)) {
    const personas = await loadPersonas(lu.userId!);
    const guess = await withTimeout(
      learningAI.classifyLineIntent({ text, linked, pendingTask: Boolean(pendingDomain), personaNames: (["READ", "WRITE", "CODE", "LEADER"] as const).map((a) => personas[a].name) }),
      4000,
    ).catch(() => null);
    const mapped = intentFromGuess(guess, text);
    if (mapped) {
      console.log(`[line] ai-intent ${guess?.kind} (${guess?.confidence?.toFixed(2)}) -> ${mapped.kind} (regex: ${intent.kind})`);
      intent = mapped;
    } else if (guess?.kind === "chat" && guess.confidence >= 0.7 && intent.kind !== "unknown") {
      // 正規表現が拾った語（「読む」「今日」など）が会話の一部だった場合は会話に戻す
      console.log(`[line] ai-intent chat overrides regex ${intent.kind}`);
      intent = { kind: "unknown" };
    }
  }
  const route = routeMessage({ intent, linked, addressed, askedAgent, isShort: text.trim().length <= LINE.commandMaxChars || intent.kind !== "unknown", pendingDomain });
  console.log(`[line] message user=${lineUserId.slice(-6)} linked=${linked} intent=${intent.kind} route=${route.route} len=${text.length}`);

  // 「〜と話す」のメモは、会話に使ったら消す。コマンドを優先したときも消す（次のテキストが横取りされないように）
  if (lu.state.note?.startsWith("ask:") && (route.route !== "chat" || route.consumeAsk)) {
    lu.state = withoutNote(lu.state);
    await saveLineState(lineUserId, lu.state);
  }

  switch (route.route) {
    case "chat":
      await handleChat(lineUserId, replyToken, text, lu.userId!, route.agent, scheduleAfter, {
        offerQuiz: route.offerQuiz,
        pendingTaskId: route.taskHelp ? lu.state.pendingTask?.taskId : undefined,
      });
      return;
    case "hint":
      await handleHint(lineUserId, replyToken, lu);
      return;
    case "unlink_confirm":
      await replyTo(replyToken, confirmUnlinkReply(await contextFor(lu)));
      return;
    case "quiz":
      if (intent.kind === "quiz") {
        await handleQuiz(lineUserId, replyToken, lu, { domain: intent.domain, difficulty: intent.difficulty, delta: intent.difficultyDelta, taskType: intent.taskType, scheduleAfter });
      }
      return;
    case "generate":
      if (intent.kind === "generate") {
        await handleGenerate(lineUserId, replyToken, lu, intent.request, scheduleAfter, { domain: intent.domain, difficulty: intent.difficulty });
      }
      return;
    case "pass":
      await handlePass(lineUserId, replyToken, lu, lu.state.pendingTask?.taskId ?? "", scheduleAfter);
      return;
    case "materials":
      if (intent.kind === "materials") {
        const userId = await requireLinked(lu, replyToken);
        if (!userId) return;
        await handleMaterials(lineUserId, replyToken, { userId, state: lu.state }, { domain: intent.domain, text: intent.text, freeOnly: intent.freeOnly, kind: intent.kind_ ?? null }, scheduleAfter);
      }
      return;
    case "rule":
      await handleRuleBasedMessage(lineUserId, replyToken, text, intent, lu);
      return;
  }
}

/** 4 人格との会話。先に受け付けを返し、after() で生成して push する。 */
/**
 * 出題中の課題のヒントを 1 段出す（担当キャラ）。記録はヒント回数だけ。
 * テキストの「ヒント」と、出題メッセージの「💡 ヒント」ボタン（taskId 付き）の両方から呼ばれる。
 */
async function handleHint(lineUserId: string, replyToken: string, lu: LineUser, taskId?: string): Promise<void> {
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

async function handleChat(
  lineUserId: string,
  replyToken: string,
  text: string,
  userId: string,
  agent: AgentKey,
  scheduleAfter: AfterScheduler,
  opts: { offerQuiz: boolean; pendingTaskId?: string },
): Promise<void> {
  const personas = await loadPersonas(userId);
  if (rateLimit(`line-chat:${userId}`, CHAT_LIMIT.count, CHAT_LIMIT.windowMs)) {
    await replyTo(replyToken, {
      text: `${personas[agent].name}: 少し話しすぎかも。10 分ほど休憩してからまた呼んで。問題を解くのは今すぐでも大丈夫。`,
      quickReplies: [TODAY_ACTION],
    }).catch(warn("reply failed"));
    return;
  }
  // LLM（＋Web 検索）は数秒かかるので、先に受け付けを返し、after() で生成して push する
  await replyTo(replyToken, { text: `${personas[agent].name}: 考えています…` }).catch(warn("reply failed"));
  scheduleAfter(async () => {
    try {
      // 出題中の課題について聞かれたら、その課題を文脈として渡す（答えは言わない指示つき）
      const pendingTask = opts.pendingTaskId ? await resolveTask(userId, opts.pendingTaskId) : null;
      const result = await chatWithAgent(userId, agent, text, pendingTask ? { currentTask: taskContextFor(pendingTask) } : {});
      const reply = await chatReply(userId, env.appUrl, result, { offerQuiz: opts.offerQuiz });
      await pushTo(lineUserId, reply).catch(warn("push failed"));
    } catch (err) {
      warn("chat failed")(err);
      await pushTo(lineUserId, {
        text: "いまは答えられませんでした。「今日の学習」で 1 問どうぞ。",
        quickReplies: await agentQuickReplies(userId, env.appUrl).catch(() => []),
      }).catch(() => undefined);
    }
  });
}

/** LINE 上の選択式出題（planQuiz で系統・難易度・在庫を決め、無ければ作問に切り替える）。 */
async function handleQuiz(
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
async function handleGenerate(
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

async function handleRuleBasedMessage(lineUserId: string, replyToken: string, text: string, intent: Intent, lu: LineUser): Promise<void> {
  // 連携済みの「プロフィール」「能力」はテキストでも Flex カード（リッチメニューの PROFILE と同じ）
  if (intent.kind === "profile" && lu.userId) {
    const u = await prisma.user.findUnique({ where: { id: lu.userId }, select: { name: true } });
    await replyFlex(replyToken, "プロフィール", await buildProfileCard(lu.userId, u?.name ? `${u.name}さん` : "あなた"));
    return;
  }
  const linkUrl = await prepareLink(lineUserId, lu.userId, intent.kind);
  // 連携解除はテキストでは実行しない（確認ボタン action=unlink&confirm=1 で行う）。未連携の「連携解除」は案内文だけ
  const reply = buildReply(text, await contextFor(lu, linkUrl));
  // 返信APIが失敗しても状態は残るよう、先に保存する
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

async function handlePostback(lineUserId: string, replyToken: string, data: string, scheduleAfter: AfterScheduler): Promise<void> {
  const lu = await loadLineUser(lineUserId);
  const params = new URLSearchParams(data);
  const action = params.get("action") ?? "";

  // 「〜と話す」の宛先メモは、ボタン操作で別の流れに入ったら消す（後日のテキストが会話に横取りされないように）
  if (action !== "ask" && lu.state.note?.startsWith("ask:")) {
    lu.state = withoutNote(lu.state);
    await saveLineState(lineUserId, lu.state);
  }

  if (action === "today" || action === "quiz") {
    const raw = params.get("domain") ?? "";
    const domain: DomainKey | null = action === "quiz" ? (parseDomain(raw) ?? domainOf(raw)) : null;
    await handleQuiz(lineUserId, replyToken, lu, { domain, scheduleAfter });
    return;
  }
  if (action === "answer" || action === "giveup") {
    await handleAnswer(lineUserId, replyToken, lu, action, params, scheduleAfter);
    return;
  }
  if (action === "pass") {
    await handlePass(lineUserId, replyToken, lu, params.get("task") ?? "", scheduleAfter);
    return;
  }
  if (action === "hint") {
    // 出題メッセージの「💡 ヒント」ボタン。テキストの「ヒント」と同じ扱い（一段だけ出す）
    await handleHint(lineUserId, replyToken, lu, params.get("task") ?? "");
    return;
  }
  if (action === "help") {
    await handleRuleBasedMessage(lineUserId, replyToken, "使い方", { kind: "help" }, lu);
    return;
  }
  if (action === "materials") {
    // 「他の候補」「READ の教材」「無料だけ」（postback）
    const userId = await requireLinked(lu, replyToken);
    if (!userId) return;
    const raw = params.get("domain") ?? "";
    const domain: DomainKey | null = parseDomain(raw) ?? domainOf(raw);
    await handleMaterials(
      lineUserId,
      replyToken,
      { userId, state: lu.state },
      { domain, text: params.get("q") ?? "", freeOnly: params.get("free") === "1" || undefined, kind: null, more: params.get("more") === "1" },
      scheduleAfter,
    );
    return;
  }
  if (action === "ask") {
    await handleAsk(lineUserId, replyToken, lu, params);
    return;
  }
  if (action === "unlink") {
    await handleUnlink(lineUserId, replyToken, lu, params.get("confirm") === "1");
    return;
  }
  await handleRuleBasedPostback(lineUserId, replyToken, data, action, lu);
}

/** 連携解除（確認ボタン経由だけ実際に解除する） */
async function handleUnlink(lineUserId: string, replyToken: string, lu: LineUser, confirmed: boolean): Promise<void> {
  const ctx = await contextFor(lu);
  if (!confirmed || !lu.userId) {
    await replyTo(replyToken, confirmUnlinkReply(ctx));
    return;
  }
  await unlinkLineUser(lineUserId);
  // 返信文は解除前の状態（linked=true）に基づく「解除しました」
  await replyTo(replyToken, buildReply("連携解除", ctx));
}

/** パス: 出題中の課題と一致するときだけ受け付け、記録せずに次の 1 問を出す */
async function handlePass(lineUserId: string, replyToken: string, lu: LineUser, taskId: string, scheduleAfter: AfterScheduler): Promise<void> {
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
async function handleAnswer(
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

/** 「〜と話す」: 次の自由文（30 分以内）を指定人格宛てにする。 */
async function handleAsk(lineUserId: string, replyToken: string, lu: LineUser, params: URLSearchParams): Promise<void> {
  const userId = await requireLinked(lu, replyToken);
  if (!userId) return;
  const raw = params.get("agent") ?? "LEADER";
  const agent: AgentKey = (AGENTS as readonly string[]).includes(raw) ? (raw as AgentKey) : "LEADER";
  const personas = await loadPersonas(userId);
  await saveLineState(lineUserId, withAskNote(lu.state, agent));
  await replyTo(replyToken, askPrompt(agent, personas[agent].name));
}

async function handleRuleBasedPostback(lineUserId: string, replyToken: string, data: string, action: string, lu: LineUser): Promise<void> {
  const linkUrl = await prepareLink(lineUserId, lu.userId, action === "link" ? "link" : "other");
  const ctx = await contextFor(lu, linkUrl);
  // プロフィール: 連携済みなら Flex カード（ランク・XP・到達レベル・ミッション）
  if (action === "profile" && lu.userId) {
    // 表示名は Web アカウントの名前＋「さん」（未設定なら「あなた」）
    const u = await prisma.user.findUnique({ where: { id: lu.userId }, select: { name: true } });
    await replyFlex(replyToken, "プロフィール", await buildProfileCard(lu.userId, u?.name ? `${u.name}さん` : "あなた"));
    return;
  }
  const reply = buildPostbackReply(data, ctx);
  await persist(lineUserId, lu.state, reply);
  await replyTo(replyToken, reply);
}

/** 連携要求（message / postback 共通）: 未連携なら 15 分有効のワンタイムURLを発行する。 */
async function prepareLink(lineUserId: string, linkedUserId: string | null, intentKind: string): Promise<string | undefined> {
  if (intentKind !== "link" || linkedUserId) return undefined;
  const issued = await issueLinkToken(lineUserId);
  return `${appUrlBase()}/link/${issued.token}`;
}

/** 連携済みなら保存済みの Leader プロフィールと能力スコアを添える。PII は読まない。 */
async function contextFor(lu: LineUser, linkUrl?: string): Promise<LeaderContext> {
  let leaderProfile: LeaderContext["leaderProfile"] = null;
  let scores: LeaderContext["scores"];
  if (lu.userId) {
    const [profile, domains] = await Promise.all([
      prisma.leaderProfile.findUnique({ where: { userId: lu.userId } }),
      prisma.domainProfile.findMany({
        where: { userId: lu.userId },
        select: { domain: true, score: true, evidenceCount: true, confidence: true },
      }),
    ]);
    if (profile) {
      const preferences = (profile.preferences ?? {}) as Record<string, unknown>;
      const recommendedDomain = typeof preferences.recommendedDomain === "string" ? (preferences.recommendedDomain as DomainKey) : null;
      leaderProfile = { summary: profile.summary, recommendation: profile.recommendation, recommendedDomain };
    }
    scores = domains.map((profile) => ({
      domain: profile.domain as DomainKey,
      score: profile.score,
      evidenceCount: profile.evidenceCount,
      confidence: profile.confidence,
    }));
  }
  return { state: lu.state, appUrl: env.appUrl, leaderProfile, linked: Boolean(lu.userId), linkUrl, scores };
}

async function persist(lineUserId: string, state: LineState, reply: LeaderReply): Promise<void> {
  let next = state;
  if (reply.suggestedDomain) next = noteSuggestion(next, reply.suggestedDomain);
  if (reply.note) next = { ...next, note: reply.note };
  if (next !== state) await saveLineState(lineUserId, next);
}

/** LLM 呼び出しに上限時間を付ける（LINE の reply token は 1 分で失効するため） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
