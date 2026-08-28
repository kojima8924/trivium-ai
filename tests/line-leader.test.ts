// LINE の案内役（ADVISOR。内部キー LEADER）会話ロジック（純粋関数）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPostbackReply, buildReply, classifyIntent, domainOf, helpReply, quizOrWebActions, welcomeReply } from "../src/lib/line/leader";
import type { LeaderContext } from "../src/lib/line/leader";
import { detectAddressedAgent } from "../src/lib/persona.pure";
import { PERSONA_DEFAULTS } from "../src/config/trivium.config";

const APP = "https://trivium.example.com";

function ctx(over: Partial<LeaderContext> = {}): LeaderContext {
  return { state: {}, appUrl: APP, ...over };
}

test("意図分類: domain / 時間 / 連携 / 解除", () => {
  assert.equal(classifyIntent("READ").kind, "domain");
  assert.deepEqual(classifyIntent("コードやりたい"), { kind: "domain", domain: "CODE" });
  assert.deepEqual(classifyIntent("10分くらい何かやりたい"), { kind: "short_time", minutes: 10 });
  assert.deepEqual(classifyIntent("１０分だけ"), { kind: "short_time", minutes: 10 }); // 全角数字
  assert.equal(classifyIntent("軽くやりたい").kind, "short_time");
  assert.equal(classifyIntent("連携").kind, "link");
  assert.equal(classifyIntent("アカウント連携したい").kind, "link");
  assert.equal(classifyIntent("連携解除").kind, "unlink");
  assert.equal(classifyIntent("連携を外したい").kind, "unlink");
  assert.equal(classifyIntent("疲れた").kind, "tired");
  assert.equal(classifyIntent("履歴").kind, "history");
});

test("LINE 上では課題を解かせず、必ず Web へ誘導する", () => {
  for (const text of ["READ", "WRITE", "CODE", "今日のおすすめ", "10分だけ", "履歴", "プロフィール"]) {
    const r = buildReply(text, ctx());
    const uris = [...(r.quickReplies ?? []), ...(r.buttons?.actions ?? [])]
      .filter((a) => a.type === "uri")
      .map((a) => (a as { uri: string }).uri);
    assert.ok(uris.length > 0, `${text}: Web へのリンクが無い`);
    assert.ok(
      uris.every((u) => u.startsWith(APP)),
      `${text}: 自サイト以外のリンクがある`,
    );
  }
});

test("未連携: 連携を求めると、渡されたワンタイムURLを案内する", () => {
  const url = `${APP}/link/abc123`;
  const r = buildReply("連携", ctx({ linkUrl: url }));
  const uris = (r.buttons?.actions ?? []).filter((a) => a.type === "uri").map((a) => (a as { uri: string }).uri);
  assert.ok(uris.includes(url));
  assert.match(r.text, /連携/);
});

test("未連携: linkUrl が無ければ答えを詐称せず、やり直しを促す", () => {
  const r = buildReply("連携", ctx());
  assert.match(r.text, /もう一度/);
  assert.equal(r.buttons, undefined);
});

test("連携済み: 連携を求めても新しいURLは出さず、解除方法を案内する", () => {
  const r = buildReply("連携", ctx({ linked: true }));
  assert.match(r.text, /連携済み/);
  assert.match(r.text, /連携解除/);
});

test("連携済み: プロフィールで実際のスコアを返す（分析中の注記つき）", () => {
  const r = buildReply("プロフィール", {
    ...ctx({ linked: true }),
    leaderProfile: { summary: "CODEを強みにしています。", recommendation: "WRITEを1問", recommendedDomain: "WRITE" },
    scores: [
      { domain: "READ", score: 72, evidenceCount: 8, confidence: "high" },
      { domain: "WRITE", score: 57, evidenceCount: 2, confidence: "low" },
      { domain: "CODE", score: 79, evidenceCount: 10, confidence: "high" },
    ],
  });
  assert.match(r.text, /READ 72/);
  assert.match(r.text, /WRITE 57.0（分析中）/);
  assert.match(r.text, /CODE 79/);
  assert.match(r.text, /CODEを強みにしています。/);
});

test("未計測の domain はスコア行に出さない", () => {
  const r = buildReply("プロフィール", {
    ...ctx({ linked: true }),
    leaderProfile: { summary: "まだ暫定です。", recommendation: "", recommendedDomain: null },
    scores: [
      { domain: "READ", score: 0, evidenceCount: 0, confidence: "low" },
      { domain: "CODE", score: 60, evidenceCount: 4, confidence: "medium" },
    ],
  });
  assert.ok(!r.text.includes("READ 0"));
  assert.match(r.text, /CODE 60/);
});

test("連携済みなら Web 側の推薦 domain を優先する", () => {
  const r = buildReply("今日のおすすめ", {
    ...ctx({ linked: true }),
    state: { counts: { READ: 0, WRITE: 0, CODE: 5 } },
    leaderProfile: { summary: "s", recommendation: "WRITE: 明確さを1問", recommendedDomain: "WRITE" },
  });
  assert.equal(r.suggestedDomain, "WRITE");
  assert.match(r.text, /WRITE/);
});

test("未連携のときだけ、おすすめに連携の案内を添える", () => {
  const un = buildReply("今日のおすすめ", ctx());
  assert.match(un.text, /連携/);
  const linked = buildReply("今日のおすすめ", {
    ...ctx({ linked: true }),
    leaderProfile: { summary: "s", recommendation: "r", recommendedDomain: "READ" },
  });
  assert.ok(!linked.text.includes("（「連携」と送ると"));
});

test("解除の返信は解除前の状態に基づいて文面を変える", () => {
  assert.match(buildReply("連携解除", ctx({ linked: true })).text, /解除しました/);
  assert.match(buildReply("連携解除", ctx()).text, /まだ/);
});

test("postback: link / today / profile が対応する返信になる", () => {
  const url = `${APP}/link/xyz`;
  assert.match(buildPostbackReply("action=link", ctx({ linkUrl: url })).text, /連携/);
  assert.ok(buildPostbackReply("action=today", ctx()).suggestedDomain);
  assert.match(buildPostbackReply("action=profile", ctx()).text, /プロフィール|Dashboard/);
  assert.match(buildPostbackReply("action=unknown", ctx()).text, /できること/);
});

test("welcome / help は Web リンク付きで、答えを教えない旨を含む", () => {
  assert.match(welcomeReply(ctx()).text, /ヒント/);
  assert.ok((welcomeReply(ctx()).quickReplies ?? []).length > 0);
  assert.match(helpReply(ctx()).text, /連携/);
});

// ---- LINE 上の出題 / 作問（意図分類は純粋関数。実際の出題は webhook 側） ----

test("意図分類: 短いコマンドは quiz、自由文の依頼は generate", () => {
  assert.deepEqual(classifyIntent("1問"), { kind: "quiz", domain: null });
  assert.deepEqual(classifyIntent("出題して"), { kind: "quiz", domain: null });
  assert.deepEqual(classifyIntent("もう1問"), { kind: "quiz", domain: null });
  assert.deepEqual(classifyIntent("READで1問"), { kind: "quiz", domain: "READ" });
  assert.deepEqual(classifyIntent("論理 1問"), { kind: "quiz", domain: "CODE" });
  assert.equal(classifyIntent("論理パズルを出して").kind, "generate");
  assert.equal(classifyIntent("短い読解を1問ください").kind, "generate");
  assert.equal(classifyIntent("Pythonの問題を作って").kind, "generate");
  assert.equal((classifyIntent("論理パズルを出して") as { request: string }).request, "論理パズルを出して");
});

test("意図分類: generate より連携/解除/ヘルプが優先される", () => {
  assert.equal(classifyIntent("連携をお願い").kind, "link");
  assert.equal(classifyIntent("使い方を教えて").kind, "help");
});

test("domainOf: LOGIC/論理/code は内部キー CODE に写る", () => {
  assert.equal(domainOf("LOGIC"), "CODE");
  assert.equal(domainOf("論理"), "CODE");
  assert.equal(domainOf("code"), "CODE");
  assert.equal(domainOf("read"), "READ");
  assert.equal(domainOf("作文"), "WRITE");
  assert.equal(domainOf("xyz"), null);
});

test("domain の返信は「LINEで1問」(postback) と「Webで解く」(uri) の2択", () => {
  const r = buildReply("LOGIC", ctx());
  const kinds = (r.quickReplies ?? []).map((a) => a.type);
  assert.deepEqual(kinds, ["postback", "uri"]);
  const pb = r.quickReplies?.[0] as { data: string };
  assert.equal(pb.data, "action=quiz&domain=CODE");
  assert.equal(r.suggestedDomain, "CODE");
});

test("quizOrWebActions は domain ごとに正しい postback と URL を作る", () => {
  const a = quizOrWebActions(APP, "READ");
  assert.equal((a[0] as { data: string }).data, "action=quiz&domain=READ");
  assert.equal((a[1] as { uri: string }).uri, `${APP}/learn/read`);
  const b = quizOrWebActions(APP, "CODE");
  assert.equal((b[1] as { uri: string }).uri, `${APP}/learn/logic`);
});

test("ユーザー向け文言は CODE ではなく LOGIC", () => {
  for (const r of [welcomeReply(ctx()), helpReply(ctx()), buildReply("今日のおすすめ", ctx({ state: { counts: { READ: 3, WRITE: 3, CODE: 0 } } }))]) {
    assert.ok(!/CODE/.test(r.text), `CODE が残っている: ${r.text}`);
  }
  const labels = (welcomeReply(ctx()).quickReplies ?? []).map((a) => a.label);
  assert.ok(labels.includes("LOGICで1問"));
  assert.ok(labels.includes("まず1問"));
  assert.ok(labels.includes("使い方を見る"));
  assert.ok(labels.includes("連携する"));
  assert.match(welcomeReply(ctx()).text, /読み・書き・そろばん/);
});

test("quiz / generate を buildReply に直接渡しても壊れない（webhook が先に処理する前提の保険文言）", () => {
  assert.match(buildReply("1問", ctx()).text, /今日の学習/);
  assert.match(buildReply("パズルを出して", ctx()).text, /作問/);
});

// ---- 4 人格との会話: 宛先判定（webhook は unknown → chat に落とす。判定は persona-address の純粋関数） ----

test("宛先判定: 呼びかけで人格が決まり、無ければ null（案内役に回る）", () => {
  const p = PERSONA_DEFAULTS;
  assert.equal(detectAddressedAgent("ロゴス、順番の問題が苦手", p), "CODE");
  assert.equal(detectAddressedAgent("ヨミ、要旨ってどう掴む？", p), "READ");
  assert.equal(detectAddressedAgent("フミに聞きたいんだけど", p), "WRITE");
  assert.equal(detectAddressedAgent("ミチ、今日は何をやろう", p), "LEADER");
  assert.equal(detectAddressedAgent("眠いけど何かやりたい", p), null);
});

test("呼びかけ付きの文は意図分類が quiz/domain に当たっても、宛先判定で人格に届く（webhook は宛先を優先）", () => {
  // 「問題」「python」は出題/領域の語なので意図分類はコマンド寄りになるが、宛先があれば chat に回る
  assert.notEqual(classifyIntent("ロゴス、順番の問題が苦手").kind, "unknown");
  assert.equal(detectAddressedAgent("ロゴス、順番の問題が苦手", PERSONA_DEFAULTS), "CODE");
  // 宛先も定型コマンドも無い雑談は unknown → 案内役（LEADER）に回る
  assert.equal(classifyIntent("昨日の会議で言われたことがまだ引っかかってる").kind, "unknown");
  assert.equal(detectAddressedAgent("昨日の会議で言われたことがまだ引っかかってる", PERSONA_DEFAULTS), null);
});

// ---- 呼びかけ判定（persona.pure.ts）: 名前限定・部分一致なし ----

const PERSONAS = { READ: { name: "ヨミ" }, WRITE: { name: "フミ" }, CODE: { name: "ロゴス" }, LEADER: { name: "ミチ" } } as const;

test("呼びかけ: 出題・作問・領域の依頼は呼びかけ扱いにならない", () => {
  for (const t of ["論理パズルを出して", "READで1問", "LOGIC", "READ", "WRITE", "論理", "読む", "案内役に聞きたい"]) {
    assert.equal(detectAddressedAgent(t, PERSONAS), null, `${t} が呼びかけ扱いになっている`);
  }
});

test("呼びかけ: 名前＋区切り、名前＋に聞く、は呼びかけ", () => {
  assert.equal(detectAddressedAgent("ロゴス、これ教えて", PERSONAS), "CODE");
  assert.equal(detectAddressedAgent("ヨミに聞きたい", PERSONAS), "READ");
  assert.equal(detectAddressedAgent("フミさん これどう？", PERSONAS), "WRITE");
  assert.equal(detectAddressedAgent("ミチ", PERSONAS), "LEADER");
  assert.equal(detectAddressedAgent("logos, what do you think", PERSONAS), "CODE");
  assert.equal(detectAddressedAgent("今日はミチに相談したい", PERSONAS), "LEADER");
});

test("呼びかけ: 部分一致で誤爆しない", () => {
  for (const t of ["とけいがほしい", "already", "読むのが好き", "みちしるべを探す", "ふみきりを渡った", "よみがえる"]) {
    assert.equal(detectAddressedAgent(t, PERSONAS), null, `${t} が呼びかけ扱いになっている`);
  }
});

test("呼びかけ: ユーザーが改名した名前も拾う", () => {
  const renamed = { ...PERSONAS, CODE: { name: "タロウ" } };
  assert.equal(detectAddressedAgent("タロウ、教えて", renamed), "CODE");
  assert.equal(detectAddressedAgent("ロゴス、教えて", renamed), "CODE"); // 既定名も残す
});

test("意図分類: 「今日の学習」はおすすめではなく出題（quiz）", () => {
  assert.deepEqual(classifyIntent("今日の学習"), { kind: "quiz", domain: null });
  assert.deepEqual(classifyIntent("今日の1問"), { kind: "quiz", domain: null });
  assert.equal(classifyIntent("今日のおすすめ").kind, "today");
});

test("難易度指定はストックから即出題（quiz）。「作って」など明示語があるときだけ作問（generate）", () => {
  assert.deepEqual(classifyIntent("codeで難易度8"), { kind: "quiz", domain: "CODE", difficulty: 8 });
  assert.deepEqual(classifyIntent("LOGICで難易度8"), { kind: "quiz", domain: "CODE", difficulty: 8 });
  assert.deepEqual(classifyIntent("難易度８で出して"), { kind: "quiz", domain: null, difficulty: 8 });
  assert.deepEqual(classifyIntent("logic 10"), { kind: "quiz", domain: "CODE", difficulty: 10 });
  assert.deepEqual(classifyIntent("READのレベル3を1問"), { kind: "quiz", domain: "READ", difficulty: 3 });
  assert.deepEqual(classifyIntent("Lv5の論理パズル"), { kind: "quiz", domain: "CODE", difficulty: 5 });
  assert.deepEqual(classifyIntent("難易度8で作って"), { kind: "generate", request: "難易度8で作って", domain: null, difficulty: 8 });
  assert.deepEqual(classifyIntent("LOGICの難易度6を作問して"), { kind: "generate", request: "LOGICの難易度6を作問して", domain: "CODE", difficulty: 6 });
  assert.equal(classifyIntent("難易度4の新しい問題").kind, "generate");
  // 範囲外・数字だけは難易度扱いしない
  assert.equal(classifyIntent("難易度11").kind === "generate" && "difficulty" in classifyIntent("難易度11") && (classifyIntent("難易度11") as { difficulty?: number }).difficulty !== undefined, false);
  assert.equal(classifyIntent("10分だけ").kind, "short_time");
  assert.equal(classifyIntent("履歴").kind, "history");
});

test("「軽めに」「難しめ」は推薦難易度から ∓2 の出題（指定難易度の文脈はリセット）", () => {
  assert.deepEqual(classifyIntent("writeで軽めに"), { kind: "quiz", domain: "WRITE", difficultyDelta: -2 });
  assert.deepEqual(classifyIntent("やさしいのを1問"), { kind: "quiz", domain: null, difficultyDelta: -2 });
  assert.deepEqual(classifyIntent("難しめで"), { kind: "quiz", domain: null, difficultyDelta: 2 });
  assert.deepEqual(classifyIntent("LOGICで歯ごたえのある問題"), { kind: "quiz", domain: "CODE", difficultyDelta: 2 });
  // 会話文は拾わない
  assert.notEqual(classifyIntent("簡単に説明してほしいんだけど、二分探索って何？").kind, "quiz");
});

test("意図分類: 文中の『解除』『同期』『リンク』『使い方』では連携・ヘルプに化けない（会話へ）", () => {
  assert.notEqual(classifyIntent("実績解除うれしい").kind, "unlink");
  assert.notEqual(classifyIntent("ロゴス、ブロックの解除ってどうやるの？").kind, "unlink");
  assert.equal(classifyIntent("連携解除").kind, "unlink");
  assert.equal(classifyIntent("連携をやめたい").kind, "unlink");
  assert.notEqual(classifyIntent("同期に勧められた本を読んだ").kind, "link");
  assert.notEqual(classifyIntent("このリンク先の記事を読んだんだけど").kind, "link");
  assert.notEqual(classifyIntent("Googleアカウントの話なんだけど").kind, "link");
  assert.equal(classifyIntent("連携をお願い").kind, "link");
  assert.notEqual(classifyIntent("Pythonの辞書の使い方が分からない").kind, "help");
  assert.equal(classifyIntent("使い方").kind, "help");
  assert.equal(classifyIntent("使い方を教えて").kind, "help");
});

test("意図分類: 日常語の『問題』『クイズ』『お願い』『ちょうだい』は作問にならない", () => {
  assert.notEqual(classifyIntent("仕事で問題が起きて疲れた").kind, "generate");
  assert.equal(classifyIntent("仕事で問題が起きて疲れた").kind, "tired");
  assert.notEqual(classifyIntent("順番の問題が苦手なんだけどどうすれば").kind, "generate");
  assert.notEqual(classifyIntent("昨日クイズ番組を見た").kind, "generate");
  assert.notEqual(classifyIntent("お願いがあるんだけど").kind, "generate");
  assert.notEqual(classifyIntent("友達にちょうだいと言われた").kind, "generate");
  // 依頼はこれまで通り作問
  assert.equal(classifyIntent("論理パズルを出して").kind, "generate");
  assert.equal(classifyIntent("短い読解を1問ください").kind, "generate");
  assert.equal(classifyIntent("Pythonの問題を作って").kind, "generate");
  assert.equal(classifyIntent("論理パズルをお願い").kind, "generate");
  // 「読解の問題を〜」は用意済みストックからの出題（quiz）
});

test("意図分類: 『簡単』『難しい』『難易度N』を含む質問・感想は出題にならない", () => {
  assert.notEqual(classifyIntent("簡単な質問があります").kind, "quiz");
  assert.equal(classifyIntent("簡単なことでもやる気が出ない").kind, "tired");
  assert.notEqual(classifyIntent("この本は難しいけど読みたい").kind, "quiz");
  assert.notEqual(classifyIntent("やさしい人でした").kind, "quiz");
  assert.notEqual(classifyIntent("軽めの昼食にした").kind, "quiz");
  assert.notEqual(classifyIntent("難しい話を聞いた").kind, "quiz");
  assert.notEqual(classifyIntent("難易度8ってどのくらい？").kind, "quiz");
  assert.notEqual(classifyIntent("難易度5の問題ってどんな感じ？教えて").kind, "quiz");
  // 出題向けの言い方はこれまで通り
  assert.deepEqual(classifyIntent("簡単な問題を1問"), { kind: "quiz", domain: null, difficultyDelta: -2 });
  assert.deepEqual(classifyIntent("難しいのをお願い"), { kind: "quiz", domain: null, difficultyDelta: 2 });
  assert.deepEqual(classifyIntent("難易度8"), { kind: "quiz", domain: null, difficulty: 8 });
});

test("意図分類: 『パス』『スキップ』は pass", () => {
  assert.deepEqual(classifyIntent("パス"), { kind: "pass" });
  assert.deepEqual(classifyIntent("スキップ"), { kind: "pass" });
  assert.deepEqual(classifyIntent("飛ばして"), { kind: "pass" });
  assert.notEqual(classifyIntent("パスワードを忘れた").kind, "pass");
});

test("意図分類: 教材のおすすめ（materials）。疑問文でも拾い、「今日のおすすめ」は today のまま", () => {
  assert.deepEqual(classifyIntent("おすすめの本を教えて"), { kind: "materials", domain: null, text: "おすすめの本を教えて", freeOnly: undefined, kind_: "book" });
  assert.equal(classifyIntent("Pythonの教材を探してほしい").kind, "materials");
  assert.equal((classifyIntent("LOGICの無料サイトある？") as { domain: string | null }).domain, "CODE");
  assert.equal((classifyIntent("LOGICの無料サイトある？") as { freeOnly?: boolean }).freeOnly, true);
  assert.equal((classifyIntent("読解を鍛えるには何を読めばいい？") as { domain: string | null }).domain, "READ");
  assert.equal(classifyIntent("勉強法を教えて").kind, "materials");
  assert.equal(classifyIntent("今日のおすすめ").kind, "today");
  assert.equal(classifyIntent("おすすめ").kind, "today");
  assert.notEqual(classifyIntent("読解の問題を出して").kind, "materials");
});

test("「ヒント」「わからない」は hint 意図（出題中なら担当のヒント、出題中でなければ会話）", () => {
  for (const t of ["ヒント", "ヒントちょうだい", "わからない", "分かりません", "難しい"]) assert.equal(classifyIntent(t).kind, "hint", t);
  assert.notEqual(classifyIntent("難しめで").kind, "hint");
  assert.notEqual(classifyIntent("ヒントの出し方を教えて").kind, "hint");
});

test("「僕の能力は？」「今の実力は」はプロフィール", () => {
  for (const t of ["僕の能力は？", "今の実力は", "私の三角形を見せて"]) assert.equal(classifyIntent(t).kind, "profile", t);
});
