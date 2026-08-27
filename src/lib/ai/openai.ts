// OpenAIProvider: OpenAI Responses API をサーバ側から直接呼ぶ provider（既定の primary）。
// - 出力は structured outputs（zod）で固定
// - system policy 7 か条と人格（persona）を prompt に載せる
// - API key は環境変数のみ。PII は渡さない（learnerRef は内部ID）
import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env";
import { EXTERNAL, MODELS, LINE } from "@/config/trivium.config";
import { DOMAINS, DOMAIN_META, SUBSKILLS, type DomainKey } from "../domain";
import { MockProvider } from "./mock";
import {
  deterministicResultText,
  fallbackHint,
  filterSkillTags,
  heuristicResultText,
  safeEvaluationStatus,
  stripBackticks,
} from "./shared";
import {
  AI_SYSTEM_POLICY,
  type ChatInput,
  type ChatOutput,
  type MemoryUpdateInput,
  type MemoryUpdateOutput,
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
  recommended_next_difficulty: z.number().int().min(1).max(10),
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
  "役割: ADVISOR（案内役。global learner model）。3つの領域の要約を横断して、学習者全体の傾向と『次の一歩』を決める。",
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
    "名乗りは不要だが、文体はこの人格で一貫させる。口癖・決め台詞は毎回ではなく時々（3回に1回ほど）。",
    "人格の設定より『答え・誤りの場所を言わない』方針が優先する。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 現在時刻（JST）。system ではなく input に入れる（system を安定させてキャッシュを効かせる） */
function nowText(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "full", timeStyle: "short" }).format(now);
}

function fmt(label: string, value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return `## ${label}\n${body}`;
}

// ---- 会話・メモ ----

const chatSchema = z.object({
  text: z.string().describe("LINE に送る返答。3 文以内・日本語。必ず『次の一歩』を 1 つ含める。答えは教えない"),
  suggest_domain: z.enum(["READ", "WRITE", "CODE", "NONE"]).describe("会話から勧めたい系統。無ければ NONE"),
  sources: z.array(z.string()).describe("Web 検索を使ったときの出典 URL（最大 2 件）。使わなければ空"),
});

const memorySchema = z.object({
  notes: z.string().describe("観察メモ。行動の傾向と『次に見たいこと』を、数値を書かずに簡潔に。上限字数を守る"),
});

const ROLE_CHAT = [
  "役割: LINE で学習者と自由に会話する人格。雑談・相談・学習内容の説明・時事や一般知識の質問にも普通に応じる。",
  `- 返答は ${LINE.chatMaxSentences} 文以内。『次の一歩』（例: 『LOGIC を 1 問』『Dashboard で三角形を見る』）は会話の流れで自然なときだけ添える。毎回は付けない。`,
  "- 出題中の課題の答え・完成文は書かない。一般的な概念や考え方の説明は自由にしてよい（例: 二分探索の一般的な仕組み、要約のコツ）。",
  "- memory（観察メモ）と profile（能力サマリ）は、本人がそれに関係する話をしたときだけ使う。無関係な雑談に成績の話を持ち込まない。証拠が無いことは断定しない。",
  "- 日付・時刻・時事・最新情報を聞かれたら、now を使い、必要なら Web 検索で確かめる（検索した場合は sources に URL）。",
  "- conversation は直近の往復。文脈を引き継ぎ、同じ言い回しを繰り返さない。",
  "- 人格（口調・一人称）を一貫させる。ツンデレ等の性格付けは会話で最も出してよい場面。",
].join("\n");

const ROLE_MEMORY = [
  "役割: 決着した 1 問を踏まえて、この人格が持つ学習者の観察メモを書き直す。",
  "- メモは本人に見せない内部用。行動の傾向（どこで詰まる・どう立て直す・何が得意か）と『次に見たいこと』を書く。",
  "- 数値（スコア・件数・正答率）は書かない。性格の断定もしない。証拠が少なければその旨を残す。",
  "- 既存メモ（previous_notes）を引き継ぎつつ、古くなった観察は消す。上限字数（max_chars）を厳守。",
  "- agent が LEADER（表示名 ADVISOR）の場合は 3 系統のメモを横断して、学習者全体の傾向と、系統間のつながりを書く。",
].join("\n");

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

  /**
   * structured output 付きの 1 回呼び出し。
   * - instructions（system）= ポリシー＋役割＋人格（運営設定）。安定させてキャッシュを効かせる
   * - input（user）= 課題・回答・記録・会話履歴などユーザー由来の情報。先頭に現在時刻（JST）を付ける
   * - tools を渡すと Web 検索をモデル判断で使う（許可は EXTERNAL.webSearchAllowed の経路だけ）
   */
  private async parse<T extends z.ZodTypeAny>(
    role: string,
    persona: PersonaPrompt | undefined,
    user: string,
    schema: T,
    name: string,
    learnerRef: string,
    opts: { model?: string; effort?: "none" | "minimal" | "low" | "medium" | "high"; search?: boolean; maxOutputTokens?: number } = {},
  ): Promise<{ parsed: z.infer<T>; usedSearch: boolean }> {
    const input = EXTERNAL.includeDateTime ? `${fmt("now", nowText())}\n\n${user}` : user;
    const res = await this.client.responses.parse({
      model: opts.model ?? this.model,
      instructions: `${COMMON}\n\n${role}${personaText(persona)}`,
      input,
      text: { format: zodTextFormat(schema, name) },
      // 学習コーチ用途は応答速度が重要なので推論量は控えめにする（役割ごとに MODELS.reasoningEffort）
      reasoning: { effort: opts.effort ?? "low" },
      max_output_tokens: opts.maxOutputTokens ?? 1200,
      store: false,
      user: learnerRef,
      ...(opts.search ? { tools: [{ type: "web_search" as const }], tool_choice: "auto" as const } : {}),
    });
    const parsed = res.output_parsed as z.infer<T> | null | undefined;
    if (!parsed) throw new Error(`structured output parse failed (${res.status ?? "unknown"})`);
    const usedSearch = (res.output ?? []).some((item) => item.type === "web_search_call");
    return { parsed: stripBackticks(parsed), usedSearch };
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const user = [
      fmt("mode", input.mode),
      fmt("task", input.task),
      fmt("learner_answer", input.learnerAnswer),
      fmt("deterministic_result", deterministicResultText(input.deterministicResult)),
      fmt("heuristic_result", heuristicResultText(input.heuristicResult)),
      fmt("hint_level", input.hintLevel),
      fmt("current_domain_profile", input.currentDomainProfile),
      fmt("recent_behavior", input.recentBehavior.join("\n") || "(なし)"),
      fmt("allowed_skill_tags", SUBSKILLS[domain]),
    ].join("\n\n");
    const { parsed: out } = await this.parse(ROLE_EVAL, input.persona, user, evalSchema, "evaluation", input.learnerRef, {
      model: MODELS.evaluate,
      effort: MODELS.reasoningEffort.evaluate,
    });

    const status = safeEvaluationStatus(out.status, input.deterministicResult);
    const safeHint = fallbackHint(input.task.hints, input.hintLevel);
    return {
      status,
      feedback: out.feedback,
      hint: status === "success" ? "" : out.hint || safeHint,
      observations: out.observations.slice(0, 3),
      skillTags: filterSkillTags(out.skill_tags, SUBSKILLS[domain]),
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
    const { parsed: out } = await this.parse(ROLE_INTERPRET, input.persona, user, interpretSchema, "interpretation", input.learnerRef, {
      model: MODELS.interpret,
      effort: MODELS.reasoningEffort.interpret,
    });
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
    const { parsed: out } = await this.parse(ROLE_LEADER, input.persona, user, leaderSchema, "leader", input.learnerRef, {
      model: MODELS.leader,
      effort: MODELS.reasoningEffort.leader,
    });
    return {
      summary: out.summary,
      interests: out.interests.slice(0, 3),
      preferences: {},
      observations: out.observations.slice(0, 3),
      recommendation: out.recommendation,
      recommendedDomain: (DOMAINS as readonly string[]).includes(out.recommended_domain) ? out.recommended_domain : "CODE",
    };
  }

  /** LINE の会話（人格ごと）。system=人格、input=時刻・メモ・能力サマリ・会話履歴・発話 */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const conversation = input.history.map((t) => `${t.role === "user" ? "learner" : input.persona.name}: ${t.text}`).join("\n");
    const user = [
      fmt("memory", input.memoryNotes || "(まだ観察メモは無い)"),
      fmt("profile", input.profileSummary || "(まだ学習記録が無い)"),
      fmt("conversation", conversation || "(最初の発話)"),
      fmt("learner_says", input.userText),
    ].join("\n\n");
    const { parsed, usedSearch } = await this.parse(ROLE_CHAT, input.persona, user, chatSchema, "chat_reply", input.learnerRef, {
      model: MODELS.chat,
      effort: MODELS.reasoningEffort.chat,
      search: input.allowSearch && EXTERNAL.webSearchAllowed.chat,
      maxOutputTokens: 600,
    });
    const sources = parsed.sources.filter((s) => /^https?:\/\//.test(s)).slice(0, 2);
    // LINE はマークダウンを描画しないので、太字・インラインリンク・検索由来の引用マーカーを平文に落とす
    const plain = parsed.text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)/g, "")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    const text = sources.length ? `${plain}\n出典: ${sources.join(" ")}` : plain;
    const suggest = parsed.suggest_domain === "NONE" ? null : parsed.suggest_domain;
    return { text, suggestDomain: (DOMAINS as readonly string[]).includes(suggest ?? "") ? (suggest as DomainKey) : null, usedSearch };
  }

  /** 観察メモの更新（数値を書かない・上限字数）。失敗時は呼び出し側が catch する */
  async updateMemory(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    const user = [
      fmt("agent", input.agent),
      fmt("max_chars", input.maxChars),
      fmt("previous_notes", input.previousNotes || "(なし)"),
      input.event ? fmt("settled_event", input.event) : "",
      input.domainNotes?.length ? fmt("domain_notes", input.domainNotes) : "",
      input.leaderSummary ? fmt("leader_summary", input.leaderSummary) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const { parsed } = await this.parse(ROLE_MEMORY, input.persona, user, memorySchema, "memory_notes", input.learnerRef, {
      model: MODELS.interpret,
      effort: MODELS.reasoningEffort.interpret,
      maxOutputTokens: 700,
    });
    return { notes: parsed.notes.slice(0, input.maxChars) };
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
    // 作問は品質重視のモデル。時事ネタの依頼だけ Web 検索を許可（EXTERNAL.webSearchAllowed.generate）
    const wantsSearch = EXTERNAL.webSearchAllowed.generate && /(時事|ニュース|最近の|最新|今日の話題|話題の)/.test(input.request);
    const { parsed: out } = await this.parse(ROLE_GENERATE, input.persona, user, generateSchema, "generated_task", input.learnerRef, {
      model: MODELS.generate,
      effort: MODELS.reasoningEffort.generate,
      search: wantsSearch,
      maxOutputTokens: 2000,
    });

    const hints = [...out.hints, "", "", ""].slice(0, 3) as [string, string, string];
    const skillTags = filterSkillTags(out.skill_tags, input.allowedSkillTags);
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
