// OpenAIProvider: OpenAI Responses API をサーバ側から直接呼ぶ provider（既定の primary）。
// - 出力は structured outputs（zod → ./schemas.ts）で固定
// - system policy 7 か条と人格（persona）を prompt（./prompts.ts）に載せる
// - API key は環境変数のみ。PII は渡さない（learnerRef は内部ID）
import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "../env";
import { EXTERNAL, MODELS } from "@/config/trivium.config";
import { DOMAINS, DOMAIN_META, SUBSKILLS, type DomainKey } from "../domain";
import { MockProvider } from "./mock";
import { deterministicResultText, fallbackHint, filterSkillTags, heuristicResultText, safeEvaluationStatus, wrapLearnerAnswer } from "./shared";
import { fmt, nowText, stripBackticks, stripMarkdownForChat } from "./text";
import {
  COMMON,
  ROLE_CHAT,
  ROLE_EVAL,
  ROLE_GENERATE,
  ROLE_INTERPRET,
  ROLE_LEADER,
  ROLE_LINE_INTENT,
  ROLE_MEMORY,
  ROLE_RUN_PYTHON,
  personaText,
} from "./prompts";
import {
  chatSchema,
  evalSchema,
  generateSchema,
  interpretSchema,
  leaderSchema,
  lineIntentSchema,
  memorySchema,
  runPythonSchema,
  type GenerateSchemaOutput,
} from "./schemas";
import {
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
  type LineIntentGuess,
  type LineIntentInput,
} from "./types";

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

// ---- input（user 側）の組み立て。役割ごとに「何を渡すか」をここだけ見れば分かるようにする ----

function evalInput(input: DomainEvalInput, domain: DomainKey): string {
  return [
    fmt("mode", input.mode),
    fmt("task", input.task),
    wrapLearnerAnswer(input.learnerAnswer),
    fmt("deterministic_result", deterministicResultText(input.deterministicResult)),
    fmt("heuristic_result", heuristicResultText(input.heuristicResult)),
    fmt("hint_level", input.hintLevel),
    fmt("current_domain_profile", input.currentDomainProfile),
    fmt("recent_behavior", input.recentBehavior.join("\n") || "(なし)"),
    fmt("allowed_skill_tags", SUBSKILLS[domain]),
  ].join("\n\n");
}

function interpretInput(input: DomainInterpretInput, domain: DomainKey): string {
  return [
    fmt("mode", input.mode),
    fmt("domain_label", DOMAIN_META[domain].label),
    fmt("subskills_in_this_domain", SUBSKILLS[domain]),
    fmt("stats", input.stats),
    fmt("recent_events", input.recentEvents),
  ].join("\n\n");
}

function leaderInput(input: LeaderInput): string {
  return [
    fmt("domains", input.domains),
    fmt("total_events", input.totalEvents),
    fmt("last_event", input.lastEvent ?? "(なし)"),
    fmt("context", input.context ?? "(なし)"),
  ].join("\n\n");
}

function chatInput(input: ChatInput): string {
  const conversation = input.history.map((t) => `${t.role === "user" ? "learner" : input.persona.name}: ${t.text}`).join("\n");
  return [
    fmt("memory", input.memoryNotes || "(まだ観察メモは無い)"),
    fmt("profile", input.profileSummary || "(まだ学習記録が無い)"),
    ...(input.sharedContext ? [fmt("shared_context", `${input.sharedContext}\n\n（他の担当との会話や直近の課題は把握している前提で自然に続ける。「さっきの問題」と言われたらこれを指す。答え・誤りの箇所を言わない方針は同じ）`)] : []),
    ...(input.currentTask ? [fmt("current_task", `${input.currentTask}\n\n（この課題について聞かれたら: 答え・正解の選択肢・誤りの箇所は言わない。考え方の一段だけ示すか、問い返す）`)] : []),
    fmt("conversation", conversation || "(最初の発話)"),
    fmt("learner_says", input.userText),
  ].join("\n\n");
}

function memoryInput(input: MemoryUpdateInput): string {
  return [
    fmt("agent", input.agent),
    fmt("max_chars", input.maxChars),
    fmt("previous_notes", input.previousNotes || "(なし)"),
    input.event ? fmt("settled_event", input.event) : "",
    input.domainNotes?.length ? fmt("domain_notes", input.domainNotes) : "",
    input.leaderSummary ? fmt("leader_summary", input.leaderSummary) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function generateInput(input: GenerateTaskInput): string {
  return [
    fmt("request", input.request),
    fmt("domain", `${input.domain}（${DOMAIN_META[input.domain].label} / ${DOMAIN_META[input.domain].ja}）`),
    fmt("kind", input.kind),
    fmt("difficulty", input.difficulty),
    fmt("allowed_skill_tags", input.allowedSkillTags),
    fmt("recent_titles", input.recentTitles),
  ].join("\n\n");
}

/** free 課題の rubric。模範解答があれば字数の上下限はその長さ（0.6〜1.6 倍）から決め、長すぎる要求を防ぐ */
function freeRubric(out: GenerateSchemaOutput): NonNullable<GenerateTaskOutput["rubric"]> {
  const sample = out.model_answer.trim();
  const n = sample.length;
  const minLength = n >= 30 ? Math.max(30, Math.round(n * 0.6)) : out.rubric_min_length || 40;
  const maxLength = n >= 30 ? Math.max(minLength + 40, Math.round(n * 1.6)) : out.rubric_max_length || 300;
  return {
    mustInclude: out.rubric_must_include,
    minLength,
    maxLength,
    criteria: out.rubric_criteria.length ? out.rubric_criteria : ["設問の要求に答えているか"],
    ...(sample ? { sampleAnswer: sample } : {}),
  };
}

/** 作問の共通後処理（ヒント 3 段への揃え・skill_tags の絞り込み） */
function generateCommon(out: GenerateSchemaOutput, allowedSkillTags: readonly string[]) {
  const hints = [...out.hints, "", "", ""].slice(0, 3) as [string, string, string];
  const skillTags = filterSkillTags(out.skill_tags, allowedSkillTags);
  return {
    title: out.title,
    passage: out.passage,
    prompt: out.prompt,
    hints,
    explanation: out.explanation,
    skillTags: skillTags.length ? skillTags : [allowedSkillTags[0]],
  };
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
    opts: {
      model?: string;
      effort?: "none" | "minimal" | "low" | "medium" | "high";
      search?: boolean;
      /** code_interpreter（サンドボックスで Python を実行）を許可する。作問の検証専用 */
      codeInterpreter?: boolean;
      maxOutputTokens?: number;
    } = {},
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
      ...(opts.codeInterpreter
        ? { tools: [{ type: "code_interpreter" as const, container: { type: "auto" as const } }], tool_choice: "required" as const }
        : {}),
    });
    const parsed = res.output_parsed as z.infer<T> | null | undefined;
    if (!parsed) throw new Error(`structured output parse failed (${res.status ?? "unknown"})`);
    const usedSearch = (res.output ?? []).some((item) => item.type === "web_search_call");
    return { parsed: stripBackticks(parsed), usedSearch };
  }

  /** LINE の自由文の意図判定（明示語ではなく意味で分岐。小さなモデル・最小推論） */
  async classifyLineIntent(input: LineIntentInput): Promise<LineIntentGuess | null> {
    try {
      const user = [
        fmt("text", input.text.slice(0, 500)),
        fmt("context", `linked=${input.linked} pending_task=${input.pendingTask} personas=${input.personaNames.join("/")}`),
      ].join(String.fromCharCode(10));
      const { parsed } = await this.parse(ROLE_LINE_INTENT, undefined, user, lineIntentSchema, "line_intent", "intent", {
        model: MODELS.intent,
        // minimal は gpt-5.4 系・5.6 系とも未対応（400）。low が実質の最小
        effort: "low",
        maxOutputTokens: 200,
      });
      return {
        kind: parsed.kind,
        domain: parsed.domain === "NONE" ? null : parsed.domain,
        difficulty: parsed.difficulty >= 1 && parsed.difficulty <= 10 ? parsed.difficulty : null,
        confidence: parsed.confidence,
      };
    } catch (err) {
      console.warn("[ai] classifyLineIntent failed:", (err as Error).message);
      return null;
    }
  }

  /** テキスト中の Python コードをサンドボックスで実行して stdout を返す（作問の検証） */
  async runPython(text: string): Promise<{ stdout: string } | { error: string }> {
    try {
      const { parsed } = await this.parse(ROLE_RUN_PYTHON, undefined, fmt("text", text.slice(0, 6000)), runPythonSchema, "python_run", "verify", {
        model: MODELS.evaluate,
        effort: "low",
        codeInterpreter: true,
        maxOutputTokens: 1500,
      });
      if (parsed.error && !parsed.stdout) return { error: parsed.error };
      return { stdout: parsed.stdout };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const { parsed: out } = await this.parse(ROLE_EVAL, input.persona, evalInput(input, domain), evalSchema, "evaluation", input.learnerRef, {
      model: MODELS.evaluate,
      effort: MODELS.reasoningEffort.evaluate,
    });

    const status = safeEvaluationStatus(out.status, input.deterministicResult, input.heuristicResult);
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
    const { parsed: out } = await this.parse(ROLE_INTERPRET, input.persona, interpretInput(input, domain), interpretSchema, "interpretation", input.learnerRef, {
      model: MODELS.interpret,
      effort: MODELS.reasoningEffort.interpret,
    });
    return { summary: out.summary, observations: out.observations.slice(0, 3), recommendedNext: out.recommended_next };
  }

  async leader(input: LeaderInput): Promise<LeaderOutput> {
    if (input.totalEvents === 0) return this.fallback.leader(input);
    const { parsed: out } = await this.parse(ROLE_LEADER, input.persona, leaderInput(input), leaderSchema, "leader", input.learnerRef, {
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
    const { parsed, usedSearch } = await this.parse(ROLE_CHAT, input.persona, chatInput(input), chatSchema, "chat_reply", input.learnerRef, {
      model: MODELS.chat,
      effort: MODELS.reasoningEffort.chat,
      search: input.allowSearch && EXTERNAL.webSearchAllowed.chat,
      maxOutputTokens: 600,
    });
    const sources = parsed.sources.filter((s) => /^https?:\/\//.test(s)).slice(0, 2);
    // LINE はマークダウンを描画しないので、太字・インラインリンク・検索由来の引用マーカーを平文に落とす
    const plain = stripMarkdownForChat(parsed.text);
    const text = sources.length ? `${plain}\n出典: ${sources.join(" ")}` : plain;
    const suggest = parsed.suggest_domain === "NONE" ? null : parsed.suggest_domain;
    return { text, suggestDomain: (DOMAINS as readonly string[]).includes(suggest ?? "") ? (suggest as DomainKey) : null, usedSearch };
  }

  /** 観察メモの更新（数値を書かない・上限字数）。失敗時は呼び出し側が catch する */
  async updateMemory(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    const { parsed } = await this.parse(ROLE_MEMORY, input.persona, memoryInput(input), memorySchema, "memory_notes", input.learnerRef, {
      model: MODELS.interpret,
      effort: MODELS.reasoningEffort.interpret,
      maxOutputTokens: 700,
    });
    return { notes: parsed.notes.slice(0, input.maxChars) };
  }

  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    // 作問は品質重視のモデル。時事ネタの依頼だけ Web 検索を許可（EXTERNAL.webSearchAllowed.generate）
    const wantsSearch = EXTERNAL.webSearchAllowed.generate && /(時事|ニュース|最近の|最新|今日の話題|話題の)/.test(input.request);
    const { parsed: out } = await this.parse(ROLE_GENERATE, input.persona, generateInput(input), generateSchema, "generated_task", input.learnerRef, {
      model: MODELS.generate,
      effort: MODELS.reasoningEffort.generate,
      search: wantsSearch,
      // effort=high では推論トークンが多いので上限も上げる（不足すると incomplete で parse に失敗する）
      maxOutputTokens: 8000,
    });

    const common = generateCommon(out, input.allowedSkillTags);
    if (input.kind === "choice") {
      if (out.choices.length !== 4 || out.answer_index < 0 || out.answer_index > 3) {
        throw new Error("generated choice task is malformed");
      }
      return { ...common, choices: out.choices, answerKey: [String(out.answer_index)], rubric: null };
    }
    if (input.kind === "short") {
      if (out.short_answers.length === 0) throw new Error("generated short task has no answer");
      return { ...common, choices: [], answerKey: out.short_answers, rubric: null };
    }
    return { ...common, choices: [], answerKey: [], rubric: freeRubric(out) };
  }
}
