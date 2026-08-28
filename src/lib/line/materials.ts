// LINE: 教材のおすすめ（「おすすめの本」「Python の教材を探して」「他の候補」）。
// 能力プロフィール（決定論）で候補を選び、ADVISOR の人格で導入文を言い換えて、候補ごとの「開く」ボタン付き Flex で返す。
// LLM は導入文の言い換えだけ（候補以外の教材を挙げさせない）。失敗時は決定論の文面で返す。
import "server-only";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/http";
import { learningAI } from "@/lib/ai";
import { DOMAINS, DOMAIN_META, type DomainKey } from "@/lib/domain";
import { loadPersonas, personaPrompts } from "@/lib/persona";
import { buildLearnerProfile } from "@/lib/materials/profile";
import { summarizeLearner } from "@/lib/materials/recommend";
import { searchMaterials } from "@/lib/materials/search";
import type { MaterialKind, MaterialRecommendation } from "@/lib/materials/types";
import { TODAY_ACTION, dashboardAction } from "./actions";
import { materialsReply, type MaterialsBubbleItem } from "./flex";
import type { LeaderAction, LeaderReply } from "./leader";
import { pushTo, replyTo } from "./push";
import { loadLineUser, saveLineState, withRecommendedMaterials, type LineState } from "./state";

type AfterScheduler = (task: () => void | Promise<void>) => void;
const MATERIALS_LIMIT = { count: 12, windowMs: 10 * 60_000 };
const KIND_LABEL: Record<MaterialKind, string> = { book: "書籍", web: "Web", video: "動画", course: "講座", practice: "問題集" };

export type MaterialsRequest = {
  domain: DomainKey | null;
  text: string;
  freeOnly?: boolean;
  kind: MaterialKind | null;
  /** 「他の候補」: 直近に勧めたものを除外して次を出す */
  more?: boolean;
};

const warn = (label: string) => (err: unknown) => console.warn(`[line] ${label}:`, (err as Error).message);

/** 教材のおすすめ。先に受け付けを返し、after() で選定＋言い換えして push する */
export async function handleMaterials(
  lineUserId: string,
  replyToken: string,
  lu: { userId: string; state: LineState },
  req: MaterialsRequest,
  scheduleAfter: AfterScheduler,
): Promise<void> {
  const personas = await loadPersonas(lu.userId);
  const name = personas.LEADER.name;
  if (rateLimit(`line-materials:${lu.userId}`, MATERIALS_LIMIT.count, MATERIALS_LIMIT.windowMs)) {
    await replyTo(replyToken, { text: `${name}: 教材探しは少し休憩。10 分ほどしたらまた聞いて。`, quickReplies: [TODAY_ACTION] }).catch(warn("reply failed"));
    return;
  }
  const scope = req.domain ? `${DOMAIN_META[req.domain].label} の` : "あなたの能力に合う";
  await replyTo(replyToken, { text: `${name}: ${scope}教材を見繕っているわ。少し待って…` }).catch(warn("reply failed"));
  scheduleAfter(async () => {
    try {
      const reply = await buildMaterialsPush(lu.userId, lineUserId, req);
      await pushTo(lineUserId, reply).catch(warn("push failed"));
    } catch (err) {
      warn("materials failed")(err);
      await pushTo(lineUserId, { text: `${name}: いまは教材を選べなかった。Dashboard の「おすすめ教材」を見てみて。`, quickReplies: [dashboardAction(), TODAY_ACTION] }).catch(() => undefined);
    }
  });
}

/** 選定 → 言い換え → Flex。state に勧めた id を記録する（after() 内で呼ぶ） */
export async function buildMaterialsPush(userId: string, lineUserId: string, req: MaterialsRequest): Promise<LeaderReply> {
  const fresh = await loadLineUser(lineUserId);
  const seen = req.more ? (fresh.state.recommendedMaterialIds ?? []) : [];
  const profile = await buildLearnerProfile(userId, seen);
  const recs = await searchMaterials(profile, { domain: req.domain, text: req.text, freeOnly: req.freeOnly, kind: req.kind, limit: 3 });
  const personas = await loadPersonas(userId);
  const name = personas.LEADER.name;
  const appUrl = env.appUrl;

  if (recs.length === 0) {
    return {
      text: `${name}: その条件だと、いま手元のカタログには無いわ。条件を変えるか、Dashboard の「おすすめ教材」を見て。`,
      quickReplies: [...domainMaterialActions(), dashboardAction()],
    };
  }
  // 勧めた id を記録（「他の候補」で除外）
  await saveLineState(lineUserId, withRecommendedMaterials(fresh.state, recs.map((r) => r.material.id))).catch(warn("state save failed"));

  const items: MaterialsBubbleItem[] = recs.map((r) => ({
    title: r.material.title,
    meta: `${KIND_LABEL[r.material.kind]}${r.material.author ? ` / ${r.material.author}` : ""}${r.material.levelMin === r.material.levelMax ? ` / Lv${r.material.levelMin}` : ` / Lv${r.material.levelMin}〜${r.material.levelMax}`}`,
    reason: r.reason,
    url: r.material.url,
    free: r.material.free,
  }));
  const intro = await phraseIntro(userId, profile, recs, req).catch((err) => {
    warn("materials phrase failed")(err);
    return null;
  });
  const fallbackIntro = req.domain
    ? `${DOMAIN_META[req.domain].label} を伸ばすなら、この 3 つ。理由は能力プロフィールから。`
    : `あなたの三角形（${summarizeLearner(profile)}）を見て選んだわ。弱いところから順に。`;
  return materialsReply("LEADER", name, intro ?? fallbackIntro, items, {
    appUrl,
    quickReplies: [
      { type: "postback", label: "他の候補", data: `action=materials&more=1${req.domain ? `&domain=${req.domain}` : ""}${req.freeOnly ? "&free=1" : ""}`, displayText: "他の候補" },
      ...domainMaterialActions(),
      { type: "postback", label: "無料だけ", data: `action=materials&free=1${req.domain ? `&domain=${req.domain}` : ""}`, displayText: "無料の教材だけ" },
      dashboardAction(),
    ],
  });
}

function domainMaterialActions(): LeaderAction[] {
  return DOMAINS.map((d) => ({
    type: "postback" as const,
    label: `${DOMAIN_META[d].label} の教材`,
    data: `action=materials&domain=${d}`,
    displayText: `${DOMAIN_META[d].label} の教材`,
  }));
}

/**
 * ADVISOR の人格で導入文（3〜6 文）を言い換える。候補以外の教材を挙げない・URL を書かない・理由は能力に結び付ける。
 * 会話履歴・観察メモは使わない（純粋に推薦の説明だけ）。
 */
async function phraseIntro(userId: string, profile: Awaited<ReturnType<typeof buildLearnerProfile>>, recs: MaterialRecommendation[], req: MaterialsRequest): Promise<string> {
  const prompts = await personaPrompts(userId);
  const candidates = recs
    .map((r, i) => `${i + 1}. ${r.material.title}（${KIND_LABEL[r.material.kind]}${r.material.author ? ` / ${r.material.author}` : ""} / Lv${r.material.levelMin}〜${r.material.levelMax}${r.material.free ? " / 無料" : ""}）: ${r.reason}`)
    .join("\n");
  const userText = [
    "【教材のおすすめ】学習者に、次の候補 3 つを勧める導入文を書いてください（3〜6 文・日本語・あなたの口調）。",
    "- 候補以外の教材・書名・サイト名を挙げない。URL は書かない（別途ボタンで示す）",
    "- 理由は学習者の能力（到達レベル・弱い小分類）に結び付ける。数字は下の要約にあるものだけ使う",
    "- 各候補に 1 文ずつ触れ、最後に「まず 1 つ選んで少しだけ試す」ような次の一歩で締める",
    req.text ? `- 学習者の希望: 「${req.text}」` : "",
    "",
    `学習者の能力: ${summarizeLearner(profile)}`,
    "",
    "候補:",
    candidates,
  ]
    .filter(Boolean)
    .join("\n");
  const out = await learningAI.chat({
    learnerRef: userId,
    persona: prompts.LEADER,
    userText,
    history: [],
    memoryNotes: "",
    profileSummary: summarizeLearner(profile),
    allowSearch: false,
  });
  const text = out.text.trim().replace(/https?:\/\/\S+/g, "").slice(0, 900);
  if (text.length < 20) throw new Error("intro too short");
  return text;
}
