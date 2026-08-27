// =====================================================================
// Trivium の「運営者が触る設定」を 1 か所に集めたファイル。
//   - ここを書き換えて再デプロイすれば反映される（DB は不要）
//   - 秘密情報（API キー等）はここに書かない。.env / Coolify の環境変数で渡す
//   - ユーザーごとの上書き（人格の名前・口調など）は /settings で DB に保存され、こちらより優先される
// 章立て:
//   1. AI モデル（役割ごと）
//   2. 人格（4 エージェントの既定と口調プリセット）
//   3. 難易度と採点（三系統ベクトル・到達レベル）
//   4. XP・デイリーミッション・ランク（ゲーミフィケーション）
//   5. 推薦書籍・サイト
//   6. LINE の振る舞い（push の頻度・会話の自由度）
//   7. 検索・日時などの外部情報の扱い
// =====================================================================

export type AxisKey = "read" | "write" | "logic";

// ---------------------------------------------------------------------
// 1. AI モデル（役割ごと）。OpenAI のモデル ID を書く。
//    採点・寸評・会話は速さ重視、作問は品質重視。
// ---------------------------------------------------------------------
export const MODELS = {
  /** 回答の評価・一段ヒント（速さ重視） */
  evaluate: "gpt-5.4-mini",
  /** 系統ごとの寸評・観察メモの更新 */
  interpret: "gpt-5.4-mini",
  /** 案内役（LEADER）の総合寸評 */
  leader: "gpt-5.4-mini",
  /** LINE の会話（人格ごと。検索ツールを使うことがある） */
  chat: "gpt-5.4-mini",
  /** 作問（品質重視。やや高級なモデル） */
  generate: "gpt-5.5",
  /** 推論の深さ: none | minimal | low | medium | high（速さと質のトレードオフ） */
  reasoningEffort: { evaluate: "low", interpret: "low", leader: "low", chat: "low", generate: "low" } as const,
} as const;

// ---------------------------------------------------------------------
// 2. 人格
//    tone は TONE_PRESETS のキー。extra は自由記述（口癖・スタンス）。
//    LINE で「アオイ、〜」のように名前で呼ぶとその人格が応答する。
// ---------------------------------------------------------------------
export const TONE_PRESETS = {
  polite: { label: "丁寧", prompt: "落ち着いた敬体。相手を急かさず、短い問いで考えを引き出す" },
  casual: { label: "フランク", prompt: "くだけた話し言葉（です・ます は少なめ）。軽やかだが茶化さない" },
  senior: { label: "先輩", prompt: "少し先を歩く先輩の口調。経験談を一言だけ添え、答えは渡さない" },
  coach: { label: "コーチ", prompt: "簡潔で前向き。事実→次の一手の順で話し、感情表現は控えめ" },
  tsundere: {
    label: "ツンデレ",
    prompt:
      "最初はそっけなく突き放す（『別にあなたのためじゃないけど』）が、要所で不器用に励ます。皮肉は軽く、相手を傷つけない。学習の中身については誠実で、ヒントの出し方は他の人格と同じ",
  },
  cool: { label: "クール", prompt: "感情を出さず淡々と。短文。事実と手順だけを述べ、褒め言葉は最小限で重みを持たせる" },
  cheerful: { label: "元気", prompt: "明るくテンション高め。感嘆符は1文に1つまで。失敗も前向きに言い換える" },
  strict: { label: "厳格", prompt: "きびしめの指導者。甘やかさないが公平。できた点は必ず1つ認める" },
  mentor: { label: "メンター", prompt: "経験豊富で穏やか。問いを重ねて本人に気づかせる。急がせない" },
  playful: { label: "おちゃめ", prompt: "遊び心のあるたとえ話を1つ入れる。ただし本題から逸れない" },
  scholar: { label: "学者", prompt: "用語を正確に使い、根拠を一言添える。やや硬いが親切" },
  buddy: { label: "相棒", prompt: "同じ目線の仲間。『一緒に考えよう』のスタンス。上から言わない" },
} as const;
export type ToneKey = keyof typeof TONE_PRESETS;

export type PersonaDefault = {
  agent: "READ" | "WRITE" | "CODE" | "LEADER";
  name: string;
  tone: ToneKey;
  firstPerson: string;
  extra: string;
  /** 呼びかけに使う別名。名前系（けい/kei 等）だけが呼びかけ判定に使われ、領域語（READ/論理 等）は出題・作問の意図を優先するため無視される */
  aliases: string[];
};

export const PERSONA_DEFAULTS: Record<"READ" | "WRITE" | "CODE" | "LEADER", PersonaDefault> = {
  READ: {
    agent: "READ",
    name: "アオイ",
    tone: "polite",
    firstPerson: "私",
    extra: "文章の根拠を本文の言葉で確かめさせる",
    aliases: ["あおい", "aoi", "READ", "リード", "読む"],
  },
  WRITE: {
    agent: "WRITE",
    name: "フミ",
    tone: "senior",
    firstPerson: "わたし",
    extra: "書き手の主張を尊重し、構成と根拠だけを問う",
    aliases: ["ふみ", "fumi", "WRITE", "ライト", "書く"],
  },
  CODE: {
    agent: "CODE",
    name: "ケイ",
    tone: "coach",
    firstPerson: "僕",
    extra: "値を一つずつ追わせる。答えは絶対に言わない",
    aliases: ["けい", "kei", "LOGIC", "ロジック", "論理"],
  },
  LEADER: {
    agent: "LEADER",
    name: "リード",
    tone: "tsundere",
    firstPerson: "私",
    extra: "3領域を横断して見る案内役。数字は集計値だけを使い、最後は必ず次の一歩を1つ示す",
    aliases: ["りーど", "lead", "LEADER", "案内役", "リーダー"],
  },
};

// ---------------------------------------------------------------------
// 3. 難易度と採点
//    - 難易度は系統ごとに 1〜10
//    - 各課題は難易度ベクトル { read, write, logic }（0 = その系統に無関係）を持つ
//    - 成功は関与する全系統に加点、失敗は「相対的に最も難しい系統」だけに減点
//    - 到達レベル: 難易度 d 以上での正答率が threshold を超える最大の d（それ未満は 100% とみなす）
// ---------------------------------------------------------------------
export const SCORING = {
  /** 到達レベル判定の正答率しきい値 */
  masteryThreshold: 0.7,
  /** レベル判定に必要な最小の証拠量（新しさ重みつきの件数） */
  minEvidence: 1.5,
  /** 新しさ重みの半減期（日）。古い記録ほど効きが弱くなる */
  recencyHalfLifeDays: 14,
  /** ヒント回数による基礎点（成功時）。index = ヒント回数 */
  successBase: [1.0, 0.8, 0.6, 0.5],
  /** 失敗時の基礎点 */
  failureBase: 0.2,
  /** 信頼度の境界（証拠件数） */
  confidence: { medium: 3, high: 8 },
  /** 失敗を「その難易度付近の否定」として扱う幅（d_A - level ≤ この値の系統だけ減点） */
  failureWindow: 1,
} as const;

// 課題の類型（1 要素×3・2 要素×3・3 要素×1）。作問時の配分に使う
export const TASK_TYPES = [
  { key: "read", axes: ["read"], label: "READ 単独" },
  { key: "write", axes: ["write"], label: "WRITE 単独" },
  { key: "logic", axes: ["logic"], label: "LOGIC 単独" },
  { key: "read+write", axes: ["read", "write"], label: "読んで書く（要約・反論）" },
  { key: "read+logic", axes: ["read", "logic"], label: "読んで検証する（推論の穴）" },
  { key: "write+logic", axes: ["write", "logic"], label: "手順を書く（説明・設計）" },
  { key: "read+write+logic", axes: ["read", "write", "logic"], label: "読み・検証し・書く" },
] as const;

// ---------------------------------------------------------------------
// 4. XP・デイリーミッション・ランク
//    XP は「行動」の積み上げ（能力の三角形とは別の指標）。決定論で計算する。
// ---------------------------------------------------------------------
export const XP = {
  /** 1 課題の基礎 XP = perDifficultyPoint × 難易度ベクトルの合計 */
  perDifficultyPoint: 10,
  /** ヒント回数による倍率（成功時）。index = ヒント回数 */
  hintMultiplier: [1.0, 0.8, 0.6, 0.5],
  /** 失敗しても取り組んだ分の XP（倍率） */
  failureMultiplier: 0.25,
  /** LLM が作った課題に取り組んだときの倍率（少し高め） */
  generatedTaskMultiplier: 1.2,
  /** デイリーミッション（READ / WRITE / LOGIC を 1 問ずつ）の達成ボーナス */
  dailyMissionBonus: 50,
  /** 連続達成（streak）1 日あたりのボーナス（上限あり） */
  streakBonusPerDay: 10,
  streakBonusMax: 100,
  /** ランク（総合 XP のしきい値）。上から順に判定 */
  ranks: [
    { min: 5000, title: "Trivium Master", short: "MASTER" },
    { min: 3000, title: "Rhetor（修辞家）", short: "RHETOR" },
    { min: 1500, title: "Logician（論理家）", short: "LOGICIAN" },
    { min: 700, title: "Grammarian（文法家）", short: "GRAMMARIAN" },
    { min: 250, title: "Apprentice（見習い）", short: "APPRENTICE" },
    { min: 0, title: "Novice（初学者）", short: "NOVICE" },
  ],
  /** ミッションの締め（JST）。日付境界に使う */
  timezone: "Asia/Tokyo",
} as const;

// ---------------------------------------------------------------------
// 5. 推薦書籍・サイト
//    デイリーミッション達成時などに、弱い系統に合わせて 1 件を LLM が「この中から」選ぶ。
//    LLM に書名を作らせない（架空の本が出るため）。URL は壊れにくい検索リンク。
// ---------------------------------------------------------------------
export type Recommendation = {
  axis: AxisKey;
  title: string;
  author: string;
  note: string; // 一言（40 字以内）
  url: string;
  kind: "book" | "site";
  /** 有料サイト等はここに明記 */
  paid?: boolean;
};

const bookSearch = (q: string) => `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(q)}`;

export const RECOMMENDATIONS: Recommendation[] = [
  // READ
  { axis: "read", title: "論理トレーニング101題", author: "野矢茂樹", note: "接続詞と論証の骨格を読む練習", url: bookSearch("論理トレーニング101題 野矢茂樹"), kind: "book" },
  { axis: "read", title: "大人のための国語ゼミ", author: "野矢茂樹", note: "要旨をつかむ・反論を読む基礎", url: bookSearch("大人のための国語ゼミ 野矢茂樹"), kind: "book" },
  { axis: "read", title: "知的複眼思考法", author: "苅谷剛彦", note: "常識を疑う読み方・複数視点", url: bookSearch("知的複眼思考法 苅谷剛彦"), kind: "book" },
  // WRITE
  { axis: "write", title: "理科系の作文技術", author: "木下是雄", note: "結論から書く・一文一義", url: bookSearch("理科系の作文技術 木下是雄"), kind: "book" },
  { axis: "write", title: "日本語の作文技術", author: "本多勝一", note: "読点と語順で明確さを作る", url: bookSearch("日本語の作文技術 本多勝一"), kind: "book" },
  { axis: "write", title: "「超」文章法", author: "野口悠紀雄", note: "メッセージを1つに絞る構成術", url: bookSearch("超文章法 野口悠紀雄"), kind: "book" },
  // LOGIC
  { axis: "logic", title: "プログラムはなぜ動くのか", author: "矢沢久雄", note: "手順を追う感覚を土台から", url: bookSearch("プログラムはなぜ動くのか 矢沢久雄"), kind: "book" },
  { axis: "logic", title: "問題解決力を鍛える！アルゴリズムとデータ構造", author: "大槻兼資・秋葉拓哉", note: "手順の設計を体系的に", url: bookSearch("問題解決力を鍛える アルゴリズムとデータ構造 大槻"), kind: "book" },
  { axis: "logic", title: "AtCoder（競技プログラミング）", author: "AtCoder株式会社", note: "短い問題で手順設計を反復（無料）", url: "https://atcoder.jp/", kind: "site" },
  { axis: "logic", title: "Python チュートリアル（公式）", author: "Python Software Foundation", note: "出力予測の基礎を正確に", url: "https://docs.python.org/ja/3/tutorial/", kind: "site" },
];

// ---------------------------------------------------------------------
// 6. LINE の振る舞い
// ---------------------------------------------------------------------
export const LINE = {
  /** 1 問ごとの push は Lv 変化と XP だけ。系統の人格と案内役の寸評は、決着した問題数がこの倍数のときだけ添える */
  commentEvery: 5,
  /** これより長い自由文は（出題・作問・連携などのコマンドを除き）ルールベースではなく人格との会話に回す */
  commandMaxChars: 12,
  /** 会話の返答の長さの目安（文の数） */
  chatMaxSentences: 5,
} as const;

// ---------------------------------------------------------------------
// 7. 外部情報（日時・検索）
// ---------------------------------------------------------------------
export const EXTERNAL = {
  /** すべての prompt に現在日時（JST）を入れる */
  includeDateTime: true,
  /** Web 検索を許可する経路。採点・寸評には持たせない（速度と一貫性のため） */
  webSearchAllowed: { chat: true, generate: true, evaluate: false, interpret: false, leader: false },
  /** 検索は最大何回まで */
  webSearchMaxUses: 2,
  /** LINE 会話で記憶する往復数 */
  chatHistoryTurns: 10,
  /** 系統エージェントの観察メモの上限（文字） */
  agentMemoryMaxChars: 400,
} as const;
