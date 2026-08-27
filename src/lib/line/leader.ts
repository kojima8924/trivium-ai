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
  /** Web アカウントと連携済みか */
  linked?: boolean;
  /** 連携用のワンタイムURL（未連携で連携を求められたときだけ渡す） */
  linkUrl?: string;
  /** 連携済みのときの能力スコア（数値は evidence。Dashboard と同じ集計値） */
  scores?: { domain: DomainKey; score: number; evidenceCount: number; confidence: string }[];
};

// ---- 意図分類 ----

export type Intent =
  | { kind: "domain"; domain: DomainKey }
  | { kind: "link" }
  | { kind: "unlink" }
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

  if (/(連携(を)?(解除|やめ|外し|切)|解除|unlink)/.test(text)) return { kind: "unlink" };
  if (/(連携|リンク|link|同期|アカウント)/i.test(lower)) return { kind: "link" };
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
      "・「連携」→ Web アカウントと繋いで、記録に基づく提案にする",
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
      const measured = (ctx.scores ?? []).filter((x) => x.evidenceCount > 0);
      const scoreLine = measured
        .map((x) => `${x.domain} ${x.score}${x.confidence === "low" ? "（分析中）" : ""}`)
        .join(" / ");
      return {
        text: web
          ? [scoreLine ? `現在のプロフィール:\n${scoreLine}` : "", `総合寸評:\n${web}`, "詳しい三角形は Dashboard で。"]
              .filter(Boolean)
              .join("\n\n")
          : "能力プロフィールは Dashboard の三角形で見られます。READ / WRITE / CODE の評価と、総合寸評、次のおすすめが並びます。\n（「連携」と送ると、ここでも数値を確認できます）",
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
        text: `今日のおすすめは ${pick.domain} です。\n${pick.reason}${linkHint(ctx)}`,
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
    case "link":
      return buildReply("連携", ctx);
    case "read":
    case "write":
    case "code":
      return buildReply(action.toUpperCase(), ctx);
    default:
      return helpReply(ctx);
  }
}
