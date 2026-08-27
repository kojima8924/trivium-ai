// LearningAIService: provider を抽象化し、Dify 障害時は Mock に自動フォールバックする。
import "server-only";
import { env } from "../env";
import { AnthropicProvider } from "./anthropic";
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
  // provider の選択。キーが無い場合は黙って mock に落とす（アプリを止めない）
  let primary: LearningAIProvider = mock;
  if (env.ai.provider === "anthropic" && env.ai.anthropicApiKey) {
    primary = new AnthropicProvider();
  } else if (env.ai.provider === "dify" && (env.ai.difyDomainApiKey || env.ai.difyLeaderApiKey)) {
    primary = new DifyProvider();
  }
  return new LearningAIService(primary, mock);
}

// 本番では globalThis に保持して lastUsed を request 間で共有する。
// 開発時はホットリロードで provider の新コードが反映されるよう、モジュール評価ごとに作り直す。
const g = globalThis as unknown as { __triviumAI?: LearningAIService };
export const learningAI: LearningAIService =
  process.env.NODE_ENV === "production" ? (g.__triviumAI ??= build()) : build();

export function aiStatus() {
  return { provider: learningAI.name, lastUsed: learningAI.lastUsed };
}
