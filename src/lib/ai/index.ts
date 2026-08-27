// LearningAIService: provider を抽象化し、Dify 障害時は Mock に自動フォールバックする。
import "server-only";
import { env } from "../env";
import { AnthropicProvider } from "./anthropic";
import { DifyProvider } from "./dify";
import { OpenAIProvider } from "./openai";
import { MockProvider } from "./mock";
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
} from "./types";

export * from "./types";

class LearningAIService implements LearningAIProvider {
  readonly name: string;
  private primary: LearningAIProvider;
  private fallback: LearningAIProvider;
  /** 直近で使われた provider 名（ヘルスチェック・UI表示用） */
  lastUsed: string;
  /** primary が最後に失敗したときの情報（運用診断用。鍵などの秘密は含めない） */
  lastError: { at: string; op: string; message: string } | null = null;

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
      const message = sanitizeError(err);
      this.lastError = { at: new Date().toISOString(), op: label, message };
      console.warn(`[ai] ${label}: ${this.primary.name} failed, falling back to ${this.fallback.name}:`, message);
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
  generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    return this.withFallback("generateTask", (p) => p.generateTask(input));
  }
  chat(input: ChatInput): Promise<ChatOutput> {
    return this.withFallback("chat", (p) => p.chat(input));
  }
  updateMemory(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
    return this.withFallback("updateMemory", (p) => p.updateMemory(input));
  }
  /** Python 実行（作問の検証）。primary が対応していなければ undefined（呼び出し側は検証をスキップ） */
  get runPython(): LearningAIProvider["runPython"] {
    const p = this.primary;
    return p.runPython ? (text: string) => p.runPython!(text) : undefined;
  }
}

function build(): LearningAIService {
  const mock = new MockProvider();
  // provider の選択。キーが無い場合は黙って mock に落とす（アプリを止めない）
  let primary: LearningAIProvider = mock;
  if (env.ai.provider === "openai" && env.ai.openaiApiKey) {
    primary = new OpenAIProvider();
  } else if (env.ai.provider === "anthropic" && env.ai.anthropicApiKey) {
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

/** エラー文から鍵・トークンらしき文字列を落とし、長さも切る（ヘルスチェックに載せるため） */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/Bearer\s+\S+/g, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export function aiStatus() {
  return { provider: learningAI.name, lastUsed: learningAI.lastUsed, lastError: learningAI.lastError };
}
