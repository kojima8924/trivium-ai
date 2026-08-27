// LINE の Flex Message（プロフィールカード / ミッション達成カード）。
// すべて pure 関数。@line/bot-sdk の messagingApi.FlexBubble 型に合わせる（size: mega、text は wrap: true）。
// 数値は決定論の集計値（score / level / XP）をそのまま描く。文章は入れない。
import type { messagingApi } from "@line/bot-sdk";
import type { Recommendation } from "@/config/trivium.config";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import type { XpSummary } from "@/lib/xp";

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
            text(measured ? String(d.score) : "–", { size: "sm", weight: "bold", align: "end", flex: 2 }),
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
        text(`${input.name} のプロフィール`, { size: "md", weight: "bold" }),
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

/** FlexBubble → 送信用メッセージ（altText 必須） */
export function flexMessage(altText: string, contents: messagingApi.FlexBubble): messagingApi.FlexMessage {
  return { type: "flex", altText: altText.slice(0, 400), contents };
}
