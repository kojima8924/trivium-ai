// 問題ストック生成スクリプトの設定と共通の型。
// パス・モデル名・バックエンド（Codex CLI / OpenAI API）・並列数と、各モジュールが共有する型だけを置く。
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- 設定 ----
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const OUT_DIR = path.join(HERE, "out");
export const STOCK_DIR = path.join(ROOT, "src/lib/tasks/stock");
// STOCK_BACKEND=openai のときのモデル（既定は Codex CLI なので通常は使わない）
export const GEN_MODEL = "gpt-5.6-sol";
export const SOLVER_MODEL = "gpt-5.6-sol";
export const REVIEW_MODEL = "gpt-5.6-luna";
/** codex = サブスクの Codex CLI（既定）/ openai = API（残高に注意） */
export const BACKEND = (process.env.STOCK_BACKEND ?? "codex") as "codex" | "openai";
export const CODEX_MODEL = process.env.CODEX_MODEL ?? "";
export const CONCURRENCY = BACKEND === "codex" ? 4 : 8;
export const MAX_ATTEMPTS = 3;

export type Domain = "READ" | "WRITE" | "CODE" | "MIX";
export type Axis = "READ" | "WRITE" | "CODE";
export type Kind = "choice" | "short" | "free";

/** 問題タイプ（src/lib/task-types.ts のキーと一致） */
export type TypeSpec = { key: string; kind: Kind; count: number; label: string; axes: Axis[]; primary: Axis };

export type Slot = { domain: Domain; spec: TypeSpec; difficulty: number; n: number };

export type StockTask = {
  id: string;
  domain: Axis;
  difficulty: number;
  axes?: Partial<Record<"read" | "write" | "code", number>>;
  title: string;
  passage?: string;
  prompt: string;
  kind: Kind;
  taskType: string;
  choices?: string[];
  answerKey?: string[];
  rubric?: { mustInclude?: string[]; minLength?: number; maxLength?: number; criteria: string[]; sampleAnswer?: string };
  hints: string[];
  explanation: string;
  skillTags: string[];
};
