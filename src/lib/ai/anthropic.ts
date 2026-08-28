// DirectLLMProvider: Claude API をサーバ側から直接呼ぶ provider。
// Dify を経由しないので設定が最小で済む。API key は環境変数のみ、PII は渡さない（learnerRef は内部ID）。
// 出力は structured outputs（zod）で固定し、Mock と同じ契約（一段だけヒント・断定しない）を system で強制する。
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "../env";
import { DOMAINS, SUBSKILLS, type DomainKey } from "../domain";
import { MockProvider } from "./mock";
import { LEARNER_ANSWER_RULE, deterministicResultText, fallbackHint, filterSkillTags, heuristicResultText, safeEvaluationStatus, wrapLearnerAnswer } from "./shared";
// fmt は OpenAI provider と同一（JSON.stringify(v, null, 0) は既定と同じ出力）なので共通化した
import { fmt } from "./text";
import {
  AI_SYSTEM_POLICY,
  type DomainEvalInput,
  type DomainEvalOutput,
  type DomainInterpretInput,
  type DomainInterpretOutput,
  type ChatInput,
  type ChatOutput,
  type GenerateTaskInput,
  type GenerateTaskOutput,
  type MemoryUpdateInput,
  type MemoryUpdateOutput,
  type LeaderInput,
  type LeaderOutput,
  type LearningAIProvider,
} from "./types";

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

// ---- 出力スキーマ（structured outputs） ----

const evalSchema = z.object({
  status: z.enum(["success", "retry", "needs_more"]),
  feedback: z.string().describe("学習者への短い返答（2〜3文・日本語）。答えは書かない"),
  hint: z.string().describe("次の一段のヒント。success のときは空文字"),
  observations: z.array(z.string()).describe("学習行動についての観察（性格ではなく行動）。最大3件"),
  skill_tags: z.array(z.string()).describe("この回答から観察できた subskill タグ（task に紐づくもののみ）"),
  recommended_next_difficulty: z.number().int().min(1).max(10),
});

const interpretSchema = z.object({
  summary: z.string().describe("この領域の寸評。2〜3文・日本語。証拠が少なければ暫定である旨を明記"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件"),
  recommended_next: z.string().describe("次に取り組む課題の方向（1文）"),
});

const leaderSchema = z.object({
  summary: z.string().describe("学習者全体の総合寸評。3〜4文・日本語。数値は与えられたものだけを使う"),
  interests: z.array(z.string()).describe("関心・傾向（証拠に基づくもののみ）。最大3件"),
  preferences: z.record(z.string(), z.string()).describe("学習の好み（例: practiceFocus, preferredDifficulty）"),
  observations: z.array(z.string()).describe("行動ベースの観察。最大3件"),
  recommendation: z.string().describe("次のおすすめ。『DOMAIN: 具体的な課題の方向』の形で1文"),
  recommended_domain: z.enum(["READ", "WRITE", "CODE"]),
});

// ---- system prompt（安定した前置きは先頭に置き、キャッシュが効くようにする） ----

const POLICY_TEXT = AI_SYSTEM_POLICY.map((p, i) => `${i + 1}. ${p}`).join("\n");

const SYSTEM_COMMON = [
  "あなたは Trivium の学習コーチです。READ / WRITE / CODE の短い課題に取り組む中高生〜成人を支援します。",
  "コア思想: AI does not do the work for you. It helps you take the next step.",
  "",
  "System policy:",
  POLICY_TEXT,
  "",
  "共通ルール:",
  "- 出力は必ず日本語。敬体で簡潔に。summary は 140 字以内、feedback は 100 字以内、observations の各項目は 40 字以内、recommendation / recommended_next は 60 字以内。",
  "- 学習者の課題を代わりに完成させない。ヒントは一度に一段だけ。",
  "- 与えられた数値（スコア・件数）以外の数値を作らない。",
  "- 行動について述べ、性格や能力を断定しない。証拠が少ないときは不確かさを明示する。",
].join("\n");

const SYSTEM_EVAL = [
  SYSTEM_COMMON,
  "",
  "役割: 学習者の回答を評価し、feedback と（必要なら）一段だけのヒントを返す。",
  "- deterministic_result が correct のときは status を success にし、hint は空文字にする。",
  "- deterministic_result が incorrect のときは status を retry にし、hints 配列の hint_level 番目（0始まり）を土台に、一段だけのヒントを返す。範囲外なら最後のヒントを言い換える。答えそのものは書かない。",
  "- deterministic_result が unknown（自由記述）のときは criteria に照らして判断する。十分なら success、足りなければ needs_more にして、足りない観点を問い返す形のヒントを返す。heuristic_result が below_rubric なら success にしない。",
  "- feedback には正解の値や完成文を含めない（success 時に解説を添えるのは別の仕組みが行う）。",
  LEARNER_ANSWER_RULE,
].join("\n");

const SYSTEM_INTERPRET = [
  SYSTEM_COMMON,
  "",
  "役割: 決定論的に集計された stats（数値＝evidence）を解釈し、この領域の寸評・観察・次の方向を返す。",
  "- 数値を作らない・変えない。stats にある subskill と値だけを根拠にする。",
  "- confidence が low のときは『記録が少なく暫定』であることを summary に含める。未計測の subskill があれば触れる。",
].join("\n");

const SYSTEM_LEADER = [
  SYSTEM_COMMON,
  "",
  "役割: ADVISOR（案内役。global learner model）。3つの領域の要約を横断して、学習者全体の傾向と『次の一歩』を決める。",
  "- 原則: skills are local, learner is global。領域ごとの数値は与えられたものだけを使う。",
  "- 直近7日の偏り（eventsLast7Days）と、未計測・信頼度 low の領域を必ず考慮する。",
  "- recommendation は『DOMAIN: 具体的な課題の方向（難易度や subskill を含む）』の形で1文。recommended_domain はそれと一致させる。",
  "- last_event があれば、その1問に一言触れる（直近の行動が反映されていると学習者に伝わるため）。",
].join("\n");

export class AnthropicProvider implements LearningAIProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;
  private fallback = new MockProvider();

  constructor() {
    if (!env.ai.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    this.client = new Anthropic({ apiKey: env.ai.anthropicApiKey, timeout: env.ai.anthropicTimeoutMs, maxRetries: 1 });
    this.model = env.ai.anthropicModel;
  }

  private async parse<T extends z.ZodTypeAny>(
    system: string,
    user: string,
    schema: T,
    learnerRef: string,
  ): Promise<z.infer<T>> {
    const res = await this.client.messages.parse({
      model: this.model,
      // 出力は短い JSON なので上限を絞り、応答時間を安定させる
      max_tokens: 900,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      // 学習コーチ用途は短時間の応答が重要なので effort を下げる（Opus 5 の既定は adaptive thinking）
      output_config: { effort: "low", format: zodOutputFormat(schema) },
      metadata: { user_id: learnerRef },
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude refused the request");
    if (!res.parsed_output) throw new Error("structured output parse failed");
    return res.parsed_output as z.infer<T>;
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const user = [
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

    const out = await this.parse(SYSTEM_EVAL, user, evalSchema, input.learnerRef);

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
    const user = [
      fmt("mode", input.mode),
      fmt("subskills_in_this_domain", SUBSKILLS[domain]),
      fmt("stats", input.stats),
      fmt("recent_events", input.recentEvents),
    ].join("\n\n");
    const out = await this.parse(SYSTEM_INTERPRET, user, interpretSchema, input.learnerRef);
    return {
      summary: out.summary,
      observations: out.observations.slice(0, 3),
      recommendedNext: out.recommended_next,
    };
  }

  async leader(input: LeaderInput): Promise<LeaderOutput> {
    if (input.totalEvents === 0) return this.fallback.leader(input);
    const user = [
      fmt("domains", input.domains),
      fmt("total_events", input.totalEvents),
      fmt("last_event", input.lastEvent ?? "(なし)"),
      fmt("context", input.context ?? "(なし)"),
    ].join("\n\n");
    const out = await this.parse(SYSTEM_LEADER, user, leaderSchema, input.learnerRef);
    return {
      summary: out.summary,
      interests: out.interests.slice(0, 3),
      preferences: out.preferences,
      observations: out.observations.slice(0, 3),
      recommendation: out.recommendation,
      recommendedDomain: (DOMAINS as readonly string[]).includes(out.recommended_domain) ? out.recommended_domain : "CODE",
    };
  }

  /** 作問は OpenAI provider の担当。この provider では定型問題（Mock）に委譲する */
  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    return this.fallback.generateTask(input);
  }

  /** 会話・観察メモも OpenAI provider の担当。ここでは Mock に委譲する */
  async chat(input: ChatInput): Promise<ChatOutput> {
    return this.fallback.chat(input);
  }

  async updateMemory(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    return this.fallback.updateMemory(input);
  }
}
