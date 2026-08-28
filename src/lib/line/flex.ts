// LINE の Flex Message（プロフィールカード / ミッション達成カード）。
// すべて pure 関数。@line/bot-sdk の messagingApi.FlexBubble 型に合わせる（size: mega、text は wrap: true）。
// 数値は決定論の集計値（score / level / XP）をそのまま描く。文章は入れない。
import type { messagingApi } from "@line/bot-sdk";
import type { Recommendation } from "@/config/trivium.config";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { formatScore } from "@/lib/scoring";
import { characterHex, characterImageUrl, type CharacterMood } from "@/lib/characters";
import type { AgentKey } from "@/lib/persona";
import type { XpSummary } from "@/lib/xp";
import type { LeaderAction, LeaderReply } from "./leader";

// LINE の Flex は CSS 変数が使えないので、ライトテーマの domain 色を固定で使う
const COLOR: Record<DomainKey, string> = { READ: "#1d4ed8", WRITE: "#b45309", CODE: "#047857" };
const INK = "#1c1c1a";
const MUTED = "#6b6b66";
const LINE_COLOR = "#e6e4dc";
const TRACK = "#f0eee7";

export type FlexProfileInput = {
  name: string;
  xp: XpSummary;
  domains: { domain: DomainKey; score: number; level: number; evidenceCount: number }[];
  dashboardUrl: string;
};

type Box = messagingApi.FlexBox;
type Component = messagingApi.FlexComponent;

function text(t: string, extra: Partial<messagingApi.FlexText> = {}): messagingApi.FlexText {
  return { type: "text", text: t || " ", wrap: true, size: "sm", color: INK, ...extra };
}

/** 横棒。ratio は 0..1。LINE の Flex は width を % で指定できる */
function bar(ratio: number, color: string): Box {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: TRACK,
    cornerRadius: "sm",
    height: "8px",
    contents: [
      {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        cornerRadius: "sm",
        height: "8px",
        // 0% だと LINE 側で描画エラーになることがあるので最小 1%
        width: `${Math.max(1, pct)}%`,
        contents: [],
      },
    ],
  };
}

function separator(): messagingApi.FlexSeparator {
  return { type: "separator", color: LINE_COLOR };
}

/** 到達レベルと score のバー（3 系統） */
function domainRows(domains: FlexProfileInput["domains"]): Component[] {
  return domains.map((d) => {
    const m = DOMAIN_META[d.domain];
    const measured = d.evidenceCount > 0;
    return {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            text(m.label, { size: "xs", weight: "bold", color: COLOR[d.domain], flex: 3 }),
            text(measured ? `Lv.${d.level}` : "未計測", { size: "xs", color: MUTED, align: "center", flex: 2 }),
            text(measured ? formatScore(d.score) : "–", { size: "sm", weight: "bold", align: "end", flex: 2 }),
          ],
        },
        bar(measured ? d.score / 100 : 0, COLOR[d.domain]),
      ],
    } satisfies Box;
  });
}

/** 今日のミッション（3 系統の ✓/–）と streak */
function missionRow(xp: XpSummary): Box {
  const marks = DOMAINS.map((d) => `${DOMAIN_META[d].label} ${xp.today[d] ? "✓" : "–"}`).join("　");
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text("今日のミッション", { size: "xs", color: MUTED, flex: 3 }),
          text(xp.missionToday ? "達成" : "未達成", { size: "xs", weight: "bold", align: "end", color: xp.missionToday ? "#047857" : MUTED, flex: 2 }),
        ],
      },
      text(marks, { size: "xs" }),
      text(xp.streak > 0 ? `🔥 ${xp.streak} 日連続` : "連続記録なし（今日から）", { size: "xs", color: MUTED }),
    ],
  };
}

/** ランクと総合 XP（次のランクまでのバー） */
function rankRow(xp: XpSummary): Box {
  const next = xp.rank.next;
  const sub = next === null ? "最高ランク" : `次のランクまで あと ${Math.max(0, next - xp.total)} XP`;
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text(xp.rank.title, { size: "md", weight: "bold", flex: 4 }),
          text(`${xp.total} XP`, { size: "md", weight: "bold", align: "end", flex: 2 }),
        ],
      },
      bar(xp.rank.progress, INK),
      text(sub, { size: "xxs", color: MUTED }),
    ],
  };
}

/** プロフィールカード（「プロフィール」postback で送る） */
export function buildProfileFlex(input: FlexProfileInput): messagingApi.FlexBubble {
  const byDomain = DOMAINS.map((d) => `${DOMAIN_META[d].label} ${input.xp.byDomain[d]}`).join(" / ");
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: [
        text("TRIVIUM", { size: "xxs", color: MUTED, weight: "bold" }),
        text(`${input.name}のプロフィール`, { size: "md", weight: "bold" }),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        rankRow(input.xp),
        text(`系統別 XP: ${byDomain}`, { size: "xxs", color: MUTED }),
        separator(),
        text("能力（到達レベル）", { size: "xs", color: MUTED, margin: "md" }),
        ...domainRows(input.domains),
        separator(),
        missionRow(input.xp),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: INK,
          height: "sm",
          action: { type: "uri", label: "Dashboard で詳しく見る", uri: input.dashboardUrl },
        },
      ],
    },
  };
}

export type FlexMissionInput = {
  xp: XpSummary;
  /** このミッションで得た XP（内訳込み） */
  earned: { tasks: number; bonus: number; streakBonus: number };
  recommendation: Recommendation | null;
  /** 今日の 3 問（表示用の 1 行ずつ） */
  rows: string[];
  dashboardUrl: string;
};

/** デイリーミッション達成カード（今日の 3 問・XP・streak・今日の 1 冊） */
export function buildMissionFlex(input: FlexMissionInput): messagingApi.FlexBubble {
  const { xp, earned, recommendation } = input;
  const rec = recommendation;
  const recContents: Component[] = rec
    ? [
        separator(),
        text(rec.kind === "site" ? "今日のおすすめサイト" : "今日の 1 冊", { size: "xs", color: MUTED, margin: "md" }),
        text(`${rec.title}${rec.paid ? "（有料）" : ""}`, { size: "sm", weight: "bold" }),
        text(rec.author, { size: "xs", color: MUTED }),
        text(rec.note, { size: "xs" }),
      ]
    : [];
  const footerButtons: messagingApi.FlexButton[] = [
    ...(rec
      ? [
          {
            type: "button" as const,
            style: "secondary" as const,
            height: "sm" as const,
            action: { type: "uri" as const, label: (rec.kind === "site" ? "サイトを開く" : "本を探す").slice(0, 20), uri: rec.url },
          },
        ]
      : []),
    {
      type: "button",
      style: "primary",
      color: INK,
      height: "sm",
      action: { type: "uri", label: "Dashboard", uri: input.dashboardUrl },
    },
  ];
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: "#fafaf7",
      contents: [
        text("DAILY MISSION", { size: "xxs", color: MUTED, weight: "bold" }),
        text("今日の 3 問、達成！", { size: "lg", weight: "bold" }),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        ...input.rows.map((r) => text(r, { size: "xs" })),
        separator(),
        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            text("獲得 XP", { size: "xs", color: MUTED, flex: 3 }),
            text(`+${earned.tasks + earned.bonus + earned.streakBonus} XP`, { size: "md", weight: "bold", align: "end", flex: 2 }),
          ],
        },
        text(`課題 ${earned.tasks} / ミッション +${earned.bonus} / 連続 +${earned.streakBonus}`, { size: "xxs", color: MUTED }),
        text(`${xp.rank.title} · 合計 ${xp.total} XP · 🔥 ${xp.streak} 日連続`, { size: "xs" }),
        bar(xp.rank.progress, INK),
        ...recContents,
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      spacing: "sm",
      contents: footerButtons,
    },
  };
}

// ---- キャラの吹き出し（LINE スタンプ風。左に丸いアイコン、右に名前と本文） ----

export type AgentBubbleInput = {
  agent: AgentKey;
  /** 人格の表示名（ユーザーが改名していればその名前） */
  name: string;
  text: string;
  /** 絶対 HTTPS URL（characterImageUrl(agent, appUrl)） */
  imageUrl: string;
  /** 名前の色。省略時は系統色 */
  accent?: string;
  /** 下段の小さな補足（「Lv.7 → Lv.8 · +30 XP」など） */
  footer?: string;
};

const AGENT_TEXT_MAX = 2000;

/** キャラの吹き出し 1 つ（FlexBubble） */
export function buildAgentBubble(input: AgentBubbleInput): messagingApi.FlexBubble {
  const accent = input.accent ?? characterHex(input.agent);
  const body = input.text.trim().slice(0, AGENT_TEXT_MAX) || " ";
  const rightContents: Component[] = [
    text(input.name.slice(0, 20) || " ", { size: "xs", weight: "bold", color: accent }),
    text(body, { size: "sm", margin: "xs" }),
  ];
  if (input.footer) rightContents.push(text(input.footer.slice(0, 200), { size: "xxs", color: MUTED, margin: "sm" }));
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "horizontal",
      paddingAll: "12px",
      spacing: "md",
      contents: [
        {
          // 丸いアイコン。box に cornerRadius を付け、中の image を cover で切り抜く
          type: "box",
          layout: "vertical",
          width: "64px",
          height: "64px",
          cornerRadius: "32px",
          borderWidth: "2px",
          borderColor: accent,
          backgroundColor: "#ffffff",
          flex: 0,
          contents: [{ type: "image", url: input.imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" }],
        },
        { type: "box", layout: "vertical", flex: 1, contents: rightContents },
      ],
    },
  };
}

/**
 * text と flex の両方を持つ LeaderReply を返すヘルパー。
 * push/reply 側は flex があればそれを送り、無ければ text を送る（flex が使えない経路でも文面が失われない）。
 */
export function agentReply(
  agent: AgentKey,
  name: string,
  body: string,
  opts: {
    /** env.appUrl / LeaderContext.appUrl（画像の絶対 URL を組み立てる） */
    appUrl: string;
    quickReplies?: LeaderAction[];
    footer?: string;
    buttons?: LeaderReply["buttons"];
    suggestedDomain?: LeaderReply["suggestedDomain"];
    note?: string;
    /** 表情差分（既定 normal） */
    mood?: CharacterMood;
  },
): LeaderReply {
  const plain = opts.footer ? `${name}: ${body}
${opts.footer}` : `${name}: ${body}`;
  return {
    text: plain,
    altText: body.slice(0, 100),
    flex: buildAgentBubble({ agent, name, text: body, imageUrl: characterImageUrl(agent, opts.appUrl, "face", opts.mood ?? "normal"), footer: opts.footer }),
    quickReplies: opts.quickReplies,
    buttons: opts.buttons,
    suggestedDomain: opts.suggestedDomain,
    note: opts.note,
  };
}

// ---- 教材のおすすめ（案内役の吹き出し＋候補ごとのボタン） ----

export type MaterialsBubbleItem = {
  title: string;
  /** 形式・著者など 1 行（例: 「書籍 / 野矢茂樹」） */
  meta: string;
  reason: string;
  url?: string;
  /** ボタンにするリンク（公式ページ / Amazonで探す など。最大 2 件） */
  links?: { label: string; url: string }[];
  free?: boolean;
};

export type MaterialsBubbleInput = {
  agent: AgentKey;
  name: string;
  imageUrl: string;
  /** 案内役の導入文（ADVISOR の言い換え、または決定論の文） */
  intro: string;
  items: MaterialsBubbleItem[];
  accent?: string;
};

/** 「顔アイコン＋導入文」の下に、教材ごとに タイトル / 一言 / 理由 / 開くボタン を並べる */
export function buildMaterialsBubble(input: MaterialsBubbleInput): messagingApi.FlexBubble {
  const accent = input.accent ?? characterHex(input.agent);
  const head: Box = {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "56px",
        height: "56px",
        cornerRadius: "28px",
        borderWidth: "2px",
        borderColor: accent,
        backgroundColor: "#ffffff",
        flex: 0,
        contents: [{ type: "image", url: input.imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" }],
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        contents: [text(input.name.slice(0, 20) || " ", { size: "xs", weight: "bold", color: accent }), text(input.intro.trim().slice(0, 900) || " ", { size: "sm", margin: "xs" })],
      },
    ],
  };
  const items: Component[] = input.items.slice(0, 3).flatMap((it, i) => {
    const block: Component[] = [
      separator(),
      text(`${i + 1}. ${it.title}${it.free ? "（無料）" : ""}`.slice(0, 120), { size: "sm", weight: "bold", margin: "md" }),
      text(it.meta.slice(0, 80), { size: "xxs", color: MUTED }),
      text(it.reason.slice(0, 240), { size: "xs", margin: "xs" }),
    ];
    const links = it.links && it.links.length ? it.links : it.url ? [{ label: "開く", url: it.url }] : [];
    if (links.length) {
      block.push({
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        margin: "xs",
        contents: links.slice(0, 2).map((l) => ({
          type: "button" as const,
          style: "link" as const,
          height: "sm" as const,
          action: { type: "uri" as const, label: l.label.slice(0, 20), uri: l.url },
        })),
      });
    }
    return block;
  });
  return {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: [head, ...items] },
  };
}

/** 教材のおすすめ返信（text にも同じ内容を残す。LINE 以外の経路・ログ用） */
export function materialsReply(
  agent: AgentKey,
  name: string,
  intro: string,
  items: MaterialsBubbleItem[],
  opts: { appUrl: string; quickReplies?: LeaderAction[]; mood?: CharacterMood },
): LeaderReply {
  const lines = items.map((it, i) => `${i + 1}. ${it.title}${it.free ? "（無料）" : ""} — ${it.meta}` + "\n" + `   ${it.reason}` + (it.url ? "\n" + `   ${it.url}` : ""));
  const plain = [`${name}: ${intro}`, ...lines].join("\n\n");
  return {
    text: plain,
    altText: `${name}: おすすめの教材を ${items.length} つ選んだわ`,
    flex: buildMaterialsBubble({ agent, name, imageUrl: characterImageUrl(agent, opts.appUrl, "face", opts.mood ?? "normal"), intro, items }),
    quickReplies: opts.quickReplies,
  };
}

/** FlexBubble → 送信用メッセージ（altText 必須） */
export function flexMessage(altText: string, contents: messagingApi.FlexBubble): messagingApi.FlexMessage {
  return { type: "flex", altText: altText.slice(0, 400), contents };
}
