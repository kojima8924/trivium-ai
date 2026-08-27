// LearningAIService: provider を抽象化し、Dify 障害時は Mock に自動フォールバックする。
import "server-only";
import { env } from "../env";
import { DifyProvider } from "./dify";
import { MockProvider } from "./mock";
import type {
  DomainEvalInput,
  DomainEvalOutput,
  DomainInterpretInput,
  DomainInterpretOutput,
  LeaderInput,
  LeaderOutput,
  LearningAIProvider,
} from "./types";

export * from "./types";

class LearningAIService implements LearningAIProvider {
  readonly name: string;
  private primary: LearningAIProvider;
  private fallback: LearningAIProvider;
  /** 直近で使われた provider 名（ヘルスチェック・UI表示用） */
  lastUsed: string;

  constructor(primary: LearningAIProvider, fallback: LearningAIProvider) {
    this.primary = primary;
    this.fallback = fallback;
    this.name = primary.name;
    this.lastUsed = primary.name;
  }

  private async withFallback<T>(label: string, fn: (p: LearningAIProvider) => Promise<T>): Promise<T> {
    try {
      const r = await fn(this.primary);
      this.lastUsed = this.primary.name;
      return r;
    } catch (err) {
      if (this.primary === this.fallback) throw err;
      console.warn(`[ai] ${label}: ${this.primary.name} failed, falling back to ${this.fallback.name}:`, (err as Error).message);
      const r = await fn(this.fallback);
      this.lastUsed = this.fallback.name;
      return r;
    }
  }

  evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    return this.withFallback("evaluate", (p) => p.evaluate(input));
  }
  interpretDomain(input: DomainInterpretInput): Promise<DomainInterpretOutput> {
    return this.withFallback("interpretDomain", (p) => p.interpretDomain(input));
  }
  leader(input: LeaderInput): Promise<LeaderOutput> {
    return this.withFallback("leader", (p) => p.leader(input));
  }
}

function build(): LearningAIService {
  const mock = new MockProvider();
  const useDify = env.ai.provider === "dify" && Boolean(env.ai.difyDomainApiKey || env.ai.difyLeaderApiKey);
  return new LearningAIService(useDify ? new DifyProvider() : mock, mock);
}

const g = globalThis as unknown as { __triviumAI?: LearningAIService };
export const learningAI: LearningAIService = g.__triviumAI ?? (g.__triviumAI = build());

export function aiStatus() {
  return { provider: learningAI.name, lastUsed: learningAI.lastUsed };
}
