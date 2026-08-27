// Dify provider: Dify Workflow API (POST /workflows/run, blocking) を server-side から呼ぶ。
// API key は環境変数のみ。PII は渡さない（learnerRef は内部UUID）。
// 失敗時は例外を投げ、呼び出し側（LearningAIService）が Mock にフォールバックする。

import "server-only";
import { z } from "zod";
import { env } from "../env";
import { MockProvider } from "./mock";
import type {
  DomainEvalInput,
  DomainEvalOutput,
  DomainInterpretInput,
  DomainInterpretOutput,
  GenerateTaskInput,
  GenerateTaskOutput,
  LeaderInput,
  LeaderOutput,
  LearningAIProvider,
} from "./types";
import { AI_SYSTEM_POLICY } from "./types";
import { DOMAINS, type DomainKey } from "../domain";

const evalSchema = z.object({
  status: z.enum(["success", "retry", "needs_more"]),
  feedback: z.string().default(""),
  hint: z.string().default(""),
  observations: z.array(z.string()).default([]),
  skill_tags: z.array(z.string()).default([]),
  recommended_next_difficulty: z.coerce.number().min(1).max(5).default(3),
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

type DifyRunResponse = {
  data?: { status?: string; outputs?: Record<string, unknown>; error?: string | null };
  message?: string;
};

export class DifyError extends Error {}

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
        const s = c.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
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
        task: JSON.stringify(input.task),
        learner_answer: input.learnerAnswer,
        deterministic_result:
          input.deterministicResult === null ? "unknown" : input.deterministicResult ? "correct" : "incorrect",
        heuristic_result:
          input.heuristicResult === null ? "n/a" : input.heuristicResult ? "meets_rubric" : "below_rubric",
        hint_level: input.hintLevel,
        current_domain_profile: JSON.stringify(input.currentDomainProfile),
        recent_behavior: input.recentBehavior.join("\n"),
      },
      input.learnerRef,
    );
    const parsed = evalSchema.safeParse(this.extract(outputs));
    if (!parsed.success) throw new DifyError("Dify eval output schema mismatch");
    const d = parsed.data;
    // 決定論的採点が確定している場合、AIの status はそれに従わせる（安全弁）
    let status = d.status;
    if (input.deterministicResult === true) status = "success";
    if (input.deterministicResult === false && status === "success") status = "retry";
    return {
      status,
      feedback: d.feedback,
      hint: status === "success" ? "" : d.hint || input.task.hints[Math.min(input.hintLevel, input.task.hints.length - 1)] || "",
      observations: d.observations,
      skillTags: d.skill_tags,
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

  /** 作問は OpenAI provider の担当。この provider では定型問題（Mock）に委譲する */
  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    return this.fallback.generateTask(input);
  }
}
