// 問題ストック生成・検証スクリプト v2（問題タイプ付き・難易度 1〜10 を「誰でも解ける〜非常に難しい」に再設計・複合問題）
//
//   npx tsx scripts/stock/gen_stock.mts                       # READ / WRITE / CODE / MIX すべて
//   npx tsx scripts/stock/gen_stock.mts --domain code,mix     # 一部だけ
//   npx tsx scripts/stock/gen_stock.mts --emit-only           # 生成せず out/*.json から .generated.ts を書き出す
//
// 生成: 既定はサブスクの Codex CLI（`codex exec --output-schema`。API 課金なし）。`STOCK_BACKEND=openai` で OpenAI Responses API。
//       問題タイプは src/lib/task-types.ts のキーと一致させる。
// 検証（合格したものだけ採用）:
//   - 構造: 4 択・重複なし・answer_index 0..3・hints 3 段・explanation あり・バッククォート無し
//   - python / debug: ローカルの python で実際に実行（python は正解の選択肢と照合。別の選択肢が一致すれば index を修正）
//   - それ以外の 4 択: 正解を伏せた独立ソルバー（gpt-5.5）が同じ答えに到達し、曖昧さ・ヒントの答えバレが無いこと
//   - 記述（free）: 模範解答の長さが目安内、ヒントが完成解になっていない、レビュー担当（gpt-5.4-mini）が 5 段階で 4 以上
//   - 難易度: LOGIC はソルバー評価との差が大きいものを弾く。READ / WRITE / MIX は「明らかに難しすぎ」だけ弾く
// 進捗は scripts/stock/out/<DOMAIN>.json にチェックポイントし、再実行時は済んだスロットを飛ばす。
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBSKILLS } from "../../src/lib/domain";
import { normalizeOutput } from "../../src/lib/learn/generate.pure";

// ---- 設定 ----
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_DIR = path.join(HERE, "out");
const STOCK_DIR = path.join(ROOT, "src/lib/tasks/stock");
// STOCK_BACKEND=openai のときのモデル（既定は Codex CLI なので通常は使わない）
const GEN_MODEL = "gpt-5.6-sol";
const SOLVER_MODEL = "gpt-5.6-sol";
const REVIEW_MODEL = "gpt-5.6-luna";
/** codex = サブスクの Codex CLI（既定）/ openai = API（残高に注意） */
const BACKEND = (process.env.STOCK_BACKEND ?? "codex") as "codex" | "openai";
const CODEX_MODEL = process.env.CODEX_MODEL ?? "";
const CONCURRENCY = BACKEND === "codex" ? 4 : 8;
const MAX_ATTEMPTS = 3;

type Domain = "READ" | "WRITE" | "CODE" | "MIX";
type Axis = "READ" | "WRITE" | "CODE";
type Kind = "choice" | "short" | "free";


/** 問題タイプ（src/lib/task-types.ts のキーと一致） */
type TypeSpec = { key: string; kind: Kind; count: number; label: string; axes: Axis[]; primary: Axis };
const PLAN: Record<Domain, TypeSpec[]> = {
  READ: [
    { key: "summary", kind: "choice", count: 2, label: "要旨把握（本文の主張・要点を選ぶ）", axes: ["READ"], primary: "READ" },
    { key: "inference", kind: "choice", count: 2, label: "推論（書かれていないことを根拠から推し量る）", axes: ["READ"], primary: "READ" },
    { key: "critique", kind: "choice", count: 1, label: "批判的読解（前提・反例・論理の飛躍を見抜く）", axes: ["READ"], primary: "READ" },
    { key: "vocabulary", kind: "choice", count: 1, label: "語彙・表現（文脈での語の意味・言い換え）", axes: ["READ"], primary: "READ" },
    { key: "data", kind: "choice", count: 1, label: "図表・データ読解（文章で示された表や数値を読む。表は行ごとに『項目: 値』で書く）", axes: ["READ"], primary: "READ" },
  ],
  WRITE: [
    { key: "revision", kind: "choice", count: 2, label: "推敲（冗長・曖昧・ねじれを直した最も明確な文を選ぶ）", axes: ["WRITE"], primary: "WRITE" },
    { key: "structure", kind: "choice", count: 2, label: "構成（文や段落の順序・接続詞・主張と根拠の対応を選ぶ）", axes: ["WRITE"], primary: "WRITE" },
    { key: "argument", kind: "free", count: 1, label: "意見文（お題に意見と理由を書く）", axes: ["WRITE"], primary: "WRITE" },
    { key: "summary", kind: "free", count: 1, label: "要約（passage の文章を指定字数で要約する）", axes: ["WRITE"], primary: "WRITE" },
    { key: "rewrite", kind: "free", count: 1, label: "書き換え（指定の条件で文を書き直す: 敬語に／短く／読み手を変えて／結論を先に 等）", axes: ["WRITE"], primary: "WRITE" },
  ],
  CODE: [
    { key: "python", kind: "choice", count: 3, label: "Python 読解（短いコードの出力を予測。passage はコードのみ）", axes: ["CODE"], primary: "CODE" },
    { key: "debug", kind: "choice", count: 1, label: "Python バグ発見（passage は期待どおり動かないコードのみ。prompt に『期待する出力』を明記し、原因の行または正しい修正を選ばせる）", axes: ["CODE"], primary: "CODE" },
    { key: "puzzle", kind: "choice", count: 2, label: "論理パズル（条件から一意に決まる答えを推理。コード不可）", axes: ["CODE"], primary: "CODE" },
    { key: "math", kind: "choice", count: 1, label: "数的推理（数列・場合の数・比率・速さなど。計算は暗算〜筆算で済む範囲）", axes: ["CODE"], primary: "CODE" },
    { key: "algorithm", kind: "choice", count: 1, label: "手順・アルゴリズム（日本語の手順や擬似コードを追って結果や最短手順を答える。Python は使わない）", axes: ["CODE"], primary: "CODE" },
  ],
  MIX: [
    { key: "read_code", kind: "choice", count: 1, label: "複合 READ+LOGIC（文章で示されたルール・条件・データを読み取り、論理的に結論を選ぶ）", axes: ["READ", "CODE"], primary: "CODE" },
    { key: "read_write", kind: "free", count: 1, label: "複合 READ+WRITE（passage の文章を読んで、要約または意見を書く）", axes: ["READ", "WRITE"], primary: "WRITE" },
    { key: "write_code", kind: "free", count: 1, label: "複合 WRITE+LOGIC（手順や条件・簡単なコードの動きを、読み手に分かるよう文章で説明する）", axes: ["WRITE", "CODE"], primary: "WRITE" },
  ],
};

// 題材のばらつき用（index で回す）
const THEMES = [
  "市立図書館の利用", "商店街の活性化", "天気予報の精度", "部活動の練習方法", "スマートフォンの使い方", "宇宙開発の費用", "発酵食品の歴史",
  "地方鉄道の存続", "睡眠の研究", "リサイクルの仕組み", "音楽の配信サービス", "農業とドローン", "機械翻訳", "在宅勤務", "地図の歴史",
  "都市の緑化", "昆虫食", "博物館の展示", "手紙と電子メール", "自転車通勤", "学校の制服", "災害への備え", "コンビニの24時間営業",
  "観光地の混雑", "水道の老朽化", "紙の辞書と電子辞書", "ボードゲームの流行", "祭りの担い手不足", "電気自動車", "子どもの読書時間",
  "ペットと暮らす", "給食のメニュー", "公園の遊具", "朝のラジオ体操", "図工の時間", "駅前の駐輪場", "校庭の芝生化", "文化祭の出し物",
];
const PY_TOPICS = [
  "変数と算術・文字列連結", "for とリストの合計", "if/elif の分岐", "リストのスライス", "文字列メソッド（split/join/upper）", "辞書のカウント",
  "while と累積", "ネストしたループ", "関数と戻り値", "sorted と key", "リスト内包表記", "set の演算", "再帰（階乗・フィボナッチ）",
  "enumerate と zip", "文字列の反転・回文", "辞書の更新と get", "例外処理（try/except）", "クロージャ・デフォルト引数", "ジェネレータと next",
  "スタック/キューの操作", "2 次元リスト", "整数の割り算・剰余", "タプルのアンパック", "range のステップ", "文字コード ord/chr", "collections.Counter",
  "itertools（product/combinations）", "ソートの安定性", "浅いコピーと参照", "文字列のフォーマット",
];
const LOGIC_TOPICS = [
  "並び順の推理", "座席の割り当て", "騎士と悪党（正直者と嘘つき）", "表を使った対応づけ（人・色・飲み物）", "日程の制約からの特定",
  "対偶・逆・裏の判定", "必要条件と十分条件", "手順の最短化（川渡り・移し替え）", "重さ比べ・天秤", "カレンダーと曜日の推理",
  "部屋割りの制約", "スケジュールの矛盾探し", "集合とベン図", "順位と得点の整合", "トーナメントの勝敗推理", "真偽の発言からの犯人特定",
  "条件付きの数え上げ", "偽物のコインを見つける", "地図・方角の推理", "ルールに従う数列",
];
const MATH_TOPICS = ["数列の規則", "場合の数", "比と割合", "速さ・時間・距離", "平均と合計", "余りの周期", "面積・周の比較", "確率（同様に確からしい）", "年齢算", "仕事算"];
const ALGO_TOPICS = ["並べ替えの手順（バブルソート風）", "探索の手順（二分探索を日本語で）", "最短経路の手数", "スタックの積み下ろし", "状態遷移（信号・自販機）", "手順の繰り返しと停止条件", "エラトステネスの篩", "ユークリッドの互除法", "キューの処理順", "貪欲法の手順"];
const WRITE_TOPICS = [
  "接続詞の選択", "文の順序の並べ替え", "主張と根拠の対応", "冗長な語の削除", "一文一義への分割", "指示語の明確化", "段落の要約文",
  "反論への応答", "定義を先に置く構成", "具体例の選び方", "結論を先に述べる書き換え", "曖昧な表現の修正", "比較の対象をそろえる",
  "因果関係の書き方", "読み手に合わせた語の選択", "主語と述語のねじれ", "敬語への書き換え", "箇条書きへの整理",
];

/** 難易度の一般スケール（全系統共通の目安） */
function levelScale(d: number): string {
  return [
    "",
    "誰でも解ける。小学校中学年でも迷わない。1 つの事実・1 つの手順だけ。",
    "小学校高学年。要素は少なく、注意すれば必ず解ける。",
    "中学生。基本的な読み取り・推論・計算。",
    "高校入門。少し長い本文や 2 段階の推論。",
    "高校標準。複数の条件・観点を同時に扱う。",
    "大学入試基礎。抽象的な語や対比・因果を扱う。",
    "大学入試応用・社会人の実務。見落としやすい条件を含む。",
    "大学上級・専門職。前提や例外を吟味しないと誤る。",
    "専門家・競技レベル。多段の推論と厳密な検証が必要。",
    "非常に難しい。上級者でも数分〜十数分の集中が要り、慎重に検証しないと間違える。",
  ][d];
}

function difficultyGuide(domain: Domain, key: string, d: number): string {
  const base = `難易度 ${d}/10 — ${levelScale(d)}`;
  if (domain === "READ" || key === "read_code" || key === "read_write") {
    const len = d <= 1 ? "40〜80 字" : d <= 2 ? "60〜110 字" : d <= 3 ? "100〜160 字" : d <= 4 ? "140〜220 字" : d <= 5 ? "180〜280 字" : d <= 6 ? "220〜330 字" : d <= 7 ? "280〜400 字" : d <= 8 ? "350〜480 字" : d <= 9 ? "420〜560 字" : "500〜650 字";
    const q = d <= 2 ? "本文に書いてあることをそのまま確認する設問。" : d <= 4 ? "1 段階の推論や主張と理由の区別。" : d <= 6 ? "譲歩・対比・因果・列挙・具体から抽象などの論理構造を 1 つ以上含み、筆者の立場を読み取る。" : d <= 8 ? "論説調。暗黙の前提・反例・論理の飛躍を見抜く。" : "複数の立場が交錯し、根拠の強さや前提の妥当性を比較して判断する。";
    return `${base} 本文 ${len}。${q}`;
  }
  if (domain === "WRITE" || key === "write_code") {
    if (["argument", "summary", "rewrite", "read_write", "write_code"].includes(key)) {
      const len = d <= 2 ? "40〜70 字" : d <= 4 ? "60〜100 字" : d <= 6 ? "100〜160 字" : d <= 8 ? "150〜220 字" : "200〜280 字";
      const req = d <= 2 ? "一文か二文で意見（または言い換え）を書けばよい。" : d <= 4 ? "意見＋理由 1 つ。" : d <= 6 ? "主張・理由・具体例の 3 要素。" : d <= 8 ? "反対意見への応答を含める。" : "条件付きの結論や複数の観点の整理を含める。";
      return `${base} 模範解答は ${len}（prompt の字数指定もこれに合わせる）。${req}`;
    }
    const q = d <= 2 ? "一文の明らかな誤り（主語述語のねじれ・重複）を直した文を選ぶ。" : d <= 4 ? "2〜3 文の短い段落で、最も自然な順序や接続詞を選ぶ。" : d <= 6 ? "3〜5 文の段落で、主張と根拠の対応・冗長さを判断する。" : d <= 8 ? "段落全体の構成や論理の欠陥（根拠の飛躍・二重基準）を見抜く。" : "微妙な差の選択肢の中から、読み手・目的に最も適した書き方を選ぶ。";
    return `${base} ${q}`;
  }
  if (key === "python" || key === "debug") {
    const lines = d <= 1 ? "1〜3 行（print と足し算・文字列連結だけ）" : d <= 2 ? "2〜5 行（変数の代入と print）" : d <= 3 ? "4〜7 行（for か if を 1 つ）" : d <= 4 ? "6〜10 行（for と if、リストの基本）" : d <= 5 ? "8〜12 行（辞書・スライス・文字列メソッド）" : d <= 6 ? "10〜14 行（関数・while・ネスト 1 段）" : d <= 7 ? "12〜16 行（sorted の key・内包表記・状態更新）" : d <= 8 ? "14〜18 行（再帰・複数の状態の追跡）" : d <= 9 ? "15〜20 行（クロージャ／ジェネレータ／参照の共有）" : "18〜22 行（複合的な状態変化とエッジケース）";
    return `${base} コードは ${lines}。`;
  }
  if (key === "math") return `${base} ${d <= 2 ? "一桁〜二桁の足し引き・簡単な規則。" : d <= 4 ? "基本の割合・平均・簡単な場合の数。" : d <= 6 ? "2 段階の計算や周期性。" : d <= 8 ? "条件の組み合わせ・見落としやすい場合分け。" : "複数条件の厳密な数え上げ。"}`;
  if (key === "algorithm") return `${base} ${d <= 2 ? "2〜3 ステップの手順をそのまま追う。" : d <= 4 ? "5〜8 ステップ、繰り返し 1 つ。" : d <= 6 ? "条件分岐を含む手順の結果。" : d <= 8 ? "最短手順や停止条件の判断。" : "複数の手順の比較・計算量の見積もり。"}`;
  const p = d <= 1 ? "要素 2 つ・条件 1 つ。" : d <= 2 ? "要素 3 つ・条件 2 つ。" : d <= 3 ? "要素 3〜4 つ・条件 2〜3 つ。" : d <= 4 ? "要素 4 つ・条件 3 つ。" : d <= 5 ? "要素 4〜5 つ・条件 4 つ。" : d <= 6 ? "真偽者や表の整理が必要。条件 4〜5 つ。" : d <= 7 ? "複数の制約の同時充足。場合分け 2 通り。" : d <= 8 ? "場合分け 2〜3 通り。見落としやすい条件を 1 つ。" : d <= 9 ? "多段の推論と排反なケース分析。条件 6〜7 個、要素 5〜6 個。" : "条件 7〜8 個、要素 6 個。上級者でも数分かかる密度。";
  return `${base} ${p}`;
}

// ---- OpenAI ----
const envText = existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : "";
const apiKey = envText.split(/\r?\n/).find((l) => l.startsWith("OPENAI_API_KEY="))?.slice("OPENAI_API_KEY=".length).trim().replace(/^"|"$/g, "");
if (BACKEND === "openai" && !apiKey) throw new Error("OPENAI_API_KEY not found in .env");
const client = apiKey ? new OpenAI({ apiKey }) : null;

const genSchema = z.object({
  title: z.string(),
  passage: z.string(),
  prompt: z.string(),
  choices: z.array(z.string()),
  answer_index: z.number().int(),
  rubric_criteria: z.array(z.string()),
  must_include: z.array(z.string()),
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
  /** 紙と鉛筆で 10 分以内に解けるか（総当たり・プログラム前提の計算問題は false） */
  hand_solvable: z.boolean(),
  note: z.string(),
});
const reviewSchema = z.object({ score: z.number().int(), issues: z.string() });

const GEN_ROLE = [
  "あなたは学習サービス Trivium（READ / WRITE / LOGIC の 3 系統）の出題者。指定の系統・問題タイプ・形式・難易度で、日本語の課題を 1 問作る。",
  "- 問題は自己完結で、passage と prompt だけで解ける。実在の個人・時事の断定・医療/法律の助言を避ける。",
  "- 難易度 1〜2 は『誰でも解ける』こと（迷う要素を入れない）。難易度 9〜10 は上級者でも慎重な検証が要る密度にする。指定の難易度ガイドに厳密に従う。",
  "- choice は選択肢 4 つ。正解は 1 つだけで、他の 3 つは明確に誤り（ただし『ありそうな誤り』にする）。選択肢どうしは文言も内容も重複させない。",
  "- 4 つの選択肢の長さと文体をそろえる（正解だけが長い・正解だけが『〜しつつ〜も踏まえ』のような折衷表現、という手がかりを作らない。誤答にも穏当で長い文を含める）。誤答は『本文の一部を正しく述べつつ結論だけ違う』型を混ぜる。",
  "- ヒントに本文の接続詞や着眼点の答え（『しかし』『ただし』の後に注目 など）をそのまま書かない。問い返しと観点の提示にとどめる。",
  "- 難易度 1〜2 の推論（inference）は『本文から 1 文で自然に言えること』、批判的読解（critique）は『明らかな読み違いを見抜く』程度にし、型の意味は保つ。",
  "- free（記述）は rubric_criteria（採点観点 3〜5 個）、must_include（答案に含まれていれば加点する語 3〜6 個。お題に直結する具体語）、model_answer（模範解答。prompt で求める字数の範囲内で実際に書く）を書き、choices は空、answer_index は 0。prompt の字数指定は model_answer の長さに合わせる（模範解答より長い字数を要求しない）。free 以外では model_answer は空文字。",
  "- hints は 3 段。1 段目は問い返し、2 段目は着眼点、3 段目でも答えの値・完成文・正解の選択肢を書かない。記述問題のヒントは、そのまま提出できる文にしない（観点を示すか、問い返す）。",
  "- explanation は正解した後に見せる解説（正解の根拠を簡潔に）。",
  "- title は 20 字以内。系統名の接頭辞（『LOGIC:』など）は付けない。",
  "- 改行は実際の改行で書く（文字列として \\n と書かない）。マークダウンの装飾・コードフェンス・バッククォート（`）を使わない。",
  "- Python の出力予測問題: passage はコードのみ（説明文を混ぜない）。標準ライブラリのみ、input()・乱数・時刻・ファイル・ネットワークを使わない。必ず print で決定的な出力を出す。正解の選択肢は print の出力そのまま（Python の表記: 文字列はシングルクォート、複数行は改行で区切る）。コードを一行ずつ実行して確かめてから答えを決める。",
  "- Python バグ発見問題: passage は『期待どおり動かないコード』のみ。prompt に期待する出力（または動作）と実際の出力を明記し、原因の行（行番号と内容）または正しい修正を 4 択で選ばせる。修正が一意に決まるバグにする。",
  "- 論理パズル・数的推理・手順問題: プログラムコードを使わない。条件から一意に答えが決まることを確認する。**紙と鉛筆で 10 分以内に解ける**規模にする（数千件の総当たりや巨大な数の剰余計算は不可。難しさは推論の段数で作る）。",
  "- 複合問題（READ+LOGIC など）: 本文の読み取りと論理的判断の両方が必要な設計にする（どちらか片方だけでは解けない）。",
  "- skill_tags は allowed_skill_tags から 1〜2 個。",
].join("\n");

const SOLVER_ROLE = [
  "あなたは慎重な解答者。与えられた課題を自力で解き、answer_index（0..3）で答える。",
  "- 根拠を一つずつ確かめ、複数の選択肢が正しく読める／どれも正しくない場合は ambiguous=true にして note に理由を書く。",
  "- difficulty_rating は 1（小学校中学年でも解ける）〜10（専門家でも慎重な検証が要る）で、この課題の難しさを評価する。",
  "- hints（段階ヒント）を読み、答えの値・正解の選択肢がそのまま書かれていれば hints_leak_answer=true。",
  "- hand_solvable: 紙と鉛筆で 10 分以内に解けるなら true。数千件の総当たり・大きな数の剰余の周期計算・プログラムを書かないと現実的でない問題は false。",
  "- confidence は 0〜1。",
].join("\n");

const REVIEW_ROLE = [
  "あなたは記述課題のレビュー担当。お題（passage / prompt）と採点観点（rubric）と模範解答を読み、学習課題としての質を 1〜5 で採点する。",
  "5: お題が明確で、指定の字数・要素が妥当、観点が採点に使える、模範解答がお題と字数指定を満たしている。3: 一部曖昧、または模範解答が字数指定から外れている。1: 何を書けばよいか分からない、または不適切。",
  "issues に問題点を簡潔に（無ければ空文字）。",
].join("\n");

function fmt(tag: string, v: unknown): string {
  return `<${tag}>\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n</${tag}>`;
}

let codexSeq = 0;
/**
 * Codex CLI（サブスク）で構造化出力を得る。`codex exec --output-schema` の最終メッセージを JSON として読む。
 * stdin を閉じないとハングするので必ず ignore。読み取り専用サンドボックス・一時ディレクトリで実行。
 */
async function codexParse<T extends z.ZodTypeAny>(instructions: string, input: string, schema: T, name: string, effort: "low" | "medium" | "high"): Promise<z.infer<T>> {
  const dir = path.join(tmpdir(), "trivium-codex");
  mkdirSync(dir, { recursive: true });
  const id = `${process.pid}-${Date.now()}-${codexSeq++}`;
  const schemaFile = path.join(dir, `${id}.schema.json`);
  const outFile = path.join(dir, `${id}.out.json`);
  const jsonSchema = zodTextFormat(schema, name).schema;
  writeFileSync(schemaFile, JSON.stringify(jsonSchema));
  const prompt = `${instructions}\n\n以下の入力に対して、指定の JSON スキーマに従う JSON だけを最終回答として返す（説明文は不要）。\n\n${input}`;
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "-C",
    dir,
    "--output-schema",
    schemaFile,
    "-o",
    outFile,
    "-c",
    `model_reasoning_effort="${effort}"`,
    ...(CODEX_MODEL ? ["-m", CODEX_MODEL] : []),
    "-",
  ];
  // プロンプトは引数ではなく stdin で渡す（Windows の shell 経由だと <tag> がリダイレクト扱いになり本文が消える）
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex timeout"));
    }, 240_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exit ${code}: ${err.slice(-200)}`));
    });
  });
  let raw = "";
  try {
    raw = readFileSync(outFile, "utf8");
  } finally {
    for (const f of [schemaFile, outFile]) if (existsSync(f)) unlinkSync(f);
  }
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`codex output does not match schema: ${parsed.error.issues[0]?.message ?? "?"}`);
  return parsed.data as z.infer<T>;
}

async function parse<T extends z.ZodTypeAny>(model: string, instructions: string, input: string, schema: T, name: string, effort: "low" | "medium" | "high", maxTokens: number): Promise<z.infer<T>> {
  if (BACKEND === "codex") return codexParse(instructions, input, schema, name, effort);
  if (!client) throw new Error("OPENAI_API_KEY not found");
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
type Slot = { domain: Domain; spec: TypeSpec; difficulty: number; n: number };

function slotKey(s: Slot): string {
  return `${s.domain}:${s.spec.key}:${s.difficulty}:${s.n}`;
}
function slotId(s: Slot, seq: number): string {
  return `${s.domain.toLowerCase()}-s${s.difficulty}-${String(seq).padStart(2, "0")}`;
}
function allowedTags(s: Slot): string[] {
  return s.spec.axes.flatMap((a) => SUBSKILLS[a]);
}
function themeFor(s: Slot, attempt: number): string {
  const i = (s.difficulty * 7 + s.n * 3 + attempt * 11 + s.spec.key.length * 5) % 1000;
  const k = s.spec.key;
  if (k === "python" || k === "debug") return PY_TOPICS[i % PY_TOPICS.length];
  if (k === "puzzle" || k === "read_code") return LOGIC_TOPICS[i % LOGIC_TOPICS.length];
  if (k === "math") return MATH_TOPICS[i % MATH_TOPICS.length];
  if (k === "algorithm" || k === "write_code") return ALGO_TOPICS[i % ALGO_TOPICS.length];
  if (k === "revision" || k === "structure") return WRITE_TOPICS[i % WRITE_TOPICS.length];
  return THEMES[i % THEMES.length];
}

/** 本文の論理構造をスロットごとに回す（同じ難易度帯が同じ型に偏らないように） */
const STRUCTURES = ["譲歩（一見もっともな反対意見を認めてから主張）", "対比（二つの立場や事例を比べる）", "因果（原因と結果の連鎖）", "列挙と統合（複数の根拠をまとめる）", "具体から抽象（事例から一般則へ）", "問題提起と解決（問いを立てて答える）"];

async function generate(s: Slot, attempt: number, recentTitles: string[]): Promise<Gen> {
  const domainLabel = s.domain === "MIX" ? `複合（主系統 ${s.spec.primary === "CODE" ? "LOGIC" : s.spec.primary}、関与: ${s.spec.axes.map((a) => (a === "CODE" ? "LOGIC" : a)).join("+")}）` : s.domain === "CODE" ? "LOGIC" : s.domain;
  const user = [
    fmt("domain", domainLabel),
    fmt("task_type", `${s.spec.key} — ${s.spec.label}`),
    fmt("kind", s.spec.kind),
    fmt("difficulty", difficultyGuide(s.domain, s.spec.key, s.difficulty)),
    fmt("theme_hint", `${themeFor(s, attempt)}（題材の参考。無理に使わなくてよい）`),
    ...(s.domain === "READ" || s.spec.key === "read_code" || s.spec.key === "read_write" ? [fmt("structure_hint", `本文の論理構造: ${STRUCTURES[(s.n + attempt) % STRUCTURES.length]}`)] : []),
    fmt("allowed_skill_tags", allowedTags(s)),
    fmt("recent_titles", recentTitles.slice(-40)),
  ].join("\n\n");
  // 作問は質優先で high（速度より質。検証で落ちた分を作り直すコストの方が大きい）
  void ["python", "debug", "puzzle", "math", "algorithm", "read_code"];
  return parse(GEN_MODEL, GEN_ROLE, user, genSchema, "generated_task", "high", s.difficulty >= 8 ? 16000 : 10000);
}

// ---- 検証 ----
function nl(t: string): string {
  return t.replace(/\\n/g, "\n").replace(/\\t/g, "    ").replace(/\r/g, "").trim();
}
function runPython(code: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("python", ["-I", "-c", code], { timeout: 5000, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, cwd: OUT_DIR });
  if (r.error) return { stdout: "", stderr: r.error.message, status: -1 };
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}
const FORBIDDEN = /\b(input\(|random|datetime|time\.|open\(|os\.|sys\.|subprocess|socket|requests)/;

type Verified = { ok: true; gen: Gen; rating?: number } | { ok: false; reason: string };

async function verify(s: Slot, g0: Gen): Promise<Verified> {
  const g: Gen = { ...g0, title: nl(g0.title), passage: nl(g0.passage), prompt: nl(g0.prompt), explanation: nl(g0.explanation), choices: g0.choices.map(nl), hints: g0.hints.map(nl), model_answer: nl(g0.model_answer) };
  const kind = s.spec.kind;
  const shown = g.title + g.passage + g.prompt + g.choices.join("") + g.hints.join("") + g.explanation;
  if (/`/.test(shown)) return { ok: false, reason: "backtick" };
  if (g.hints.length !== 3 || g.hints.some((h) => h.length < 4)) return { ok: false, reason: "hints" };
  if (g.explanation.length < 10) return { ok: false, reason: "explanation" };
  if (!g.prompt) return { ok: false, reason: "prompt empty" };
  g.title = g.title.replace(/^\s*(READ|WRITE|LOGIC|CODE|MIX)\s*[:：]\s*/i, "").slice(0, 40);
  const tags = allowedTags(s);
  g.skill_tags = g.skill_tags.filter((t) => tags.includes(t));
  if (g.skill_tags.length === 0) g.skill_tags = [SUBSKILLS[s.spec.primary][0]];

  if (kind === "free") {
    if (g.rubric_criteria.length < 3) return { ok: false, reason: "rubric" };
    if (g.must_include.filter(Boolean).length < 2) return { ok: false, reason: "must_include" };
    g.choices = [];
    const len = g.model_answer.length;
    const [lo, hi] = s.difficulty <= 2 ? [25, 90] : s.difficulty <= 4 ? [40, 130] : s.difficulty <= 6 ? [70, 200] : s.difficulty <= 8 ? [110, 280] : [150, 340];
    if (len < lo || len > hi) return { ok: false, reason: `model_answer length ${len} (want ${lo}〜${hi})` };
    const minL = Math.max(20, Math.round(len * 0.6));
    const maxL = Math.max(minL + 40, Math.round(len * 1.6));
    for (const h of g.hints) {
      const hl = [...h].length;
      const hits = g.must_include.filter((w) => w && h.includes(w)).length;
      if (hl >= minL && hl <= maxL && hits >= 2 && !/[？?]\s*$/.test(h)) return { ok: false, reason: "hint looks like a full answer" };
    }
    const r = await parse(REVIEW_MODEL, REVIEW_ROLE, [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("rubric", g.rubric_criteria), fmt("model_answer", g.model_answer)].join("\n\n"), reviewSchema, "review", "low", 400);
    if (r.score < 4) return { ok: false, reason: `review ${r.score}: ${r.issues.slice(0, 80)}` };
    return { ok: true, gen: g };
  }

  if (g.choices.length !== 4) return { ok: false, reason: `choices ${g.choices.length}` };
  const norm = g.choices.map((c) => normalizeOutput(c));
  if (new Set(norm).size !== 4 || norm.some((c) => !c)) return { ok: false, reason: "duplicate/empty choice" };
  if (g.answer_index < 0 || g.answer_index > 3) return { ok: false, reason: "answer_index" };
  if (g.hints.some((h) => norm.includes(normalizeOutput(h)))) return { ok: false, reason: "hint equals a choice" };
  // 正解だけが目立って長い（2 番目に長い選択肢の 1.25 倍超）と「長いのが正解」で解けてしまう
  if (s.spec.key !== "python") {
    const lens = g.choices.map((c) => [...c].length);
    const correct = lens[g.answer_index];
    const others = lens.filter((_, i) => i !== g.answer_index);
    if (correct > Math.max(...others) * 1.15 && correct - Math.max(...others) > 6) return { ok: false, reason: `correct choice is longest (${correct} vs ${Math.max(...others)})` };
  }
  if ((s.domain === "READ" || s.domain === "MIX") && g.hints.some((h) => /(しかし|ただし|だが|一方で)/.test(h))) return { ok: false, reason: "hint spells out the connective" };

  if (s.spec.key === "python") {
    if (!/print\(/.test(g.passage)) return { ok: false, reason: "no print" };
    if (FORBIDDEN.test(g.passage)) return { ok: false, reason: "forbidden construct" };
    const run = runPython(g.passage);
    if (run.status !== 0) return { ok: false, reason: `python error: ${run.stderr.slice(-80)}` };
    const actual = normalizeOutput(run.stdout);
    if (!actual) return { ok: false, reason: "empty stdout" };
    const idx = norm.findIndex((c) => c === actual);
    if (idx < 0) return { ok: false, reason: `no choice matches stdout (${run.stdout.trim().slice(0, 60)})` };
    if (idx !== g.answer_index) {
      console.warn(`  [fix] ${slotKey(s)}: answer_index ${g.answer_index} -> ${idx}`);
      g.answer_index = idx;
    }
    g.choices[idx] = run.stdout.trim();
    return { ok: true, gen: g };
  }
  if (s.spec.key === "debug") {
    if (FORBIDDEN.test(g.passage)) return { ok: false, reason: "forbidden construct" };
    const run = runPython(g.passage);
    // バグ入りコードは「動くが結果が違う」か「例外で止まる」のどちらでもよいが、少なくとも Python として読み込めること
    if (run.status === -1 || /SyntaxError|IndentationError/.test(run.stderr)) return { ok: false, reason: "buggy code does not parse" };
  }

  const sol = await parse(
    SOLVER_MODEL,
    SOLVER_ROLE,
    [fmt("passage", g.passage), fmt("prompt", g.prompt), fmt("choices", g.choices.map((c, i) => `${i}: ${c}`)), fmt("hints", g.hints)].join("\n\n"),
    solveSchema,
    "solution",
    s.difficulty >= 7 || ["puzzle", "math", "algorithm", "debug", "read_code"].includes(s.spec.key) ? "high" : "medium",
    4000,
  );
  if (sol.hints_leak_answer) return { ok: false, reason: "hints leak answer" };
  if (!sol.hand_solvable) return { ok: false, reason: `not hand-solvable: ${sol.note.slice(0, 80)}` };
  // 数的推理・パズルで「1〜10000」のような大きな範囲の数え上げは機械的に弾く
  if (["math", "puzzle", "algorithm", "read_code"].includes(s.spec.key) && /([1-9]\d{3,}|[1-9]\d{2,}\s*(まで|個|通り|人|回))/.test(g.passage + g.prompt) && /(何個|いくつ|何通り|数えよ|個数)/.test(g.prompt)) {
    return { ok: false, reason: "large-range counting problem" };
  }
  if (sol.ambiguous) return { ok: false, reason: `ambiguous: ${sol.note.slice(0, 80)}` };
  if (sol.answer_index !== g.answer_index) return { ok: false, reason: `solver disagrees (${sol.answer_index} vs ${g.answer_index}): ${sol.note.slice(0, 80)}` };
  // 難易度: LOGIC は評価との差が大きいものを弾く（8 以上は許容幅を広げる）。READ / WRITE / MIX は「明らかに難しすぎ」だけ弾く
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
  domain: Axis;
  difficulty: number;
  axes?: Partial<Record<"read" | "write" | "code", number>>;
  title: string;
  passage?: string;
  prompt: string;
  kind: Kind;
  taskType: string;
  choices?: string[];
  answerKey?: string[];
  rubric?: { mustInclude?: string[]; minLength?: number; maxLength?: number; criteria: string[]; sampleAnswer?: string };
  hints: string[];
  explanation: string;
  skillTags: string[];
};

/**
 * 複合問題の axes と主系統。主系統は難易度 d、他の系統は d-1（主系統が厳密な最大になるように。tests の「domain が最大系統」に合わせる）。
 * d=1 は全系統 1 の同点になるので、read → write → code の順で先の系統を主系統にする。
 */
function compositeAxes(s: Slot): { domain: Axis; axes: NonNullable<StockTask["axes"]> } {
  const order: Axis[] = ["READ", "WRITE", "CODE"];
  const involved = order.filter((a) => s.spec.axes.includes(a));
  const primary: Axis = s.difficulty >= 2 ? s.spec.primary : involved[0];
  const axes = Object.fromEntries(involved.map((a) => [a.toLowerCase(), a === primary ? s.difficulty : Math.max(1, s.difficulty - 1)])) as NonNullable<StockTask["axes"]>;
  return { domain: primary, axes };
}

function toTask(s: Slot, g: Gen, id: string): StockTask {
  const kind = s.spec.kind;
  const mix = s.domain === "MIX" ? compositeAxes(s) : null;
  const domain: Axis = mix ? mix.domain : s.spec.primary;
  const skillTags = g.skill_tags.filter((t) => SUBSKILLS[domain].includes(t));
  const base: StockTask = {
    id,
    domain,
    difficulty: s.difficulty,
    ...(mix ? { axes: mix.axes } : {}),
    title: g.title,
    passage: g.passage || undefined,
    prompt: g.prompt,
    kind,
    taskType: s.domain === "MIX" ? "composite" : s.spec.key,
    hints: g.hints,
    explanation: g.explanation,
    skillTags: skillTags.length ? skillTags : [SUBSKILLS[domain][0]],
  };
  if (kind === "choice") return { ...base, choices: g.choices, answerKey: [String(g.answer_index)] };
  const n = g.model_answer.length;
  const minLength = Math.max(20, Math.round(n * 0.6));
  const maxLength = Math.max(minLength + 40, Math.round(n * 1.6));
  return { ...base, rubric: { mustInclude: g.must_include.filter(Boolean).slice(0, 6), minLength, maxLength, criteria: g.rubric_criteria, sampleAnswer: g.model_answer } };
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
/** id から決定論的に 0..3 を返す（FNV-1a） */
function rotationOf(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 4;
}

/** 選択式は正解の位置が偏らないよう、id ごとに選択肢を回転させる（answerKey も同時に写像） */
function rotateChoices(t: StockTask): StockTask {
  if (t.kind !== "choice" || !t.choices || t.choices.length !== 4 || !t.answerKey) return t;
  const r = rotationOf(t.id);
  if (r === 0) return t;
  const choices = t.choices.map((_, i) => t.choices![(i - r + 4) % 4]);
  const answer = (Number(t.answerKey[0]) + r) % 4;
  return { ...t, choices, answerKey: [String(answer)] };
}

function emit(domain: Domain, cp: Checkpoint): number {
  const tasks = Object.values(cp)
    .map(({ rating: _r, ...t }) => {
      void _r;
      return rotateChoices(t);
    })
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
  const name = `${domain}_STOCK`;
  const body = [
    "// 自動生成ファイル（scripts/stock/gen_stock.mts が書き出す）。手で編集しない。",
    `// ${domain}: ${tasks.length} 問（difficulty 1〜10・問題タイプ付き）。生成: ${GEN_MODEL} / 検証: Python 実行 + 独立ソルバー ${SOLVER_MODEL} + レビュー ${REVIEW_MODEL}`,
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
    for (const spec of PLAN[domain]) for (let i = 0; i < spec.count; i++) slots.push({ domain, spec, difficulty: d, n: n++ });
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

/**
 * --recheck: 既存のチェックポイントを現在の検証基準で再判定し、落ちたものを外す（その後の通常実行で作り直す）。
 * 対象は --types で絞れる（既定: math,puzzle,algorithm,read_code）。生成はしないので Codex/API の消費は検証分だけ。
 */
async function recheckDomain(domain: Domain, types: string[]): Promise<void> {
  const cp = loadCheckpoint(domain);
  const keys = Object.keys(cp).filter((k) => types.includes(k.split(":")[1]));
  console.log(`[${domain}] recheck ${keys.length} tasks (${types.join(",")})`);
  let cursor = 0;
  const dropped: string[] = [];
  const worker = async () => {
    while (cursor < keys.length) {
      const k = keys[cursor++];
      const t = cp[k];
      const [, key, dStr, nStr] = k.split(":");
      const spec = PLAN[domain].find((x) => x.key === key);
      if (!spec) continue;
      const slot: Slot = { domain, spec, difficulty: Number(dStr), n: Number(nStr) };
      const gen: Gen = {
        title: t.title,
        passage: t.passage ?? "",
        prompt: t.prompt,
        choices: t.choices ?? [],
        answer_index: Number(t.answerKey?.[0] ?? 0),
        rubric_criteria: t.rubric?.criteria ?? [],
        must_include: t.rubric?.mustInclude ?? [],
        model_answer: t.rubric?.sampleAnswer ?? "",
        hints: t.hints,
        explanation: t.explanation,
        skill_tags: t.skillTags,
      };
      try {
        const v = await verify(slot, gen);
        if (!v.ok) {
          console.log(`  [drop] ${k} (${t.id}): ${v.reason}`);
          dropped.push(k);
        }
      } catch (err) {
        console.log(`  [error] ${k}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const k of dropped) delete cp[k];
  saveCheckpoint(domain, cp);
  console.log(`[${domain}] recheck done: dropped ${dropped.length}`);
}

const args = process.argv.slice(2);
const domainArg = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "read,write,code,mix";
const domains = domainArg.split(",").map((d) => d.trim().toUpperCase()) as Domain[];
if (args.includes("--recheck")) {
  const types = (args.includes("--types") ? args[args.indexOf("--types") + 1] : "math,puzzle,algorithm,read_code").split(",");
  for (const d of domains) await recheckDomain(d, types);
} else if (args.includes("--emit-only")) {
  for (const d of domains) console.log(`[${d}] emitted ${emit(d, loadCheckpoint(d))} tasks`);
} else {
  for (const d of domains) await runDomain(d);
}
