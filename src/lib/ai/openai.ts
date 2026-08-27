// OpenAIProvider: OpenAI Responses API をサーバ側から直接呼ぶ provider（既定の primary）。
// - 出力は structured outputs（zod）で固定
// - system policy 7 か条と人格（persona）を prompt に載せる
// - API key は環境変数のみ。PII は渡さない（learnerRef は内部ID）
import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env";
import { DOMAINS, DOMAIN_META, SUBSKILLS, type DomainKey } from "../domain";
import { MockProvider } from "./mock";
import {
  AI_SYSTEM_POLICY,
  type DomainEvalInput,
  type DomainEvalOutput,
  type DomainInterpretInput,
  type DomainInterpretOutput,
  type GenerateTaskInput,
  type GenerateTaskOutput,
  type LeaderInput,
  type LeaderOutput,
  type LearningAIProvider,
  type PersonaPrompt,
} from "./types";

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

// ---- 出力スキーマ（strict JSON schema に変換されるので optional は使わず nullable で表す） ----

const evalSchema = z.object({
  status: z.enum(["success", "retry", "needs_more"]),
  feedback: z.string().describe("学習者への短い返答（100字以内・日本語）。答えは書かない"),
  hint: z.string().describe("次の一段のヒント。success のときは空文字"),
  observations: z.array(z.string()).describe("学習行動についての観察（性格ではなく行動）。最大3件・各40字以内"),
  skill_tags: z.array(z.string()).describe("この回答から観察できた subskill タグ（allowed_skill_tags から）"),
  recommended_next_difficulty: z.number().int().min(1).max(5),
});

const interpretSchema = z.object({
  summary: z.string().describe("この領域の寸評。140字以内・日本語。証拠が少なければ暫定である旨を明記"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件・各40字以内"),
  recommended_next: z.string().describe("次に取り組む課題の方向（60字以内）"),
});

const leaderSchema = z.object({
  summary: z.string().describe("学習者全体の総合寸評。140字以内・日本語。数値は与えられたものだけを使う"),
  interests: z.array(z.string()).describe("関心・傾向（証拠に基づくもののみ）。最大3件"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件・各40字以内"),
  recommendation: z.string().describe("次のおすすめ。『DOMAIN: 具体的な課題の方向』の形で60字以内"),
  recommended_domain: z.enum(["READ", "WRITE", "CODE"]),
});

const generateSchema = z.object({
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
  hints: z.array(z.string()).describe("段階ヒントを3つ。1つ目は問い返し、3つ目でも答えの値や完成文は書かない"),
  explanation: z.string().describe("成功後に見せる解説（答えを含んでよい。120字以内）"),
  skill_tags: z.array(z.string()).describe("allowed_skill_tags から1〜2個"),
});

// ---- prompt ----

const POLICY_TEXT = AI_SYSTEM_POLICY.map((p, i) => `${i + 1}. ${p}`).join("\n");

const COMMON = [
  "あなたは Trivium の学習コーチです。READ / WRITE / LOGIC の短い課題に取り組む高校生〜成人を支援します。",
  "コア思想: AI does not do the work for you. It helps you take the next step.",
  "",
  "System policy:",
  POLICY_TEXT,
  "",
  "共通ルール:",
  "- 出力は必ず日本語。簡潔に。",
  "- 学習者の課題を代わりに完成させない。ヒントは一度に一段だけ。",
  "- 与えられた数値（スコア・件数）以外の数値を作らない。",
  "- 行動について述べ、性格や能力を断定しない。証拠が少ないときは不確かさを明示する。",
  "- LOGIC 領域は内部キー CODE。Python の読解と、手順・条件・推論の問題の両方を含む。学習者向けの文章では必ず『LOGIC』と表記し、『CODE』とは書かない。",
].join("\n");

const ROLE_EVAL = [
  "役割: 学習者の回答を評価し、feedback と（必要なら）一段だけのヒントを返す。",
  "- deterministic_result が correct のときは status を success、hint は空文字。feedback は2文: 何ができていたか＋次に意識する一点。",
  "- incorrect のときは status を retry。feedback は2文で『どこを見直すか』だけを示す。誤りの箇所・原因・正解の値を特定して教えない（『式の最後の - 1 が効いている』のような指摘は禁止。ヒント3段目より先の情報になる）。",
  "- hint は hints 配列の hint_level 番目（0始まり）を、学習者の回答に合わせて言い換えたもの。その段のヒントに無い新しい事実を足さない。範囲外なら最後のヒントを言い換える。答えそのものは書かない。",
  "- unknown（自由記述）のときは criteria に照らして判断。十分なら success、足りなければ needs_more にして、足りない観点を問い返す。heuristic_result は参考情報。",
  "- feedback に正解の値や完成文、誤りの具体的な位置を含めない。",
].join("\n");

const ROLE_INTERPRET = [
  "役割: 決定論的に集計された stats（数値＝evidence）を解釈し、この領域の寸評・観察・次の方向を返す。",
  "- 数値を作らない・変えない。stats にある subskill と値だけを根拠にする。",
  "- confidence が low のときは『記録が少なく暫定』を summary に含める。未計測の subskill があれば触れる。",
].join("\n");

const ROLE_LEADER = [
  "役割: LEADER（global learner model）。3つの領域の要約を横断して、学習者全体の傾向と『次の一歩』を決める。",
  "- 原則: skills are local, learner is global。領域ごとの数値は与えられたものだけを使う。",
  "- 直近7日の偏り（eventsLast7Days）と、未計測・信頼度 low の領域を考慮する。",
  "- summary は3文構成: (1) 各領域のスコアを数値付きで一言ずつ (2) 横断的に見える傾向 (3) 信頼度 low の領域があれば暫定であること。100〜140字。",
  "- recommendation は『DOMAIN: 具体的な課題の方向』の形で1文。recommended_domain はそれと一致させる。",
  "- last_event があれば、その1問に一言触れる。",
].join("\n");

const ROLE_GENERATE = [
  "役割: 学習者の依頼にもとづき、指定の domain / kind / difficulty で課題を1問作る。",
  "- 問題は自己完結で、passage と prompt だけで解けること。実在の個人・時事の断定・医療/法律の助言を避ける。",
  "- choice は選択肢4つ、正解は1つだけ、他は明確に誤り。short は表記ゆれの正解候補を複数。free は rubric を広めに。",
  "- hints は3段。1段目は問い返し、3段目でも答えの値・完成文を書かない。",
  "- CODE（LOGIC）は Python の短いコード（出力予測・バグ発見）か、手順・条件・推論のパズルのどちらか。request の先頭にある【形式: …】の指定に必ず従う（『論理パズル』ならコードを出さない）。",
  "- passage にマークダウンのコードフェンス（```）や装飾を使わない。プレーンテキストのみ。",
  "- 直近の題材（recent_titles）と重ならない題材にする。",
].join("\n");

function personaText(p?: PersonaPrompt): string {
  if (!p) return "";
  return [
    "",
    `あなたの人格: 名前「${p.name}」、一人称「${p.firstPerson}」。口調: ${p.tone}。`,
    p.extra ? `補足: ${p.extra}` : "",
    "名乗りは不要だが、文体はこの人格で一貫させる。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** UI はマークダウンを描画しないので、LLM が付けがちなバッククォートを落とす（再帰） */
function stripBackticks<T>(v: T): T {
  if (typeof v === "string") return v.replace(/```[a-zA-Z]*\n?/g, "").replace(/`/g, "") as T;
  if (Array.isArray(v)) return v.map(stripBackticks) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = stripBackticks(x);
    return out as T;
  }
  return v;
}

function fmt(label: string, value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return `## ${label}\n${body}`;
}

export class OpenAIProvider implements LearningAIProvider {
  readonly name = "openai";
  private client: OpenAI;
  private model: string;
  private fallback = new MockProvider();

  constructor() {
    if (!env.ai.openaiApiKey) throw new Error("OPENAI_API_KEY is not configured");
    this.client = new OpenAI({ apiKey: env.ai.openaiApiKey, timeout: env.ai.openaiTimeoutMs, maxRetries: 1 });
    this.model = env.ai.openaiModel;
  }

  private async parse<T extends z.ZodTypeAny>(
    role: string,
    persona: PersonaPrompt | undefined,
    user: string,
    schema: T,
    name: string,
    learnerRef: string,
  ): Promise<z.infer<T>> {
    const res = await this.client.responses.parse({
      model: this.model,
      instructions: `${COMMON}\n\n${role}${personaText(persona)}`,
      input: user,
      text: { format: zodTextFormat(schema, name) },
      // 学習コーチ用途は応答速度が重要なので推論量は控えめにする
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      store: false,
      user: learnerRef,
    });
    const parsed = res.output_parsed as z.infer<T> | null | undefined;
    if (!parsed) throw new Error(`structured output parse failed (${res.status ?? "unknown"})`);
    return stripBackticks(parsed);
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const user = [
      fmt("mode", input.mode),
      fmt("task", input.task),
      fmt("learner_answer", input.learnerAnswer),
      fmt("deterministic_result", input.deterministicResult === null ? "unknown" : input.deterministicResult ? "correct" : "incorrect"),
      fmt("heuristic_result", input.heuristicResult === null ? "n/a" : input.heuristicResult ? "meets_rubric" : "below_rubric"),
      fmt("hint_level", input.hintLevel),
      fmt("current_domain_profile", input.currentDomainProfile),
      fmt("recent_behavior", input.recentBehavior.join("\n") || "(なし)"),
      fmt("allowed_skill_tags", SUBSKILLS[domain]),
    ].join("\n\n");
    const out = await this.parse(ROLE_EVAL, input.persona, user, evalSchema, "evaluation", input.learnerRef);

    let status = out.status;
    if (input.deterministicResult === true) status = "success";
    if (input.deterministicResult === false && status === "success") status = "retry";
    const fallbackHint = input.task.hints[Math.min(input.hintLevel, input.task.hints.length - 1)] ?? "";
    return {
      status,
      feedback: out.feedback,
      hint: status === "success" ? "" : out.hint || fallbackHint,
      observations: out.observations.slice(0, 3),
      skillTags: out.skill_tags.filter((t) => (SUBSKILLS[domain] as readonly string[]).includes(t)),
      recommendedNextDifficulty: out.recommended_next_difficulty,
    };
  }

  async interpretDomain(input: DomainInterpretInput): Promise<DomainInterpretOutput> {
    if (input.stats.evidenceCount === 0) return this.fallback.interpretDomain(input);
    const domain = MODE_TO_DOMAIN[input.mode];
    const user = [
      fmt("mode", input.mode),
      fmt("domain_label", DOMAIN_META[domain].label),
      fmt("subskills_in_this_domain", SUBSKILLS[domain]),
      fmt("stats", input.stats),
      fmt("recent_events", input.recentEvents),
    ].join("\n\n");
    const out = await this.parse(ROLE_INTERPRET, input.persona, user, interpretSchema, "interpretation", input.learnerRef);
    return { summary: out.summary, observations: out.observations.slice(0, 3), recommendedNext: out.recommended_next };
  }

  async leader(input: LeaderInput): Promise<LeaderOutput> {
    if (input.totalEvents === 0) return this.fallback.leader(input);
    const user = [
      fmt("domains", input.domains),
      fmt("total_events", input.totalEvents),
      fmt("last_event", input.lastEvent ?? "(なし)"),
      fmt("context", input.context ?? "(なし)"),
    ].join("\n\n");
    const out = await this.parse(ROLE_LEADER, input.persona, user, leaderSchema, "leader", input.learnerRef);
    return {
      summary: out.summary,
      interests: out.interests.slice(0, 3),
      preferences: {},
      observations: out.observations.slice(0, 3),
      recommendation: out.recommendation,
      recommendedDomain: (DOMAINS as readonly string[]).includes(out.recommended_domain) ? out.recommended_domain : "CODE",
    };
  }

  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    const user = [
      fmt("request", input.request),
      fmt("domain", `${input.domain}（${DOMAIN_META[input.domain].label} / ${DOMAIN_META[input.domain].ja}）`),
      fmt("kind", input.kind),
      fmt("difficulty", input.difficulty),
      fmt("allowed_skill_tags", input.allowedSkillTags),
      fmt("recent_titles", input.recentTitles),
    ].join("\n\n");
    const out = await this.parse(ROLE_GENERATE, input.persona, user, generateSchema, "generated_task", input.learnerRef);

    const hints = [...out.hints, "", "", ""].slice(0, 3) as [string, string, string];
    const skillTags = out.skill_tags.filter((t) => input.allowedSkillTags.includes(t));
    if (input.kind === "choice") {
      if (out.choices.length !== 4 || out.answer_index < 0 || out.answer_index > 3) {
        throw new Error("generated choice task is malformed");
      }
      return {
        title: out.title,
        passage: out.passage,
        prompt: out.prompt,
        choices: out.choices,
        answerKey: [String(out.answer_index)],
        rubric: null,
        hints,
        explanation: out.explanation,
        skillTags: skillTags.length ? skillTags : [input.allowedSkillTags[0]],
      };
    }
    if (input.kind === "short") {
      if (out.short_answers.length === 0) throw new Error("generated short task has no answer");
      return {
        title: out.title,
        passage: out.passage,
        prompt: out.prompt,
        choices: [],
        answerKey: out.short_answers,
        rubric: null,
        hints,
        explanation: out.explanation,
        skillTags: skillTags.length ? skillTags : [input.allowedSkillTags[0]],
      };
    }
    return {
      title: out.title,
      passage: out.passage,
      prompt: out.prompt,
      choices: [],
      answerKey: [],
      rubric: {
        mustInclude: out.rubric_must_include,
        minLength: out.rubric_min_length || 40,
        maxLength: out.rubric_max_length || 400,
        criteria: out.rubric_criteria.length ? out.rubric_criteria : ["設問の要求に答えているか"],
      },
      hints,
      explanation: out.explanation,
      skillTags: skillTags.length ? skillTags : [input.allowedSkillTags[0]],
    };
  }
}
