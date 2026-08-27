import type { DomainKey } from "../domain";

// タスク種別
//   choice: 選択式（決定論的に採点）
//   short : 短答（正規化して完全一致 or 別解で採点）
//   free  : 自由記述（AI／ルーブリックで採点。WRITE や説明系）
export type TaskKind = "choice" | "short" | "free";

export type Task = {
  id: string;
  domain: DomainKey;
  /** 主系統の難易度 1..10 */
  difficulty: number;
  /** 難易度ベクトル（0 = 無関係）。省略時は { [domain]: difficulty }。複合課題はここで複数系統を正にする */
  axes?: { read?: number; write?: number; code?: number };
  title: string;
  /** 読ませる本文・コード（READ: 短文, CODE: Pythonコード, WRITE: お題の補足） */
  passage?: string;
  /** 設問 */
  prompt: string;
  kind: TaskKind;
  choices?: string[];
  /** choice: 正解の index を文字列化 / short: 正解候補 */
  answerKey?: string[];
  /** free 用: AI/ヒューリスティックの評価基準 */
  rubric?: {
    mustInclude?: string[]; // いずれかを含めば加点するキーワード群
    minLength?: number;
    maxLength?: number;
    criteria: string[]; // AI へ渡す観点
    /** 模範解答（成功後に参考例として見せる。字数指定の基準） */
    sampleAnswer?: string;
  };
  /** 段階ヒント（1回目→2回目→3回目）。完成解は含めない */
  hints: string[];
  /** 成功後にだけ表示する解説 */
  explanation: string;
  skillTags: string[];
  /** 問題タイプ（src/lib/task-types.ts のキー。複合課題は "composite"）。省略時は読み込み時に補完される */
  taskType?: string;
};

export type TaskPublic = Omit<Task, "answerKey" | "hints" | "explanation" | "rubric">;

export function toPublic(task: Task): TaskPublic {
  const { answerKey: _a, hints: _h, explanation: _e, rubric: _r, ...pub } = task;
  void _a;
  void _h;
  void _e;
  void _r;
  return pub;
}
