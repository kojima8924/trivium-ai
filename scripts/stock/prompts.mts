// LLM に渡すもの: 構造化出力のスキーマ（生成・独立ソルバー・レビュー）と、それぞれの役割プロンプト。
// 文面を変えると生成物が変わるので、ここは原文のまま保つ。
import { z } from "zod";

export const genSchema = z.object({
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
export type Gen = z.infer<typeof genSchema>;

export const solveSchema = z.object({
  answer_index: z.number().int(),
  confidence: z.number(),
  difficulty_rating: z.number().int(),
  ambiguous: z.boolean(),
  hints_leak_answer: z.boolean(),
  /** 紙と鉛筆で 10 分以内に解けるか（総当たり・プログラム前提の計算問題は false） */
  hand_solvable: z.boolean(),
  note: z.string(),
});
export const reviewSchema = z.object({ score: z.number().int(), issues: z.string() });

export const GEN_ROLE = [
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

export const SOLVER_ROLE = [
  "あなたは慎重な解答者。与えられた課題を自力で解き、answer_index（0..3）で答える。",
  "- 根拠を一つずつ確かめ、複数の選択肢が正しく読める／どれも正しくない場合は ambiguous=true にして note に理由を書く。",
  "- difficulty_rating は 1（小学校中学年でも解ける）〜10（専門家でも慎重な検証が要る）で、この課題の難しさを評価する。",
  "- hints（段階ヒント）を読み、答えの値・正解の選択肢がそのまま書かれていれば hints_leak_answer=true。",
  "- hand_solvable: 紙と鉛筆で 10 分以内に解けるなら true。数千件の総当たり・大きな数の剰余の周期計算・プログラムを書かないと現実的でない問題は false。",
  "- confidence は 0〜1。",
].join("\n");

export const REVIEW_ROLE = [
  "あなたは記述課題のレビュー担当。お題（passage / prompt）と採点観点（rubric）と模範解答を読み、学習課題としての質を 1〜5 で採点する。",
  "5: お題が明確で、指定の字数・要素が妥当、観点が採点に使える、模範解答がお題と字数指定を満たしている。3: 一部曖昧、または模範解答が字数指定から外れている。1: 何を書けばよいか分からない、または不適切。",
  "issues に問題点を簡潔に（無ければ空文字）。",
].join("\n");

export function fmt(tag: string, v: unknown): string {
  return `<${tag}>\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n</${tag}>`;
}
