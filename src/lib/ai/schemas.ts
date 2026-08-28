// OpenAI Responses API の structured outputs 用スキーマ（zod → strict JSON schema に変換される）。
// strict JSON schema では optional が使えないので、省略可能な値は「空文字 / 空配列 / 0 / -1」で表す。
import { z } from "zod";

export const evalSchema = z.object({
  status: z.enum(["success", "retry", "needs_more"]),
  feedback: z.string().describe("学習者への短い返答（100字以内・日本語）。答えは書かない"),
  hint: z.string().describe("次の一段のヒント。success のときは空文字"),
  observations: z.array(z.string()).describe("学習行動についての観察（性格ではなく行動）。最大3件・各40字以内"),
  skill_tags: z.array(z.string()).describe("この回答から観察できた subskill タグ（allowed_skill_tags から）"),
  recommended_next_difficulty: z.number().int().min(1).max(10),
});

export const interpretSchema = z.object({
  summary: z.string().describe("この領域の寸評。140字以内・日本語。証拠が少なければ暫定である旨を明記"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件・各40字以内"),
  recommended_next: z.string().describe("次に取り組む課題の方向（60字以内）"),
});

export const leaderSchema = z.object({
  summary: z.string().describe("学習者全体の総合寸評。140字以内・日本語。数値は与えられたものだけを使う"),
  interests: z.array(z.string()).describe("関心・傾向（証拠に基づくもののみ）。最大3件"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件・各40字以内"),
  recommendation: z.string().describe("次のおすすめ。『DOMAIN: 具体的な課題の方向』の形で60字以内"),
  recommended_domain: z.enum(["READ", "WRITE", "CODE"]),
});

export const generateSchema = z.object({
  title: z.string().describe("課題タイトル（『種類: 題材』の形。20字以内）"),
  passage: z.string().describe("読ませる本文・状況・コード。無ければ空文字。CODE なら Python か手順/条件の記述"),
  prompt: z.string().describe("設問（1〜2文）"),
  choices: z.array(z.string()).describe("kind=choice のときは選択肢を4つ。それ以外は空配列"),
  answer_index: z.number().int().min(-1).max(3).describe("kind=choice のとき正解の index（0〜3）。それ以外は -1"),
  short_answers: z.array(z.string()).describe("kind=short のときの正解候補（表記ゆれを含めて複数）。それ以外は空"),
  rubric_must_include: z.array(z.string()).describe("kind=free のとき、自然な解答に含まれやすい語（広めに8〜12語）。それ以外は空"),
  rubric_criteria: z.array(z.string()).describe("kind=free の評価観点（2〜3件）。それ以外は空"),
  rubric_min_length: z.number().int().describe("kind=free の最小字数。それ以外は 0"),
  rubric_max_length: z.number().int().describe("kind=free の最大字数。それ以外は 0"),
  model_answer: z.string().describe("kind=free のとき、お題に対する模範解答（prompt で求める字数の範囲内で実際に書く）。それ以外は空文字"),
  hints: z.array(z.string()).describe("段階ヒントを3つ。1つ目は問い返し、3つ目でも答えの値や完成文は書かない"),
  explanation: z.string().describe("成功後に見せる解説（答えを含んでよい。120字以内）"),
  skill_tags: z.array(z.string()).describe("allowed_skill_tags から1〜2個"),
});

export const chatSchema = z.object({
  text: z.string().describe("LINE に送る返答。3 文以内・日本語。必ず『次の一歩』を 1 つ含める。答えは教えない"),
  suggest_domain: z.enum(["READ", "WRITE", "CODE", "NONE"]).describe("会話から勧めたい系統。無ければ NONE"),
  sources: z.array(z.string()).describe("Web 検索を使ったときの出典 URL（最大 2 件）。使わなければ空"),
});

export const memorySchema = z.object({
  notes: z.string().describe("観察メモ。行動の傾向と『次に見たいこと』を、数値を書かずに簡潔に。上限字数を守る"),
});

export const lineIntentSchema = z.object({
  kind: z.enum(["profile", "history", "quiz", "generate", "materials", "hint", "pass", "today", "help", "link", "chat"]),
  domain: z.enum(["READ", "WRITE", "CODE", "NONE"]),
  difficulty: z.number().int().min(0).max(10).describe("読み取れなければ 0"),
  confidence: z.number().min(0).max(1),
});

export const runPythonSchema = z.object({
  stdout: z.string(),
  error: z.string(),
});

export type GenerateSchemaOutput = z.infer<typeof generateSchema>;
