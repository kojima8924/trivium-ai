// LINE 表面に出す「Leader」の会話ロジック（ルールベース・純粋関数）。
// LINE では課題を解かせない。軽い会話・今日のおすすめ・曖昧な要求への応答 → Web へ誘導する。
// server-only を付けない（テストから直接 import できるように prisma / env に依存しない）。
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";
import type { LineState } from "./state";

// ---- 出力型（@line/bot-sdk の messagingApi.Message と互換な最小サブセット） ----

export type LeaderAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "message"; label: string; text: string }
  | { type: "postback"; label: string; data: string; displayText?: string };

export type LeaderReply = {
  text: string;
  /** 下部に並ぶ Quick Reply（最大13件、ここでは4件まで） */
  quickReplies?: LeaderAction[];
  /** ボタンテンプレート（Web へのリンク） */
  buttons?: { title: string; text: string; actions: LeaderAction[] };
  /** 状態更新（案内した domain） */
  suggestedDomain?: DomainKey;
  /** state.note に残すメモ */
  note?: string;
};

export type LeaderContext = {
  state: LineState;
  appUrl: string;
  now?: Date;
  /** Web 側の Leader プロフィール（連携済みのときだけ。任意） */
  leaderProfile?: { summary: string; recommendation: string; recommendedDomain?: DomainKey | null } | null;
};

// ---- 意図分類 ----

export type Intent =
  | { kind: "domain"; domain: DomainKey }
  | { kind: "today" }
  | { kind: "history" }
  | { kind: "profile" }
  | { kind: "short_time"; minutes: number | null }
  | { kind: "tired" }
  | { kind: "help" }
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "unknown" };

const toHalfWidth = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export function classifyIntent(raw: string): Intent {
  const text = toHalfWidth(raw).trim();
  const lower = text.toLowerCase();

  if (/^(help|ヘルプ|使い方|できること|\?|？)$/.test(lower) || /使い方|ヘルプ|help/.test(lower)) return { kind: "help" };
  if (/(read|リード|読(む|み|解)|読書)/i.test(lower) && !/書/.test(text)) return { kind: "domain", domain: "READ" };
  if (/(write|ライト|書(く|き)|作文|文章)/i.test(lower)) return { kind: "domain", domain: "WRITE" };
  if (/(code|コード|プログラ|python|パイソン|バグ)/i.test(lower)) return { kind: "domain", domain: "CODE" };
  if (/(履歴|きろく|記録|ログ|これまで)/.test(text)) return { kind: "history" };
  if (/(プロフィール|profile|能力|レーダー|得意|苦手|分析)/i.test(lower)) return { kind: "profile" };
  const min = text.match(/(\d+)\s*分/);
  if (min) return { kind: "short_time", minutes: Number(min[1]) };
  if (/(少しだけ|ちょっとだけ|軽く|さくっと|サクッと|短い|短め|すきま|隙間)/.test(text)) return { kind: "short_time", minutes: null };
  if (/(疲れ|つかれ|眠い|ねむい|だるい|しんどい|やる気)/.test(text)) return { kind: "tired" };
  if (/(今日|きょう|おすすめ|オススメ|何(か|を)(やる|やり|する|しよ)|なにか|何か|次)/.test(text)) return { kind: "today" };
  if (/^(こんにちは|こんばんは|おはよう|やあ|hi|hello|はじめまして|よろしく)/.test(lower)) return { kind: "greeting" };
  if (/(ありがとう|thanks|thank you|助かる)/.test(lower)) return { kind: "thanks" };
  return { kind: "unknown" };
}

// ---- 推薦（ルールベース） ----

/** 直近の案内回数が最も少ない domain を選ぶ（同数なら READ → WRITE → CODE の順） */
export function pickBalancedDomain(state: LineState): { domain: DomainKey; reason: string } {
  const counts = state.counts ?? { READ: 0, WRITE: 0, CODE: 0 };
  const sorted = [...DOMAINS].sort((a, b) => counts[a] - counts[b]);
  const least = sorted[0];
  const most = sorted[sorted.length - 1];
  if (counts[most] > counts[least] && counts[most] > 0) {
    return { domain: least, reason: `最近${most}が多かったので、今日は${least}にしてみますか？` };
  }
  if (state.lastDomain) {
    const next = DOMAINS[(DOMAINS.indexOf(state.lastDomain) + 1) % DOMAINS.length];
    return { domain: next, reason: `前回は${state.lastDomain}でした。今日は${next}で切り口を変えてみましょう。` };
  }
  return { domain: "CODE", reason: "まずは短い出力予測から。3分で1問、様子を見てみましょう。" };
}

// ---- 返信の組み立て ----

function learnUrl(appUrl: string, domain: DomainKey): string {
  return `${appUrl.replace(/\/$/, "")}${DOMAIN_META[domain].path}`;
}

function dashboardUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/dashboard`;
}

function domainQuickReplies(appUrl: string): LeaderAction[] {
  return [
    ...DOMAINS.map((d) => ({ type: "uri" as const, label: d, uri: learnUrl(appUrl, d) })),
    { type: "uri", label: "PROFILE", uri: dashboardUrl(appUrl) },
  ];
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
  return {
    text: [
      "はじめまして。Trivium の Leader です。",
      "READ / WRITE / CODE の3つで、あなたの「次の一歩」を一緒に決めます。",
      "",
      "AIは答えを渡しません。一段ずつヒントを出します。",
      "",
      "「10分だけ」「今日のおすすめ」のように話しかけるか、下のメニューから選んでください。",
    ].join("\n"),
    quickReplies: domainQuickReplies(ctx.appUrl),
  };
}

export function helpReply(ctx: LeaderContext): LeaderReply {
  return {
    text: [
      "できること:",
      "・READ / WRITE / CODE → その課題ページへ案内",
      "・「今日のおすすめ」→ 最近の偏りから1つ提案",
      "・「10分だけ」「軽く」→ 短い課題を提案",
      "・「履歴」「プロフィール」→ Dashboard へ",
      "",
      "課題そのものは Web で取り組みます。ここでは方向だけ決めましょう。",
    ].join("\n"),
    quickReplies: domainQuickReplies(ctx.appUrl),
  };
}

export function buildReply(userText: string, ctx: LeaderContext): LeaderReply {
  const intent = classifyIntent(userText);
  const { appUrl, state } = ctx;

  switch (intent.kind) {
    case "help":
      return helpReply(ctx);

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
        text: `${m.label}（${m.ja}）ですね。${m.tagline}。\n1問だけでも記録に残ります。`,
        buttons: domainButtons(appUrl, intent.domain, "Web で1問取り組みましょう"),
        suggestedDomain: intent.domain,
      };
    }

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
      return {
        text: web
          ? `現在の総合寸評:\n${web}\n\n詳しい三角形プロフィールは Dashboard で。`
          : "能力プロフィールは Dashboard の三角形で見られます。READ / WRITE / CODE の評価と、総合寸評、次のおすすめが並びます。",
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
        text: `今日のおすすめは ${pick.domain} です。\n${pick.reason}`,
        buttons: domainButtons(appUrl, pick.domain, "今日の1問"),
        suggestedDomain: pick.domain,
      };
    }

    case "unknown":
    default:
      return {
        text: "ここでは方向だけ決めましょう。「おすすめ」「10分だけ」「READ / WRITE / CODE」のどれかで話しかけてください。",
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
    case "read":
    case "write":
    case "code":
      return buildReply(action.toUpperCase(), ctx);
    default:
      return helpReply(ctx);
  }
}
