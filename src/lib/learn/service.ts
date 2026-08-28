// 学習ループのサービス層の窓口。実体は同じディレクトリの 4 ファイルに分かれている。
//   resolve.ts  : taskId → Task（静的タスク or LLM 生成タスク）
//   select.ts   : nextTask（次の課題を選ぶ）
//   answer.ts   : submitAnswer / requestHint（採点・講評・ヒント・記録）
//   finalize.ts : finalize（profile / ADVISOR の再計算、実績、スナップショット）
// Web の API ルートと LINE webhook は従来どおりこのファイルから import する（import パスを変えないための再エクスポート）。
import "server-only";

export { resolveTask } from "./resolve";
export { nextTask, type NextTaskOptions } from "./select";
export { requestHint, submitAnswer, warmFeedbackCache } from "./answer";
export { finalize, snapshot } from "./finalize";
export type { FinalizeResult, SettledSubmitResult, SubmitOptions, SubmitResult } from "./types";
