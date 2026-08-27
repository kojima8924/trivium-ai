// 学習ループの API 型（server-only なし。サーバの service.ts とクライアントの TaskPlayer が同じ定義を使う）
import type { DomainKey } from "../domain";
import type { TaskPublic } from "../tasks/types";

/** 決着後の再計算結果（profile / XP / ADVISOR / 実績）。service.finalize が唯一の生成元 */
export type FinalizeResult = {
  profile: {
    domain: DomainKey;
    /** この 1 問を除いた集計 → 含めた集計（同じ時刻で計算。保存値は使わない） */
    before: number;
    after: number;
    /** 到達レベル（0..10）の前後 */
    levelBefore: number;
    levelAfter: number;
    confidence: string;
    summary: string;
    recommendedNext: string;
  };
  /** この決着で得た XP の内訳と合計・ランク */
  xp: {
    gained: number;
    /** 課題そのものの XP */
    task: number;
    /** この決着でデイリーミッションが達成されたときのボーナス */
    missionBonus: number;
    /** 連続日数ボーナスの増分 */
    streakBonus: number;
    missionJustDone: boolean;
    total: number;
    rank: string;
  };
  leader: { summary: string; recommendation: string } | null;
  newAchievements: string[];
};

export type SubmitOptions = {
  answer: string;
  latencyMs?: number;
  giveUp?: boolean;
  /** true なら決着後の再計算（finalize）を呼び出し側に任せる（LINE で先に返信したいとき） */
  deferFinalize?: boolean;
};

export type SettledSubmitResult = {
  status: "success" | "failed";
  task: TaskPublic;
  feedback: string;
  hint: "";
  explanation: string;
  /** free 課題の模範解答（決着後だけ見せる参考例） */
  sampleAnswer?: string;
  hintCount: number;
  observations?: string[];
  /** 記録した learning_event。練習モード（決着済み課題の再挑戦）では記録しないので id は空 */
  event: { id: string };
  /** true なら既に決着済みの課題への再挑戦（記録・XP・レベルは変わらない） */
  practice?: boolean;
} & FinalizeResult;

export type SubmitResult =
  | {
      status: "retry";
      task: TaskPublic;
      feedback: string;
      hint: string;
      hintCount: number;
      hintsRemaining: number;
    }
  | SettledSubmitResult;
