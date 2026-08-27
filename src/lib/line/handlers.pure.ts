// LINE テキストメッセージの振り分け判定（純粋関数。prisma / env に依存しないのでテストから直接呼べる）。
//
// 振り分け順（連携済みユーザー）:
//   (0) 人格の名前での呼びかけ           → その人格との会話（「ヨミ、〜」「ロゴスに聞きたい」。名前限定・部分一致なし）
//   (1) link / help / unlink             → ルールベース（unlink は確認ボタンを挟む）
//   (2) 直前に「〜と話す」を押していた    → その人格との会話（30 分以内）。ただし短いコマンド（出題・作問・パス）はコマンドを優先
//   (3) quiz / generate / pass           → 出題系
//   (4) その他の既知の意図               → 未連携、または短いコマンドならルールベース
//   (5) 残り                             → 連携済みなら案内役（LEADER）との会話、未連携はルールベース
import type { AgentKey } from "@/lib/persona";
import type { Intent } from "./leader";

export type RouteInput = {
  intent: Intent;
  /** Web アカウントと連携済みか */
  linked: boolean;
  /** 名前での呼びかけ先（detectAddressedAgent の結果） */
  addressed: AgentKey | null;
  /** 有効な「〜と話す」の宛先（期限内のもの） */
  askedAgent: AgentKey | null;
  /** 短いコマンド（LINE.commandMaxChars 以下）か */
  isShort: boolean;
};

export type Route =
  | { route: "chat"; agent: AgentKey; offerQuiz: boolean; consumeAsk: boolean }
  | { route: "rule" }
  | { route: "unlink_confirm" }
  | { route: "quiz" }
  | { route: "generate" }
  | { route: "pass" };

const TASK_INTENTS = new Set(["quiz", "generate", "domain"]);
const COMMAND_INTENTS = new Set(["quiz", "generate", "pass"]);

export function routeMessage(i: RouteInput): Route {
  const { intent, linked } = i;
  // (0) 呼びかけは最優先（「ロゴス、ブロックの解除ってどうやるの？」が解除にならないように）
  if (linked && i.addressed) return { route: "chat", agent: i.addressed, offerQuiz: TASK_INTENTS.has(intent.kind), consumeAsk: i.askedAgent !== null };
  // (1) 連携・ヘルプ・解除
  if (intent.kind === "link" || intent.kind === "help") return { route: "rule" };
  if (intent.kind === "unlink") return linked ? { route: "unlink_confirm" } : { route: "rule" };
  // (2) 「〜と話す」の続き。短いコマンドはコマンドを優先し、宛先メモは消す
  if (linked && i.askedAgent) {
    if (!(COMMAND_INTENTS.has(intent.kind) && i.isShort)) {
      return { route: "chat", agent: i.askedAgent, offerQuiz: TASK_INTENTS.has(intent.kind), consumeAsk: true };
    }
  }
  // (3) 出題系
  if (intent.kind === "quiz") return { route: "quiz" };
  if (intent.kind === "generate") return { route: "generate" };
  if (intent.kind === "pass") return { route: "pass" };
  // (4) 既知の意図: 未連携、または短いコマンドはルールベース（長い自由文は会話へ）
  if (intent.kind !== "unknown" && (!linked || i.isShort)) return { route: "rule" };
  // (5) 残り
  if (linked) return { route: "chat", agent: "LEADER", offerQuiz: false, consumeAsk: false };
  return { route: "rule" };
}
