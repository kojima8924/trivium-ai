import type { Confidence, DomainKey } from "../domain";

// ---- Domain workflow (mode = read | write | code) ----

export type DomainEvalInput = {
  mode: "read" | "write" | "code";
  /** Dify 側 user 識別子（内部UUID。PIIは渡さない） */
  learnerRef: string;
  task: {
    id: string;
    title: string;
    passage?: string;
    prompt: string;
    kind: "choice" | "short" | "free";
    choices?: string[];
    difficulty: number;
    /** 採点観点（answer-review 用。完成解は含めない） */
    criteria?: string[];
    /** 段階ヒント（AIはこの中から一段だけ選ぶ） */
    hints: string[];
  };
  learnerAnswer: string;
  /** 決定論的採点の結果。free タスクでは null */
  deterministicResult: boolean | null;
  /** free タスクのルーブリック・ヒューリスティック判定（AIの参考情報）。choice/short では null */
  heuristicResult: boolean | null;
  /** これまでに出したヒント数 */
  hintLevel: number;
  currentDomainProfile: {
    score: number;
    subskills: Record<string, number>;
    confidence: Confidence;
    evidenceCount: number;
    summary: string;
  };
  /** 直近の学習行動（要約用） */
  recentBehavior: string[];
  persona?: PersonaPrompt;
};

export type DomainEvalOutput = {
  status: "success" | "retry" | "needs_more";
  feedback: string;
  hint: string;
  observations: string[];
  skillTags: string[];
  recommendedNextDifficulty: number;
};

// ---- Domain profile interpretation (寸評生成) ----

export type DomainInterpretInput = {
  mode: "read" | "write" | "code";
  learnerRef: string;
  stats: {
    score: number;
    subskills: Record<string, number>;
    confidence: Confidence;
    evidenceCount: number;
    successRate: number;
    avgHints: number;
    avgDifficulty: number;
  };
  recentEvents: {
    taskTitle: string;
    difficulty: number;
    success: boolean;
    hintCount: number;
    skillTags: string[];
    daysAgo: number;
  }[];
  persona?: PersonaPrompt;
};

export type DomainInterpretOutput = {
  summary: string;
  observations: string[];
  recommendedNext: string;
};

// ---- Leader workflow ----

export type LeaderInput = {
  learnerRef: string;
  domains: {
    domain: DomainKey;
    score: number;
    subskills: Record<string, number>;
    confidence: Confidence;
    evidenceCount: number;
    summary: string;
    observations: string[];
    recommendedNext: string;
    eventsLast7Days: number;
  }[];
  totalEvents: number;
  /** 直近の学習イベント（寸評が最新の行動を反映するため） */
  lastEvent?: {
    domain: DomainKey;
    taskTitle: string;
    difficulty: number;
    success: boolean;
    hintCount: number;
    minutesAgo: number;
  };
  /** 「10分だけ」などの文脈（LINE経由）。無ければ空 */
  context?: string;
  persona?: PersonaPrompt;
};

export type LeaderOutput = {
  summary: string;
  interests: string[];
  preferences: Record<string, string>;
  observations: string[];
  recommendation: string;
  /** 次に勧める domain（曖昧な要求への回答に使う） */
  recommendedDomain: DomainKey;
};

// ---- 作問（LINE の自由文リクエスト等） ----

export type GenerateTaskInput = {
  learnerRef: string;
  /** 依頼文（例: 「論理パズルを出して」「短めの読解を1問」） */
  request: string;
  /** 依頼から推定した domain（呼び出し側で決める。LLM に任せない） */
  domain: DomainKey;
  difficulty: number; // 1..5
  /** 出題形式。LINE では choice を基本にする */
  kind: "choice" | "short" | "free";
  /** この domain の subskill 一覧（skill_tags はここから選ばせる） */
  allowedSkillTags: readonly string[];
  /** 直近の課題タイトル（同じ題材を避ける） */
  recentTitles: string[];
  persona?: PersonaPrompt;
};

export type GenerateTaskOutput = {
  title: string;
  passage: string;
  prompt: string;
  choices: string[]; // choice のときのみ（4件）。それ以外は空
  answerKey: string[]; // choice: 正解 index の文字列 / short: 正解候補 / free: 空
  rubric: { mustInclude: string[]; minLength: number; maxLength: number; criteria: string[] } | null;
  hints: [string, string, string];
  explanation: string;
  skillTags: string[];
};

/** AI の人格（prompt 用に整形済み。PII は含めない） */
export type PersonaPrompt = {
  agent: "READ" | "WRITE" | "CODE" | "LEADER";
  name: string;
  tone: string; // 口調の説明文
  firstPerson: string;
  extra: string;
  /** キャッシュキー用（設定が変わると変わる） */
  key: string;
};

export interface LearningAIProvider {
  readonly name: string;
  evaluate(input: DomainEvalInput): Promise<DomainEvalOutput>;
  interpretDomain(input: DomainInterpretInput): Promise<DomainInterpretOutput>;
  leader(input: LeaderInput): Promise<LeaderOutput>;
  generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput>;
}

export const AI_SYSTEM_POLICY = [
  "Never complete the learner's task for them unless explicitly entering an answer-review phase.",
  "Give at most one useful hint at a time.",
  "Prefer questions over answers.",
  "Adapt to previous learner responses.",
  "Do not infer traits unsupported by learning evidence.",
  "Comment on learning behavior, not personality.",
  "If evidence is insufficient, explicitly state uncertainty.",
] as const;
