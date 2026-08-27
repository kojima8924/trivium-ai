// 問題ストック生成・検証スクリプト
//
//   npx tsx scripts/stock/gen_stock.mts                 # 3 系統すべて（difficulty 1〜10）
//   npx tsx scripts/stock/gen_stock.mts --domain code   # 1 系統だけ
//   npx tsx scripts/stock/gen_stock.mts --emit-only     # 生成せず out/*.json から .generated.ts を書き出す
//
// 生成: OpenAI Responses API（MODELS.generate 相当の gpt-5.5）。
// 検証（合格したものだけ採用）:
//   - 構造: 4 択・重複なし・answer_index 0..3・hints 3 段・explanation あり・コードフェンス無し
//   - Python 出力予測: ローカルの python で実際に実行し、正解の選択肢と照合（別の選択肢が一致すれば index を修正、どれも一致しなければ不採用）
//   - それ以外の 4 択: 正解を伏せた独立ソルバー（gpt-5.5）が同じ答えに到達し、曖昧さ・ヒントの答えバレが無いこと
//   - WRITE の自由記述: レビュー担当（gpt-5.4-mini）が 5 段階で 4 以上
// 進捗は scripts/stock/out/<DOMAIN>.json にチェックポイントし、再実行時は済んだスロットを飛ばす。
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- 設定 ----
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(HERE, "out");
const STOCK_DIR = path.join(ROOT, "src/lib/tasks/stock");
const GEN_MODEL = "gpt-5.5";
const SOLVER_MODEL = "gpt-5.5";
const REVIEW_MODEL = "gpt-5.4-mini";
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 3;

type Domain = "READ" | "WRITE" | "CODE";
type Kind = "choice" | "short" | "free";
type SubType = "choice" | "free" | "python" | "logic";

const SUBSKILLS: Record<Domain, string[]> = {
  READ: ["comprehension", "inference", "critical_reading"],
  WRITE: ["structure", "clarity", "reasoning", "revision"],
  CODE: ["tracing", "debugging", "algorithms", "design"],
};

/** 難易度ごとのスロット数（系統 × サブタイプ） */
const PLAN: Record<Domain, Partial<Record<SubType, number>>> = {
  READ: { choice: 5 },
  WRITE: { choice: 4, free: 2 },
  CODE: { python: 3, logic: 3 },
};

// 題材のばらつき用（index で回す）
const THEMES = [
  "市立図書館の利用", "商店街の活性化", "天気予報の精度", "部活動の練習方法", "スマートフォンの使い方", "宇宙開発の費用", "発酵食品の歴史",
  "地方鉄道の存続", "睡眠の研究", "リサイクルの仕組み", "音楽の配信サービス", "農業とドローン", "機械翻訳", "在宅勤務", "地図の歴史",
  "都市の緑化", "昆虫食", "博物館の展示", "手紙と電子メール", "自転車通勤", "学校の制服", "災害への備え", "コンビニの24時間営業",
  "観光地の混雑", "水道の老朽化", "紙の辞書と電子辞書", "ボードゲームの流行", "祭りの担い手不足", "電気自動車", "子どもの読書時間",
];
const PY_TOPICS = [
  "変数と算術・文字列連結", "for とリストの合計", "if/elif の分岐", "リストのスライス", "文字列メソッド（split/join/upper）", "辞書のカウント",
  "while と累積", "ネストしたループ", "関数と戻り値", "sorted と key", "リスト内包表記", "set の演算", "再帰（階乗・フィボナッチ）",
  "enumerate と zip", "文字列の反転・回文", "辞書の更新と get", "例外処理（try/except）", "クロージャ・デフォルト引数", "ジェネレータと next",
  "スタック/キューの操作", "2 次元リスト", "整数の割り算・剰余", "タプルのアンパック", "range のステップ", "文字コード ord/chr", "collections.Counter",
  "itertools（product/combinations）", "ソートの安定性", "浅いコピーと参照", "文字列のフォーマット",
];
const LOGIC_TOPICS = [
  "3 人の並び順の推理", "4〜5 人の座席の割り当て", "騎士と悪党（正直者と嘘つき）", "表を使った対応づけ（人・色・飲み物）", "日程の制約からの特定",
  "対偶・逆・裏の判定", "必要条件と十分条件", "手順の最短化（川渡り・移し替え）", "数量の推理（重さ比べ・天秤）", "カレンダーと曜日の推理",
  "部屋割りの制約", "スケジュールの矛盾探し", "集合とベン図", "順位と得点の整合", "トーナメントの勝敗推理", "真偽の発言からの犯人特定",
  "条件付きの数え上げ", "偽物のコインを見つける", "地図・方角の推理", "ルールに従う数列",
];
const WRITE_TOPICS = [
  "接続詞の選択", "文の順序の並べ替え", "主張と根拠の対応", "冗長な語の削除", "一文一義への分割", "指示語の明確化", "段落の要約文",
  "反論への応答", "定義を先に置く構成", "具体例の選び方", "結論を先に述べる書き換え", "曖昧な表現の修正", "比較の対象をそろえる",
  "因果関係の書き方", "読み手に合わせた語の選択",
];

function difficultyGuide(domain: Domain, sub: SubType, d: number): string {
  if (domain === "READ") {
    if (d <= 2) return "本文 60〜120 字の平易な文。設問は要旨や事実の確認。";
    if (d <= 4) return "本文 120〜200 字。書かれていないことの自然な推論、または主張と理由の区別。";
    if (d <= 6) return "本文 200〜320 字。対比・因果・譲歩（しかし／ただし）を含み、筆者の立場を読み取る。";
    if (d <= 8) return "本文 320〜450 字の論説調。暗黙の前提・反例・論理の飛躍を見抜く批判的読解。";
    return "本文 450〜600 字。複数の立場が交錯し、根拠の強さや前提の妥当性を比較して判断する。";
  }
  if (domain === "WRITE") {
    if (sub === "free") {
      if (d <= 3) return "身近なお題に 60〜100 字で意見と理由を 1 つ書く（模範解答も 60〜100 字）。";
      if (d <= 6) return "100〜160 字。主張・理由・具体例の 3 要素を求める（模範解答も同じ字数）。";
      return "150〜240 字。反対意見への応答を含めた構成、または条件付きの結論を求める（模範解答も同じ字数）。";
    }
    if (d <= 3) return "1〜2 文の短い文について、最も明確／自然な書き方を選ぶ。";
    if (d <= 6) return "3〜5 文の段落について、順序・接続詞・主張と根拠の対応を問う。";
    return "段落全体の構成や論理の欠陥（根拠の飛躍・二重基準・曖昧な定義）を見抜く。";
  }
  if (sub === "python") {
    if (d <= 2) return "1〜6 行。変数・算術・文字列連結・単純な print。";
    if (d <= 4) return "6〜10 行。for/if・リストの基本操作。";
    if (d <= 6) return "8〜14 行。辞書・スライス・文字列メソッド・while・関数。";
    if (d <= 8) return "12〜18 行。ネスト・再帰・sorted の key・内包表記・状態更新の追跡。";
    return "15〜22 行。クロージャ／ジェネレータ／参照の共有／複合的な状態変化。エッジケースが効く。";
  }
  if (d <= 2) return "要素 3 つ・条件 2 つ程度で一意に決まる。";
  if (d <= 4) return "要素 4〜5 つ・条件 3〜4 つ。";
  if (d <= 6) return "真偽者や表の整理が必要。条件 4〜5 つ。";
  if (d <= 8) return "複数の制約の同時充足。場合分けが 2〜3 通り必要。";
  return "多段の推論と排反なケース分析。うっかり見落とす条件を 1 つ含める。解くのに慣れた人でも数分かかる密度にする（条件 6〜8 個、要素 5〜6 個）。";
}

// ---- OpenAI ----
const envText = readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = envText
  .split(/\r?\n/)
  .find((l) => l.startsWith("OPENAI_API_KEY="))
  ?.slice("OPENAI_API_KEY=".length)
  .trim()
  .replace(/^"|"$/g, "");
if (!apiKey) throw new Error("OPENAI_API_KEY not found in .env");
const client = new OpenAI({ apiKey });

const genSchema = z.object({
  title: z.string(),
  passage: z.string(),
  prompt: z.string(),
  choices: z.array(z.string()),
  answer_index: z.number().int(),
  rubric_criteria: z.array(z.string()),
  /** free 用: 答案に含まれていれば加点するキーワード（3〜6 個） */
  must_include: z.array(z.string()),
  /** free 用: 模範解答（字数の基準になる。学習者には成功後に参考例として見せる） */
  model_answer: z.string(),
  hints: z.array(z.string()),
  explanation: z.string(),
  skill_tags: z.array(z.string()),
});
type Gen = z.infer<typeof genSchema>;

const solveSchema = z.object({
  answer_index: z.number().int(),
  confidence: z.number(),
  difficulty_rating: z.number().int(),
  ambiguous: z.boolean(),
  hints_leak_answer: z.boolean(),
  note: z.string(),
});
const reviewSchema = z.object({ score: z.number().int(), issues: z.string() });

const GEN_ROLE = [
  "あなたは学習サービス Trivium（READ / WRITE / LOGIC の 3 系統）の出題者。指定の系統・形式・難易度で、日本語の課題を 1 問作る。",
  "- 問題は自己完結で、passage と prompt だけで解ける。実在の個人・時事の断定・医療/法律の助言を避ける。",
  "- choice は選択肢 4 つ。正解は 1 つだけで、他の 3 つは明確に誤り（ただし『ありそうな誤り』にする）。選択肢どうしは文言も内容も重複させない。",
  "- free は rubric_criteria（採点観点 3〜5 個）と must_include（答案に含まれていれば加点する語 3〜6 個。お題に直結する具体語）と model_answer（お題に対する模範解答。prompt で求める字数の範囲内で実際に書く）を書き、choices は空、answer_index は 0。prompt に書く字数指定は model_answer の長さと整合させる（模範解答より長い字数を要求しない）。",
  "- free 以外では model_answer は空文字。",
  "- バッククォート（`）を使わない。",
  "- hints は 3 段。1 段目は問い返し、2 段目は着眼点、3 段目でも答えの値・完成文・正解の選択肢を書かない。",
  "- explanation は正解した後に見せる解説（正解の根拠を簡潔に）。",
  "- title は 20 字以内。系統名の接頭辞（『LOGIC:』など）は付けない。",
  "- 改行は実際の改行で書く（文字列として \\n と書かない）。マークダウンのコードフェンス（```）や装飾を使わない。",
  "- Python の出力予測問題: passage はコードのみ（説明文を混ぜない）。標準ライブラリのみ、input()・乱数・時刻・ファイル・ネットワークを使わない。必ず print で決定的な出力を出す。正解の選択肢は print の出力そのまま（Python の表記: 文字列はシングルクォート、複数行は改行で区切る）。コードを一行ずつ実行して確かめてから答えを決める。",
  "- 論理パズル: プログラムコードを使わない。条件から一意に答えが決まることを確認する。",
  "- skill_tags は allowed_skill_tags から 1〜2 個。",
].join("\n");

const SOLVER_ROLE = [
  "あなたは慎重な解答者。与えられた課題を自力で解き、answer_index（0..3）で答える。",
  "- 根拠を一つずつ確かめ、複数の選択肢が正しく読める／どれも正しくない場合は ambiguous=true にして note に理由を書く。",
  "- difficulty_rating は 1（小学校高学年でも解ける）〜10（大学上級・専門家向け）で、この課題の難しさを評価する。",
  "- hints（段階ヒント）を読み、答えの値・正解の選択肢がそのまま書かれていれば hints_leak_answer=true。",
  "- confidence は 0〜1。",
].join("\n");

const REVIEW_ROLE = [
  "あなたは作文課題のレビュー担当。お題（passage / prompt）と採点観点（rubric）を読み、学習課題としての質を 1〜5 で採点する。",
  "5: お題が明確で、指定の字数・要素が妥当、観点が採点に使える、模範解答がお題と字数指定を満たしている。3: 一部曖昧、または模範解答が字数指定から外れている。1: 何を書けばよいか分からない、または不適切。",
  "issues に問題点を簡潔に（無ければ空文字）。",
].join("\n");

function fmt(tag: string, v: unknown): string {
  return `<${tag}>\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n</${tag}>`;
}

async function parse<T extends z.ZodTypeAny>(
  model: string,
  instructions: string,
  input: string,
  schema: T,
  name: string,
  effort: "low" | "medium" | "high",
  maxTokens: number,
): Promise<z.infer<T>> {
  const res = await client.responses.parse({
    model,
    instructions,
    input,
    text: { format: zodTextFormat(schema, name) },
    reasoning: { effort },
    max_output_tokens: maxTokens,
    store: false,
  });
  const parsed = res.output_parsed as z.infer<T> | null | undefined;
  if (!parsed) throw new Error(`parse failed (${res.status ?? "?"})`);
  return parsed;
}

// ---- 生成 ----
type Slot = { domain: Domain; sub: SubType; difficulty: number; n: number };

function slotKey(s: Slot): string {
  return `${s.domain}:${s.sub}:${s.difficulty}:${s.n}`;
}
function slotId(s: Slot, seq: number): string {
  return `${s.domain.toLowerCase()}-s${s.difficulty}-${String(seq).padStart(2, "0")}`;
}
function kindOf(sub: SubType): Kind {
  return sub === "free" ? "free" : "choice";
}
function themeFor(s: Slot, attempt: number): string {
  const i = (s.difficulty * 7 + s.n * 3 + attempt * 11) % 1000;
  if (s.domain === "READ") return THEMES[i % THEMES.length];
  if (s.domain === "WRITE") return s.sub === "free" ? THEMES[(i + 5) % THEMES.length] : WRITE_TOPICS[i % WRITE_TOPICS.length];
  return s.sub === "python" ? PY_TOPICS[i % PY_TOPICS.length] : LOGIC_TOPICS[i % LOGIC_TOPICS.length];
}

async function generate(s: Slot, attempt: number, recentTitles: string[]): Promise<Gen> {
  const kind = kindOf(s.sub);
  const form =
    s.sub === "python" ? "Python の短いコードの出力予測（passage にコードのみ）" : s.sub === "logic" ? "論理パズル・推論問題（コード不可）" : kind === "free" ? "自由記述（rubric 付き）" : "4 択";
  const user = [
    fmt("domain", `${s.domain}（${s.domain === "CODE" ? "LOGIC" : s.domain}）`),
    fmt("kind", kind),
    fmt("form", form),
    fmt("difficulty", `${s.difficulty} / 10 — ${difficultyGuide(s.domain, s.sub, s.difficulty)}`),
    fmt("theme_hint", `${themeFor(s, attempt)}（題材の参考。無理に使わなくてよい）`),
    fmt("allowed_skill_tags", SUBSKILLS[s.domain]),
    fmt("recent_titles", recentTitles.slice(-40)),
  ].join("\n\n");
  return parse(GEN_MODEL, GEN_ROLE, user, genSchema, "generated_task", s.sub === "python" || s.sub === "logic" ? "medium" : "low", s.difficulty >= 8 ? 12000 : 6000);
}

// ---- 検証 ----
function normalizeOutput(s: string): string {
  return s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/"/g, "'")
    .replace(/\s+/g, "");
}
function nl(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "    ").replace(/\r/g, "").trim();
}

function runPython(code: string): { stdout: string } | { error: string } {
  const r = spawnSync("python", ["-I", "-c", code], {
    timeout: 5000,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    cwd: OUT_DIR,
  });
  if (r.error) return { error: r.error.message };
  if (r.status !== 0) return { error: (r.stderr || "").slice(-300) };
  return { stdout: r.stdout };
}

type Verified = { ok: true; gen: Gen; rating?: number } | { ok: false; reason: string };

async function verify(s: Slot, g0: Gen): Promise<Verified> {
  const g: Gen = { ...g0, title: nl(g0.title), passage: nl(g0.passage), prompt: nl(g0.prompt), explanation: nl(g0.explanation), choices: g0.choices.map(nl), hints: g0.hints.map(nl) };
  const kind = kindOf(s.sub);
  if (/`/.test(g.title + g.passage + g.prompt + g.choices.join("") + g.hints.join("") + g.explanation)) return { ok: false, reason: "backtick" };
  if (g.hints.length !== 3 || g.hints.some((h) => h.length < 4)) return { ok: false, reason: "hints" };
  if (g.explanation.length < 10) return { ok: false, reason: "explanation" };
  if (!g.prompt) return { ok: false, reason: "prompt empty" };
  g.title = g.title.replace(/^\s*(READ|WRITE|LOGIC|CODE)\s*[:：]\s*/i, "").slice(0, 40);
  g.skill_tags = g.skill_tags.filter((t) => SUBSKILLS[s.domain].includes(t));
  if (g.skill_tags.length === 0) g.skill_tags = [SUBSKILLS[s.domain][0]];

  if (kind === "free") {
    if (g.rubric_criteria.length < 3) return { ok: false, reason: "rubric" };
    if (g.must_include.filter(Boolean).length < 2) return { ok: false, reason: "must_include" };
    g.choices = [];
    g.model_answer = nl(g.model_answer);
    const len = g.model_answer.length;
    const [lo, hi] = s.difficulty <= 3 ? [40, 130] : s.difficulty <= 6 ? [70, 200] : [110, 300];
    if (len < lo || len > hi) return { ok: false, reason: `model_answer length ${len} (want ${lo}〜${hi})` };
    // ヒントがそのまま提出できる完成解になっていないか（tests/tasks.test.ts と同じ判定: 字数が範囲内・must_include 2 語以上・疑問文でない）
    {
      const n0 = g.model_answer.length;
      const minL = Math.max(30, Math.round(n0 * 0.6));
      const maxL = Math.max(minL + 40, Math.round(n0 * 1.6));
      for (const h of g.hints) {
        const hl = [...h].length;
        const hits = g.must_include.filter((w) => w && h.includes(w)).length;
        if (hl >= minL && hl <= maxL && hits >= 2 && !/[？?]\s*$/.test(h)) return { ok: false, reason: "hint looks like a full answer" };
      }
    }
    const r = await parse(
      REVIEW_MODEL,
      REVIEW_ROLE,
      [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("rubric", g.rubric_criteria), fmt("model_answer", g.model_answer)].join("\n\n"),
      reviewSchema,
      "review",
      "low",
      400,
    );
    if (r.score < 4) return { ok: false, reason: `review ${r.score}: ${r.issues.slice(0, 80)}` };
    return { ok: true, gen: g };
  }

  if (g.choices.length !== 4) return { ok: false, reason: `choices ${g.choices.length}` };
  const norm = g.choices.map((c) => normalizeOutput(c));
  if (new Set(norm).size !== 4 || norm.some((c) => !c)) return { ok: false, reason: "duplicate/empty choice" };
  if (g.answer_index < 0 || g.answer_index > 3) return { ok: false, reason: "answer_index" };
  if (g.hints.some((h) => norm.includes(normalizeOutput(h)))) return { ok: false, reason: "hint equals a choice" };

  if (s.sub === "python") {
    if (!/print\(/.test(g.passage)) return { ok: false, reason: "no print" };
    if (/\b(input\(|random|datetime|time\.|open\(|os\.|sys\.|subprocess|socket|requests)/.test(g.passage)) return { ok: false, reason: "forbidden construct" };
    const run = runPython(g.passage);
    if ("error" in run) return { ok: false, reason: `python error: ${run.error.slice(0, 80)}` };
    const actual = normalizeOutput(run.stdout);
    if (!actual) return { ok: false, reason: "empty stdout" };
    const idx = norm.findIndex((c) => c === actual);
    if (idx < 0) return { ok: false, reason: `no choice matches stdout (${run.stdout.trim().slice(0, 60)})` };
    if (idx !== g.answer_index) {
      console.warn(`  [fix] ${slotKey(s)}: answer_index ${g.answer_index} -> ${idx}`);
      g.answer_index = idx;
    }
    // 正解の選択肢は実行結果の表記で統一しておく（引用符など）
    g.choices[idx] = run.stdout.trim();
    return { ok: true, gen: g };
  }

  const sol = await parse(
    SOLVER_MODEL,
    SOLVER_ROLE,
    [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("choices", g.choices.map((c, i) => `${i}: ${c}`)), fmt("hints", g.hints)].join("\n\n"),
    solveSchema,
    "solution",
    s.sub === "logic" || s.difficulty >= 7 ? "high" : "medium",
    4000,
  );
  if (sol.hints_leak_answer) return { ok: false, reason: "hints leak answer" };
  if (sol.ambiguous) return { ok: false, reason: `ambiguous: ${sol.note.slice(0, 80)}` };
  if (sol.answer_index !== g.answer_index) return { ok: false, reason: `solver disagrees (${sol.answer_index} vs ${g.answer_index}): ${sol.note.slice(0, 80)}` };
  // ソルバーの難易度評価は、READ / WRITE では強いモデルほど低めに出る（読解は「解ける」ので 2〜3 と評価しがち）。
  // READ / WRITE の難易度は生成ガイド（本文の長さ・設問の型）で定義し、評価は「目標より明らかに難しすぎる」ときだけ弾く。
  // LOGIC は評価を使うが、8 以上は許容幅を広げる（高難度ほど低めに出る傾向）
  if (s.domain === "CODE") {
    const tol = s.difficulty >= 8 ? 4 : 3;
    if (Math.abs(sol.difficulty_rating - s.difficulty) > tol) return { ok: false, reason: `difficulty rated ${sol.difficulty_rating} (target ${s.difficulty})` };
  } else if (sol.difficulty_rating - s.difficulty > 3) {
    return { ok: false, reason: `too hard: rated ${sol.difficulty_rating} (target ${s.difficulty})` };
  }
  return { ok: true, gen: g, rating: sol.difficulty_rating };
}

// ---- 出力 ----
type StockTask = {
  id: string;
  domain: Domain;
  difficulty: number;
  title: string;
  passage?: string;
  prompt: string;
  kind: Kind;
  choices?: string[];
  answerKey?: string[];
  rubric?: { mustInclude?: string[]; minLength?: number; maxLength?: number; criteria: string[]; sampleAnswer?: string };
  hints: string[];
  explanation: string;
  skillTags: string[];
};

function toTask(s: Slot, g: Gen, id: string): StockTask {
  const kind = kindOf(s.sub);
  const base: StockTask = {
    id,
    domain: s.domain,
    difficulty: s.difficulty,
    title: g.title,
    passage: g.passage || undefined,
    prompt: g.prompt,
    kind,
    hints: g.hints,
    explanation: g.explanation,
    skillTags: g.skill_tags,
  };
  if (kind === "choice") return { ...base, choices: g.choices, answerKey: [String(g.answer_index)] };
  // 字数の上下限は模範解答の長さから決める（0.6 倍〜1.6 倍。長すぎる要求を防ぐ）
  const n = g.model_answer.length;
  const minLength = Math.max(30, Math.round(n * 0.6));
  const maxLength = Math.max(minLength + 40, Math.round(n * 1.6));
  return {
    ...base,
    rubric: { mustInclude: g.must_include.filter(Boolean).slice(0, 6), minLength, maxLength, criteria: g.rubric_criteria, sampleAnswer: g.model_answer },
  };
}

type Checkpoint = Record<string, StockTask & { rating?: number }>;

function loadCheckpoint(domain: Domain): Checkpoint {
  const p = path.join(OUT_DIR, `${domain}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Checkpoint) : {};
}
function saveCheckpoint(domain: Domain, cp: Checkpoint): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, `${domain}.json`), JSON.stringify(cp, null, 2));
}

function emit(domain: Domain, cp: Checkpoint): number {
  const tasks = Object.values(cp)
    .map(({ rating: _r, ...t }) => {
      void _r;
      return t;
    })
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  const name = `${domain}_STOCK`;
  const body = [
    "// 自動生成ファイル（scripts/stock/gen_stock.mts が書き出す）。手で編集しない。",
    `// ${domain}: ${tasks.length} 問（difficulty 1〜10）。生成: ${GEN_MODEL} / 検証: ${domain === "CODE" ? "Python 実行 + " : ""}独立ソルバー ${SOLVER_MODEL}`,
    'import type { Task } from "../types";',
    "",
    `export const ${name}: Task[] = ${JSON.stringify(tasks, null, 2)};`,
    "",
  ].join("\n");
  mkdirSync(STOCK_DIR, { recursive: true });
  writeFileSync(path.join(STOCK_DIR, `${domain.toLowerCase()}.generated.ts`), body);
  return tasks.length;
}

// ---- メイン ----
async function runDomain(domain: Domain): Promise<void> {
  const cp = loadCheckpoint(domain);
  const slots: Slot[] = [];
  for (let d = 1; d <= 10; d++) {
    let n = 0;
    for (const [sub, count] of Object.entries(PLAN[domain]) as [SubType, number][]) {
      for (let i = 0; i < count; i++) slots.push({ domain, sub, difficulty: d, n: n++ });
    }
  }
  const todo = slots.filter((s) => !cp[slotKey(s)]);
  console.log(`[${domain}] slots=${slots.length} done=${slots.length - todo.length} todo=${todo.length}`);
  const titles = () => Object.values(cp).map((t) => t.title);
  let cursor = 0;
  const rejected: string[] = [];
  const worker = async () => {
    while (cursor < todo.length) {
      const s = todo[cursor++];
      let accepted = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt++) {
        try {
          const g = await generate(s, attempt, titles());
          const v = await verify(s, g);
          if (!v.ok) {
            console.log(`  [reject] ${slotKey(s)} try${attempt + 1}: ${v.reason}`);
            continue;
          }
          const seq = Object.values(cp).filter((t) => t.difficulty === s.difficulty).length + 1;
          cp[slotKey(s)] = { ...toTask(s, v.gen, slotId(s, seq)), rating: v.rating };
          saveCheckpoint(domain, cp);
          accepted = true;
          console.log(`  [ok] ${slotKey(s)} -> ${cp[slotKey(s)].id} 「${v.gen.title}」${v.rating ? ` (rated ${v.rating})` : ""}`);
        } catch (err) {
          console.log(`  [error] ${slotKey(s)} try${attempt + 1}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
      if (!accepted) rejected.push(slotKey(s));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const n = emit(domain, cp);
  console.log(`[${domain}] emitted ${n} tasks. unfilled slots: ${rejected.length}${rejected.length ? " -> " + rejected.join(", ") : ""}`);
}

const args = process.argv.slice(2);
const domainArg = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "read,write,code";
const domains = domainArg.split(",").map((d) => d.trim().toUpperCase()) as Domain[];
if (args.includes("--emit-only")) {
  for (const d of domains) console.log(`[${d}] emitted ${emit(d, loadCheckpoint(d))} tasks`);
} else {
  for (const d of domains) await runDomain(d);
}
