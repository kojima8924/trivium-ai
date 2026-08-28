// LINE 表面に出す「Leader」の会話ロジック（ルールベース・純粋関数）。
// LINE では課題を解かせない。軽い会話・今日のおすすめ・曖昧な要求への応答 → Web へ誘導する。
// server-only を付けない（テストから直接 import できるように prisma / env に依存しない）。
import type { messagingApi } from "@line/bot-sdk";
import { DOMAIN_META, DOMAINS, type DomainKey } from "@/lib/domain";
import type { LineState } from "./state";
import { agentReply } from "./flex";
import { formatScore } from "@/lib/scoring";
import { LINE, PERSONA_DEFAULTS } from "@/config/trivium.config";
import type { MaterialKind } from "@/lib/materials/types";

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
  /** キャラの吹き出し（Flex）。あれば text の代わりにこれを送る（quickReplies はこちらに付く） */
  flex?: messagingApi.FlexContainer;
  /** flex 送信時の通知文。省略時は text の先頭 */
  altText?: string;
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
  | { kind: "quiz"; domain: DomainKey | null; difficulty?: number; difficultyDelta?: number }
  | { kind: "generate"; request: string; domain?: DomainKey | null; difficulty?: number }
  | { kind: "link" }
  | { kind: "unlink" }
  /** 出題中の課題をパス（テキストの「パス」「スキップ」） */
  | { kind: "pass" }
  /** 出題中の課題へのヒント要求（「ヒント」「わからない」）。出題中でなければ会話へ */
  | { kind: "hint" }
  /** 教材（本・サイト・動画）のおすすめ。ADVISOR が能力プロフィールに合わせて選ぶ */
  | { kind: "materials"; domain: DomainKey | null; text: string; freeOnly?: boolean; kind_?: MaterialKind | null }
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

/** 「read」「論理」などの語を domain に写す */
export function domainOf(word: string): DomainKey | null {
  const w = word.toLowerCase();
  if (/^(read|リード|読解)$/.test(w)) return "READ";
  if (/^(write|ライト|作文)$/.test(w)) return "WRITE";
  if (/^(logic|code|ロジック|論理)$/.test(w)) return "CODE";
  return null;
}

/** 「難易度8」「レベル 8」「Lv8」「code 8」から 1〜10 の難易度を取り出す（無ければ null） */
export function parseDifficulty(raw: string): number | null {
  const text = toHalfWidth(raw);
  const m =
    text.match(/(?:難易度|レベル|難度|level|lv\.?)\s*[:：=]?\s*(10|[1-9])(?![0-9分時])/i) ??
    text.match(/^(?:read|write|logic|code|リード|ライト|ロジック|読解|作文|論理)\s*(?:で|の)?\s*(10|[1-9])(?![0-9問回つ個分時])/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 10 ? n : null;
}

/** 文中の domain 語（read/write/logic/code/論理…）を拾う。無ければ null */
export function domainInText(raw: string): DomainKey | null {
  const lower = toHalfWidth(raw).toLowerCase();
  if (/(logic|code|ロジック|論理|コード|python|パイソン|プログラ)/.test(lower)) return "CODE";
  if (/(write|ライト|作文)/.test(lower) || /書(く|き)/.test(lower)) return "WRITE";
  if (/(read|リード|読解)/.test(lower) || /読(む|み)/.test(lower)) return "READ";
  return null;
}

/** 疑問・説明を求める文か（出題ではなく会話に回す） */
function isQuestionLike(text: string): boolean {
  return /[?？]\s*$/.test(text) || /(教えて|説明|とは|って(何|なに|どの|どんな|どう)|どのくらい|どんな|なんですか|ですか)/.test(text);
}

/** 「おすすめの本」「Python の教材を探して」「何を読めばいい？」→ materials 意図。該当しなければ null */
export function parseMaterialsIntent(text: string): Extract<Intent, { kind: "materials" }> | null {
  const lower = text.toLowerCase();
  if (/^(今日の|きょうの)?(おすすめ|オススメ)[!！。]?$/.test(text) || /^今日の/.test(text)) return null;
  const materialWord = /(教材|参考書|問題集|入門書|本を|本は|本が|本で|おすすめの本|良い本|いい本|書籍|サイト|動画|講座|読むべき|読めば|読んだら|勉強法|学び方|学習法|何で勉強|どう勉強|何を読|なにを読|教えて.*本|本.*教えて)/;
  if (!materialWord.test(text)) return null;
  // 出題・作問の依頼語と混ざるものは出題側に任せる（「読解の問題を出して」）
  if (/(出して|作って|作問|1問|一問|出題)/.test(text) && !/(本|教材|参考書|サイト|動画|講座)/.test(text)) return null;
  const domain = domainInText(text);
  const freeOnly = /(無料|タダ|ただで|フリー|お金をかけ)/.test(text);
  const kind_: MaterialKind | null = /(本|書籍|参考書|問題集|入門書)/.test(text) && !/(サイト|動画|講座)/.test(text)
    ? "book"
    : /(サイト|web|ウェブ)/i.test(lower)
      ? "web"
      : /(動画|youtube)/i.test(lower)
        ? "video"
        : /(講座|コース)/.test(text)
          ? "course"
          : null;
  return { kind: "materials", domain, text: text.slice(0, 200), freeOnly: freeOnly || undefined, kind_ };
}

export function classifyIntent(raw: string): Intent {
  const text = toHalfWidth(raw).trim();
  const lower = text.toLowerCase();
  // 短文（コマンド）か。長い自由文は部分一致で連携・ヘルプ扱いにしない（会話に回す）
  const short = text.length <= LINE.commandMaxChars;

  // 連携解除は「連携」を含む言い方に限定（「実績解除」などの文中の『解除』で発火させない）
  if (/連携\s*(を|は|の)?\s*(解除|やめ|外|切|取り消|とりけ)|^解除$|unlink/i.test(text)) return { kind: "unlink" };
  // 連携・ヘルプは短文か文頭一致だけ（「同期に勧められた本」「Pythonの辞書の使い方」は会話へ）
  if ((short && /(連携|リンク|link|同期|アカウント)/i.test(lower)) || /^(連携|リンク|link|アカウント連携)/i.test(lower)) return { kind: "link" };
  if (/^(help|ヘルプ|使い方|できること|\?|？)$/.test(lower) || (short && /使い方|ヘルプ|help/.test(lower)) || /^(使い方|ヘルプ|help)/.test(lower)) {
    return { kind: "help" };
  }
  // 出題中の課題をパス（ボタンを閉じてしまったときのテキスト版）
  if (/^(パス|ぱす|pass|スキップ|skip|飛ばして|とばして|パスして|パスで|スキップして)[!！。]?$/i.test(text)) return { kind: "pass" };
  if (/^(ヒント|ひんと|hint|ヒント(を|が)?(ちょうだい|ください|くれ|出して|ほしい|欲しい)|ヒントお願い(します)?|わからない|分からない|わかりません|分かりません|むずかしい|難しい|降参|ギブアップ)[!！。？?]?$/i.test(text)) return { kind: "hint" };
  // 教材のおすすめ（会話寄りの意図。疑問文でも拾う）。「今日のおすすめ」は従来どおり today
  const materials = parseMaterialsIntent(text);
  if (materials) return materials;

  // 難易度指定（「LOGICで難易度8」「難易度8」「logic 8」）は用意済みストックから即出題（quiz。±1 に無ければ handler 側で作問に切替）。
  // 「作って」「作問」など明示語があるときだけ LLM 作問（generate）。疑問文（「難易度8ってどのくらい？」）は会話へ
  const difficulty = parseDifficulty(text);
  if (difficulty !== null && !/(履歴|プロフィール|連携)/.test(text) && !isQuestionLike(text)) {
    const domain = domainInText(text);
    if (/(作って|つくって|作問|生成|新しい問題|新作|オリジナル)/.test(text)) {
      return { kind: "generate", request: text.slice(0, 300), domain, difficulty };
    }
    return { kind: "quiz", domain, difficulty };
  }
  // 「writeで軽めに」「やさしいのを1問」「難しめで」→ 推薦難易度から ∓2 した出題（指定難易度の文脈はリセット）。
  // 語形は出題向けのものに限定する（「やさしい人」「軽めの昼食」「難しい話」「簡単な質問」は拾わない）
  const easy = /(軽め|やさしめ|易しめ|やさしい(の|問題|やつ|ほう|方)|易しい(の|問題|やつ)|簡単な(問題|の|やつ|ほう)|かんたんな(問題|の)|入門|初級)/;
  const hard = /(難しめ|むずかしめ|難しい(の|問題|やつ|ほう|方)|むずかしい(の|問題|やつ)|歯ごたえ|ハードな|上級|骨のある)/;
  const delta = easy.test(text) ? -2 : hard.test(text) ? 2 : null;
  if (delta !== null && !/(履歴|プロフィール|連携)/.test(text) && !isQuestionLike(text)) {
    const domain = domainInText(text);
    if (domain || /(問題|1問|一問|出題|クイズ|やりたい|お願い|ちょうだい|で$|に$|の$)/.test(text)) {
      return { kind: "quiz", domain, difficultyDelta: delta };
    }
  }
  // LINE 上の出題（短いコマンド）。「READで1問」のように domain 付きも可
  const quizCmd = /^(出題|問題|1問|一問|クイズ|次の問題|もう1問|もう一問|次|もう一回|もう1回|今日の学習|今日の1問|今日の一問|今日の問題)(ください|して|お願い(します)?)?[!！。]?$/;
  const quizWithDomain = text.match(/^(read|write|logic|code|リード|ライト|ロジック|読解|作文|論理)\s*(で|の)?\s*(1問|一問|出題|問題|クイズ)/i);
  if (quizWithDomain) return { kind: "quiz", domain: domainOf(quizWithDomain[1]) };
  if (quizCmd.test(text)) return { kind: "quiz", domain: null };
  // 自由文の作問依頼（「論理パズルを出して」「短い読解を1問ください」）: 課題語 ＋（依頼動詞 or 文末が依頼形）の両方が要る。
  // 「仕事で問題が起きて疲れた」「昨日クイズ番組を見た」「お願いがあるんだけど」は会話へ
  const taskWord = /(問題|パズル|クイズ|読解|作文|1問|一問|課題|出題|作問|python|コード|論理)/i;
  const requestVerb = /(出して|だして|ちょうだい|お願い|作って|つくって|作問|出題して|ください|くれ|頼む|ほしい)/;
  const requestEnding = /(して|ください|お願い(します)?|ちょうだい|ほしい|くれ)[!！。]?$/;
  if (text.length >= 4 && taskWord.test(text) && (requestVerb.test(text) || requestEnding.test(text)) && !isQuestionLike(text)) {
    return { kind: "generate", request: text.slice(0, 300) };
  }

  if (/(read|リード|読(む|み|解)|読書)/i.test(lower) && !/書/.test(text)) return { kind: "domain", domain: "READ" };
  if (/(write|ライト|書(く|き)|作文|文章)/i.test(lower)) return { kind: "domain", domain: "WRITE" };
  if (/(logic|ロジック|論理|code|コード|プログラ|python|パイソン|バグ)/i.test(lower)) return { kind: "domain", domain: "CODE" };
  if (/(履歴|きろく|記録|ログ|これまで)/.test(text)) return { kind: "history" };
  if (/(プロフィール|profile|能力|実力|レベル(は|を)|レーダー|得意|苦手|分析|三角)/i.test(lower)) return { kind: "profile" };
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
    return { domain: least, reason: `最近${DOMAIN_META[most].label}が多かったので、今日は${DOMAIN_META[least].label}にしてみますか？` };
  }
  if (state.lastDomain) {
    const next = DOMAINS[(DOMAINS.indexOf(state.lastDomain) + 1) % DOMAINS.length];
    return { domain: next, reason: `前回は${DOMAIN_META[state.lastDomain].label}でした。今日は${DOMAIN_META[next].label}で切り口を変えてみましょう。` };
  }
  return { domain: "CODE", reason: "まずは短い論理問題から。3分で1問、様子を見てみましょう。" };
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
    "READ（読む）・WRITE（書く）・LOGIC（論理）の 3 つを、1 日 3 分・1 問ずつ。",
    "AI は答えを教えない。ヒントを一段ずつ出して、あなたが自分で次の一歩を踏み出すのを手伝うだけ。",
    "解いた記録は三角形の「能力プロフィール」になって、得意と伸ばしどころが見えてくるわ。",
    "",
    "▼ 始め方",
    "1. 「連携」と送って Web アカウントとつなぐ（記録が残る）",
    "2. 下のメニューの READ / WRITE / LOGIC を押すと、この場で 1 問",
    "3. 迷ったら「今日の学習」「軽めに」「難易度5」と送ってみて",
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
      "・「今日の学習」「1問」→ LINE 上で選択式を1問（連携が必要）。「パス」で記録に残さず次へ",
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
