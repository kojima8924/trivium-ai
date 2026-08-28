// ルールベースの返信テンプレート（歓迎・ヘルプ・領域案内・プロフィール案内など）。
// LINE では課題を解かせない返答（quiz / generate は quiz.ts が担当）と、Web への誘導だけを組み立てる。
// server-only を付けない（テストから直接 import できるように prisma / env に依存しない）。
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";
import { formatScore } from "@/lib/scoring";
import { PERSONA_DEFAULTS } from "@/config/trivium.config";
import { dashboardUrl, learnUrl } from "./urls";
import { agentReply } from "./flex";
import { classifyIntent } from "./intent";
import type { LeaderAction, LeaderContext, LeaderReply } from "./types";
import type { LineState } from "./state";

// ---- 推薦（ルールベース） ----

/** 直近の案内回数が最も少ない domain を選ぶ（同数なら READ → WRITE → CODE の順） */
export function pickBalancedDomain(state: LineState): { domain: DomainKey; reason: string } {
  const counts = state.counts ?? { READ: 0, WRITE: 0, CODE: 0 };
  const sorted = [...DOMAINS].sort((a, b) => counts[a] - counts[b]);
  const least = sorted[0];
  const most = sorted[sorted.length - 1];
  if (counts[most] > counts[least] && counts[most] > 0) {
    return { domain: least, reason: `最近${DOMAIN_META[most].label}が多かったので、今日は${DOMAIN_META[least].label}にしてみますか？` };
  }
  if (state.lastDomain) {
    const next = DOMAINS[(DOMAINS.indexOf(state.lastDomain) + 1) % DOMAINS.length];
    return { domain: next, reason: `前回は${DOMAIN_META[state.lastDomain].label}でした。今日は${DOMAIN_META[next].label}で切り口を変えてみましょう。` };
  }
  return { domain: "CODE", reason: "まずは短い論理問題から。3分で1問、様子を見てみましょう。" };
}

// ---- 返信の組み立て ----

function domainQuickReplies(appUrl: string): LeaderAction[] {
  return [
    ...DOMAINS.map((d) => ({ type: "uri" as const, label: DOMAIN_META[d].label, uri: learnUrl(appUrl, d) })),
    { type: "postback", label: "LINEで1問", data: "action=today", displayText: "今日の学習" },
    { type: "uri", label: "PROFILE", uri: dashboardUrl(appUrl) },
  ];
}

/** 「LINE で1問」と「Web で解く」の2択（domain 指定） */
export function quizOrWebActions(appUrl: string, domain: DomainKey): LeaderAction[] {
  const m = DOMAIN_META[domain];
  return [
    { type: "postback", label: "LINEで1問", data: `action=quiz&domain=${domain}`, displayText: `${m.label}を LINE で1問` },
    { type: "uri", label: "Webで解く", uri: learnUrl(appUrl, domain) },
  ];
}

/** 未連携のときだけ添える一言（連携すると提案精度が上がることを伝える） */
function linkHint(ctx: LeaderContext): string {
  return ctx.linked ? "" : "\n\n（「連携」と送ると、Web の学習記録に基づいた提案になります）";
}

function domainButtons(appUrl: string, domain: DomainKey, headline: string): LeaderReply["buttons"] {
  const m = DOMAIN_META[domain];
  return {
    title: `${m.label} — ${m.ja}`,
    text: headline.slice(0, 60),
    actions: [
      { type: "uri", label: `${m.label} を開く`, uri: learnUrl(appUrl, domain) },
      { type: "uri", label: "プロフィールを見る", uri: dashboardUrl(appUrl) },
    ],
  };
}

export function welcomeReply(ctx: LeaderContext): LeaderReply {
  // 友だち追加直後の最初のメッセージ。連携前なので案内役は既定の名前（ミチ）で、
  // コンセプト（読み・書き・そろばん → READ / WRITE / LOGIC、AI は答えを教えない）と始め方を一度に伝える。
  // URL は Flex の本文だとタップできないので「使い方を見る」ボタン（Quick Reply）にする。
  const body = [
    "はじめまして。Trivium（トリビウム）の案内役、ミチよ。",
    "",
    "Trivium は「読み・書き・そろばん」を今の形にした学習サービス。",
    "READ（読む）・WRITE（書く）・LOGIC（論理）を 1 問ずつ、1 日 3 問。3 つそろえばデイリーミッション達成よ。",
    "AI は答えを教えない。分からないときは「💡 ヒント」ボタンで一段ずつ（最大 3 回）。自分で次の一歩を踏み出すのを手伝うだけ。",
    "解いた記録は三角形の「能力プロフィール」になって、得意と伸ばしどころが見えてくるわ。",
    "",
    "▼ 始め方",
    "1. 「連携」と送って Web アカウントとつなぐ（記録が残る）",
    "2. 下のメニューの READ / WRITE / LOGIC を押すと、この場で 1 問",
    "3. 詰まったら「💡 ヒント」、気が乗らなければ「パス」（記録に残らない）",
    "",
    "質問や相談は、そのまま話しかけて。ヨミ・フミ・ロゴスを名前で呼べば担当とも話せる。",
    "難易度の目安や三角グラフの読み方は、下の「使い方を見る」から。",
  ].join("\n");
  return agentReply("LEADER", PERSONA_DEFAULTS.LEADER.name, body, {
    appUrl: ctx.appUrl,
    mood: "wave",
    quickReplies: [
      { type: "message", label: "連携する", text: "連携" },
      { type: "uri", label: "使い方を見る", uri: `${ctx.appUrl.replace(/\/$/, "")}/guide` },
      { type: "postback", label: "まず1問", data: "action=today", displayText: "今日の学習" },
      ...DOMAINS.map((d) => ({ type: "postback" as const, label: `${DOMAIN_META[d].label}で1問`, data: `action=quiz&domain=${d}`, displayText: `${DOMAIN_META[d].label}で1問` })),
    ],
  });
}

/** 連携解除の確認（テキストの「連携解除」では即解除せず、ボタンで確定させる） */
export function confirmUnlinkReply(ctx: LeaderContext): LeaderReply {
  if (!ctx.linked) {
    return { text: "この LINE はまだ Web アカウントと連携していません。", quickReplies: domainQuickReplies(ctx.appUrl) };
  }
  return {
    text: "Web アカウントとの連携を解除しますか？\n解除すると、LINE での出題・記録・記録に基づく提案ができなくなります（再連携はいつでも可能）。",
    quickReplies: [
      { type: "postback", label: "解除する", data: "action=unlink&confirm=1", displayText: "連携を解除する" },
      { type: "postback", label: "やめる", data: "action=today", displayText: "やめる" },
    ],
  };
}

export function helpReply(ctx: LeaderContext): LeaderReply {
  const linked = Boolean(ctx.linked);
  const base = ctx.appUrl.replace(/\/$/, "");
  const quick: LeaderAction[] = [
    ...(linked ? [] : [{ type: "postback" as const, label: "連携する", data: "action=link", displayText: "連携する" }]),
    { type: "postback", label: "まず1問", data: "action=today", displayText: "今日の学習" },
    { type: "uri", label: "使い方ページ", uri: `${base}/guide` },
    ...(linked ? [{ type: "postback" as const, label: "おすすめ教材", data: "action=materials", displayText: "おすすめの教材" }] : []),
    { type: "postback", label: "プロフィール", data: "action=profile", displayText: "プロフィール" },
  ];
  return {
    text: [
      linked ? "使い方はこんな感じ。" : "はじめての方へ。まず下の「連携する」ボタンで Web アカウントとつなぐと、記録が残って提案が本人向けになるわ（入力は不要）。",
      "",
      "▼ できること",
      "・そのまま話しかけると案内役（ミチ）が答えます。「ヨミ、〜」「ロゴス、〜」のように名前で呼ぶと担当キャラと会話できます",
      "・「今日の学習」「1問」→ LINE 上で選択式を1問（連携が必要）。3 系統を 1 問ずつ（1 日 3 問）でデイリーミッション達成",
      "・出題中は「💡 ヒント」ボタンで一段ずつ（最大 3 回）。「パス」なら記録に残さず次へ",
      "・「論理パズルを出して」「短い読解を1問」→ 依頼に合わせて作問",
      "・「LOGICで難易度8」「難易度3」→ 用意済みの問題から即出題（無ければ作問）。「難易度8で作って」で作問。以後の「次」もその難易度",
      "・READ / WRITE / LOGIC → LINE で1問 or Web で解く",
      "・「今日のおすすめ」「10分だけ」→ 次の一歩を提案",
      "・「履歴」「プロフィール」→ Dashboard へ",
      "・「おすすめの本」「LOGIC の教材」→ 能力に合わせた教材を提案",
      "",
      "文は自由でOK。「僕の能力は？」「さっきの問題のヒント」のように話しかければ、意味を読んで対応するわ。",
      "じっくり書く課題は Web で。LINE では軽く1問ずつ進めましょう。",
    ].join("\n"),
    quickReplies: quick,
  };
}

export function buildReply(userText: string, ctx: LeaderContext): LeaderReply {
  const intent = classifyIntent(userText);
  const { appUrl, state } = ctx;

  switch (intent.kind) {
    case "help":
      return helpReply(ctx);

    case "link": {
      if (ctx.linked) {
        return {
          text: "この LINE は Web アカウントと連携済みです。あなたの学習記録をもとに提案しています。\n解除したいときは「連携解除」と送ってください。",
          buttons: {
            title: "連携済み",
            text: "学習記録に基づいて提案します",
            actions: [{ type: "uri", label: "Dashboard を開く", uri: dashboardUrl(appUrl) }],
          },
        };
      }
      if (!ctx.linkUrl) {
        return { text: "連携URLを発行できませんでした。少し時間をおいて、もう一度「連携」と送ってください。" };
      }
      return {
        text: "Web アカウントと連携すると、ここでの提案があなたの実際の学習記録に基づくようになります。\n\n下のリンクを開いて、Google でログインしてください（15分で失効します）。",
        buttons: {
          title: "アカウント連携",
          text: "15分間有効なワンタイムリンク",
          actions: [{ type: "uri", label: "連携する", uri: ctx.linkUrl }],
        },
      };
    }

    case "unlink":
      return {
        text: ctx.linked
          ? "連携を解除しました。これ以降は学習記録を参照せず、この会話の流れだけで提案します。"
          : "この LINE はまだ Web アカウントと連携していません。",
        quickReplies: domainQuickReplies(appUrl),
      };

    case "greeting":
      return {
        text: "こんにちは。今日はどれにしますか？ 迷ったら「おすすめ」と送ってください。",
        quickReplies: domainQuickReplies(appUrl),
      };

    case "thanks":
      return { text: "どういたしまして。続きは Web で。次の一歩が決まったら、また声をかけてください。" };

    case "domain": {
      const m = DOMAIN_META[intent.domain];
      return {
        text: `${m.label}（${m.ja}）ですね。${m.tagline}。\nLINE で1問（選択式）か、Web でじっくり解くか選んでください。`,
        quickReplies: quizOrWebActions(appUrl, intent.domain),
        suggestedDomain: intent.domain,
      };
    }

    // quiz / generate は DB と LLM が要るので webhook 側（src/lib/line/quiz.ts）が処理する。ここは保険の文言
    case "quiz":
      return {
        text: "出題の準備ができませんでした。「今日の学習」を押すか、もう一度「1問」と送ってください。",
        quickReplies: domainQuickReplies(appUrl),
      };
    case "generate":
      return {
        text: "作問の準備ができませんでした。「論理パズルを出して」のように、もう一度送ってください。",
        quickReplies: domainQuickReplies(appUrl),
      };

    case "history":
      return {
        text: "これまでの学習履歴は Dashboard にまとまっています。最近の10件と、各領域の寸評が見られます。",
        buttons: {
          title: "学習履歴",
          text: "Dashboard で確認できます",
          actions: [{ type: "uri", label: "Dashboard を開く", uri: dashboardUrl(appUrl) }],
        },
      };

    case "profile": {
      const web = ctx.leaderProfile?.summary?.trim();
      const measured = (ctx.scores ?? []).filter((x) => x.evidenceCount > 0);
      const scoreLine = measured
        .map((x) => `${x.domain} ${formatScore(x.score)}${x.confidence === "low" ? "（分析中）" : ""}`)
        .join(" / ");
      return {
        text: web
          ? [scoreLine ? `現在のプロフィール:\n${scoreLine}` : "", `総合寸評:\n${web}`, "詳しい三角形は Dashboard で。"]
              .filter(Boolean)
              .join("\n\n")
          : "能力プロフィールは Dashboard の三角形で見られます。READ / WRITE / LOGIC の評価と、総合寸評、次のおすすめが並びます。\n（「連携」と送ると、ここでも数値を確認できます）",
        buttons: {
          title: "PROFILE",
          text: "三角形プロフィールと総合寸評",
          actions: [{ type: "uri", label: "Dashboard を開く", uri: dashboardUrl(appUrl) }],
        },
      };
    }

    case "short_time": {
      const minutes = intent.minutes;
      const pick = ctx.leaderProfile?.recommendedDomain
        ? { domain: ctx.leaderProfile.recommendedDomain, reason: ctx.leaderProfile.recommendation || "Web 側の分析に基づく提案です。" }
        : pickBalancedDomain(state);
      const lead = minutes === null ? "短めにいきましょう。" : minutes <= 5 ? `${minutes}分なら1問がちょうどいいです。` : `${minutes}分あれば1〜2問いけます。`;
      return {
        text: `${lead}\n${pick.reason}`,
        buttons: domainButtons(appUrl, pick.domain, `${DOMAIN_META[pick.domain].ja}を1問`),
        suggestedDomain: pick.domain,
        note: minutes === null ? "短時間希望" : `${minutes}分希望`,
      };
    }

    case "tired":
      return {
        text: "無理はしないのが正解です。それでも少しだけなら、READ の短文1本（約2分）が一番軽いです。",
        buttons: domainButtons(appUrl, "READ", "短文を1本だけ読む"),
        suggestedDomain: "READ",
        note: "疲れ気味",
      };

    case "today": {
      const pick = ctx.leaderProfile?.recommendedDomain
        ? { domain: ctx.leaderProfile.recommendedDomain, reason: ctx.leaderProfile.recommendation || "Web 側の分析に基づく提案です。" }
        : pickBalancedDomain(state);
      return {
        text: `今日のおすすめは ${DOMAIN_META[pick.domain].label} です。\n${pick.reason}${linkHint(ctx)}`,
        quickReplies: quizOrWebActions(appUrl, pick.domain),
        suggestedDomain: pick.domain,
      };
    }

    case "unknown":
    default:
      return {
        text: "「今日の学習」で1問、「論理パズルを出して」で作問、「READ / WRITE / LOGIC」で領域を選べます。迷ったら「おすすめ」と送ってください。",
        quickReplies: domainQuickReplies(appUrl),
      };
  }
}

/** Rich Menu の postback data → 返信 */
export function buildPostbackReply(data: string, ctx: LeaderContext): LeaderReply {
  const params = new URLSearchParams(data);
  const action = params.get("action") ?? "";
  switch (action) {
    case "today":
      return buildReply("今日のおすすめ", ctx);
    case "history":
      return buildReply("履歴", ctx);
    case "profile":
      return buildReply("プロフィール", ctx);
    case "link":
      return buildReply("連携", ctx);
    case "read":
    case "write":
    case "code":
    case "logic":
      return buildReply(action.toUpperCase(), ctx);
    default:
      return helpReply(ctx);
  }
}
