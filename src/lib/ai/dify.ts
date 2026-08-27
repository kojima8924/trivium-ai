// Dify provider: Dify Workflow API (POST /workflows/run, blocking) を server-side から呼ぶ。
// API key は環境変数のみ。PII は渡さない（learnerRef は内部UUID）。
// 失敗時は例外を投げ、呼び出し側（LearningAIService）が Mock にフォールバックする。
//
// 対応する Workflow（dify/*.yml。dify/build_dsl.py から生成）:
//   trivium-domain   … evaluate / interpretDomain（DIFY_DOMAIN_API_KEY）
//   trivium-leader   … leader（DIFY_LEADER_API_KEY）
//   trivium-generate … generateTask（DIFY_GENERATE_API_KEY）
// inputs のキー名は DSL の Start 変数と完全一致させる（dify/validate.py が検査する）。

import "server-only";
import { z } from "zod";
import { env } from "../env";
import { MockProvider } from "./mock";
import {
  deterministicResultText,
  fallbackHint,
  filterSkillTags,
  heuristicResultText,
  safeEvaluationStatus,
  stripJsonCodeFence,
} from "./shared";
import type {
  ChatInput,
  ChatOutput,
  DomainEvalInput,
  DomainEvalOutput,
  DomainInterpretInput,
  DomainInterpretOutput,
  GenerateTaskInput,
  GenerateTaskOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  LeaderInput,
  LeaderOutput,
  LearningAIProvider,
  PersonaPrompt,
} from "./types";
import { AI_SYSTEM_POLICY } from "./types";
import { DOMAINS, SUBSKILLS, type DomainKey } from "../domain";

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = { read: "READ", write: "WRITE", code: "CODE" };

const evalSchema = z.object({
  status: z.enum(["success", "retry", "needs_more"]),
  feedback: z.string().default(""),
  hint: z.string().default(""),
  observations: z.array(z.string()).default([]),
  skill_tags: z.array(z.string()).default([]),
  recommended_next_difficulty: z.coerce.number().min(1).max(10).default(3),
});

const interpretSchema = z.object({
  summary: z.string().default(""),
  observations: z.array(z.string()).default([]),
  recommended_next: z.string().default(""),
});

const leaderSchema = z.object({
  summary: z.string().default(""),
  interests: z.array(z.string()).default([]),
  preferences: z.record(z.string(), z.string()).default({}),
  observations: z.array(z.string()).default([]),
  recommendation: z.string().default(""),
  recommended_domain: z.string().optional(),
});

// src/lib/ai/openai.ts の generateSchema と同じキー（DSL の System にも同じ 13 キーを明記）
const generateSchema = z.object({
  title: z.string().min(1),
  passage: z.string().default(""),
  prompt: z.string().min(1),
  choices: z.array(z.string()).default([]),
  answer_index: z.coerce.number().int().min(-1).max(3).default(-1),
  short_answers: z.array(z.string()).default([]),
  rubric_must_include: z.array(z.string()).default([]),
  rubric_criteria: z.array(z.string()).default([]),
  rubric_min_length: z.coerce.number().int().default(0),
  rubric_max_length: z.coerce.number().int().default(0),
  hints: z.array(z.string()).default([]),
  explanation: z.string().default(""),
  skill_tags: z.array(z.string()).default([]),
});

type DifyRunResponse = {
  data?: { status?: string; outputs?: Record<string, unknown>; error?: string | null };
  message?: string;
};

class DifyError extends Error {}

/** 人格は JSON 文字列で渡す（無ければ空文字。DSL 側は空なら既定の口調） */
function personaInput(p?: PersonaPrompt): string {
  if (!p) return "";
  return JSON.stringify({ name: p.name, tone: p.tone, firstPerson: p.firstPerson, extra: p.extra });
}

/** 時事ネタの依頼だけ Web 検索を挟む（決定論。検索は遅く高価なので既定は使わない） */
function wantsSearch(request: string): boolean {
  return /(ニュース|時事|最近の|今日の|今週の|今月の|話題|最新)/.test(request);
}

export class DifyProvider implements LearningAIProvider {
  readonly name = "dify";
  private fallback = new MockProvider();

  private async run(apiKey: string, inputs: Record<string, unknown>, user: string): Promise<Record<string, unknown>> {
    if (!apiKey) throw new DifyError("Dify API key is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.ai.difyTimeoutMs);
    try {
      const res = await fetch(`${env.ai.difyApiBase.replace(/\/$/, "")}/workflows/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs, response_mode: "blocking", user }),
        signal: controller.signal,
      });
      if (!res.ok) throw new DifyError(`Dify HTTP ${res.status}`);
      const json = (await res.json()) as DifyRunResponse;
      if (json.data?.status && json.data.status !== "succeeded") {
        throw new DifyError(`Dify workflow ${json.data.status}: ${json.data.error ?? ""}`);
      }
      return json.data?.outputs ?? {};
    } finally {
      clearTimeout(timer);
    }
  }

  /** outputs は { result: "<json文字列>" } か、直接フィールドが並ぶ形のどちらも許容 */
  private extract(outputs: Record<string, unknown>): unknown {
    const candidates = [outputs.result, outputs.output, outputs.text, outputs.json, outputs];
    for (const c of candidates) {
      if (typeof c === "string") {
        const s = stripJsonCodeFence(c);
        try {
          return JSON.parse(s);
        } catch {
          continue;
        }
      }
      if (c && typeof c === "object") return c;
    }
    throw new DifyError("Dify output is not JSON");
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const outputs = await this.run(
      env.ai.difyDomainApiKey,
      {
        workflow: "domain",
        mode: input.mode,
        policy: AI_SYSTEM_POLICY.join("\n"),
        persona: personaInput(input.persona),
        task: JSON.stringify(input.task),
        learner_answer: input.learnerAnswer,
        deterministic_result: deterministicResultText(input.deterministicResult),
        heuristic_result: heuristicResultText(input.heuristicResult),
        hint_level: input.hintLevel,
        current_domain_profile: JSON.stringify(input.currentDomainProfile),
        recent_behavior: input.recentBehavior.join("\n"),
      },
      input.learnerRef,
    );
    const parsed = evalSchema.safeParse(this.extract(outputs));
    if (!parsed.success) throw new DifyError("Dify eval output schema mismatch");
    const d = parsed.data;
    const status = safeEvaluationStatus(d.status, input.deterministicResult);
    return {
      status,
      feedback: d.feedback,
      hint: status === "success" ? "" : d.hint || fallbackHint(input.task.hints, input.hintLevel),
      observations: d.observations,
      skillTags: filterSkillTags(d.skill_tags, SUBSKILLS[MODE_TO_DOMAIN[input.mode]]),
      recommendedNextDifficulty: d.recommended_next_difficulty,
    };
  }

  async interpretDomain(input: DomainInterpretInput): Promise<DomainInterpretOutput> {
    const outputs = await this.run(
      env.ai.difyDomainApiKey,
      {
        workflow: "interpret",
        mode: input.mode,
        policy: AI_SYSTEM_POLICY.join("\n"),
        persona: personaInput(input.persona),
        stats: JSON.stringify(input.stats),
        recent_events: JSON.stringify(input.recentEvents),
      },
      input.learnerRef,
    );
    const parsed = interpretSchema.safeParse(this.extract(outputs));
    if (!parsed.success) throw new DifyError("Dify interpret output schema mismatch");
    const fallback = await this.fallback.interpretDomain(input);
    return {
      summary: parsed.data.summary || fallback.summary,
      observations: parsed.data.observations.length ? parsed.data.observations : fallback.observations,
      recommendedNext: parsed.data.recommended_next || fallback.recommendedNext,
    };
  }

  async leader(input: LeaderInput): Promise<LeaderOutput> {
    const outputs = await this.run(
      env.ai.difyLeaderApiKey,
      {
        workflow: "leader",
        policy: AI_SYSTEM_POLICY.join("\n"),
        persona: personaInput(input.persona),
        domains: JSON.stringify(input.domains),
        total_events: input.totalEvents,
        last_event: input.lastEvent ? JSON.stringify(input.lastEvent) : "",
        context: input.context ?? "",
      },
      input.learnerRef,
    );
    const parsed = leaderSchema.safeParse(this.extract(outputs));
    if (!parsed.success) throw new DifyError("Dify leader output schema mismatch");
    const fallback = await this.fallback.leader(input);
    const rd = parsed.data.recommended_domain?.toUpperCase();
    return {
      summary: parsed.data.summary || fallback.summary,
      interests: parsed.data.interests.length ? parsed.data.interests : fallback.interests,
      preferences: Object.keys(parsed.data.preferences).length ? parsed.data.preferences : fallback.preferences,
      observations: parsed.data.observations.length ? parsed.data.observations : fallback.observations,
      recommendation: parsed.data.recommendation || fallback.recommendation,
      recommendedDomain: (DOMAINS as readonly string[]).includes(rd ?? "")
        ? (rd as DomainKey)
        : fallback.recommendedDomain,
    };
  }

  /**
   * 作問（trivium-generate）。DIFY_GENERATE_API_KEY が無ければ Mock の定型問題に委譲する。
   * ※ env.ts に difyGenerateApiKey を足すのが本筋だが、env.ts は他担当の管理なので、ここでは直接読む。
   */
  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    const apiKey = (env.ai as { difyGenerateApiKey?: string }).difyGenerateApiKey ?? process.env.DIFY_GENERATE_API_KEY ?? "";
    if (!apiKey) return this.fallback.generateTask(input);

    const outputs = await this.run(
      apiKey,
      {
        workflow: "generate",
        policy: AI_SYSTEM_POLICY.join("\n"),
        persona: personaInput(input.persona),
        request: input.request,
        domain: input.domain,
        kind: input.kind,
        difficulty: input.difficulty,
        allowed_skill_tags: input.allowedSkillTags.join(","),
        recent_titles: input.recentTitles.join("\n"),
        use_search: wantsSearch(input.request) ? "true" : "false",
      },
      input.learnerRef,
    );
    const parsed = generateSchema.safeParse(this.extract(outputs));
    if (!parsed.success) throw new DifyError("Dify generate output schema mismatch");
    const out = parsed.data;

    const hints = [...out.hints, "", "", ""].slice(0, 3) as [string, string, string];
    const skillTags = filterSkillTags(out.skill_tags, input.allowedSkillTags);
    const tags = skillTags.length ? skillTags : [input.allowedSkillTags[0]];

    if (input.kind === "choice") {
      if (out.choices.length !== 4 || out.answer_index < 0 || out.answer_index > 3) {
        throw new DifyError("Dify generated choice task is malformed");
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
        skillTags: tags,
      };
    }
    if (input.kind === "short") {
      if (out.short_answers.length === 0) throw new DifyError("Dify generated short task has no answer");
      return {
        title: out.title,
        passage: out.passage,
        prompt: out.prompt,
        choices: [],
        answerKey: out.short_answers,
        rubric: null,
        hints,
        explanation: out.explanation,
        skillTags: tags,
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
      skillTags: tags,
    };
  }

  /** 会話・観察メモは OpenAI provider の担当。Dify ではワークフロー未定義なので Mock に委譲する */
  async chat(input: ChatInput): Promise<ChatOutput> {
    return this.fallback.chat(input);
  }

  async updateMemory(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    return this.fallback.updateMemory(input);
  }
}
