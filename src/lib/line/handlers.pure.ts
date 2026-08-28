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
import type { DomainKey } from "@/lib/domain";
import type { LineIntentGuess } from "@/lib/ai/types";
import { inferTaskTypeFromRequest } from "@/lib/learn/generate.pure";
import type { Intent } from "./types";

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
  /** LINE で出題中の課題があればその系統（「ヒント」や質問をその担当に回す） */
  pendingDomain?: DomainKey | null;
};

export type Route =
  | { route: "chat"; agent: AgentKey; offerQuiz: boolean; consumeAsk: boolean; taskHelp?: boolean }
  /** 出題中の課題のヒントを 1 段出す（記録はヒント回数だけ） */
  | { route: "hint" }
  | { route: "rule" }
  | { route: "unlink_confirm" }
  | { route: "quiz" }
  | { route: "generate" }
  | { route: "pass" }
  /** 教材のおすすめ（案内役が能力に合わせて選ぶ） */
  | { route: "materials" };

const TASK_INTENTS = new Set(["quiz", "generate", "domain"]);
const COMMAND_INTENTS = new Set(["quiz", "generate", "pass", "materials"]);

/** AI 判定を Intent に写す。確信が低い・chat なら null（会話へ） */
export function intentFromGuess(guess: LineIntentGuess | null, text: string): Intent | null {
  if (!guess || guess.kind === "chat" || guess.confidence < 0.6) return null;
  switch (guess.kind) {
    case "profile":
      return { kind: "profile" };
    case "history":
      return { kind: "history" };
    case "today":
      return { kind: "today" };
    case "help":
      return { kind: "help" };
    case "link":
      return { kind: "link" };
    case "hint":
      return { kind: "hint" };
    case "pass":
      return { kind: "pass" };
    case "quiz": {
      // 「論理パズルを1問」「数的推理で」など、問題タイプの希望も拾って出題に反映する
      const taskType = guess.domain ? inferTaskTypeFromRequest(guess.domain, text) : null;
      return { kind: "quiz", domain: guess.domain, ...(guess.difficulty ? { difficulty: guess.difficulty } : {}), ...(taskType ? { taskType } : {}) };
    }
    case "generate":
      return { kind: "generate", request: text.slice(0, 300), domain: guess.domain, ...(guess.difficulty ? { difficulty: guess.difficulty } : {}) };
    case "materials":
      return { kind: "materials", domain: guess.domain, text: text.slice(0, 300) };
    default:
      return null;
  }
}

export function routeMessage(i: RouteInput): Route {
  const { intent, linked } = i;
  // (0) 呼びかけは最優先（「ロゴス、ブロックの解除ってどうやるの？」が解除にならないように）
  if (linked && i.addressed) return { route: "chat", agent: i.addressed, offerQuiz: TASK_INTENTS.has(intent.kind), consumeAsk: i.askedAgent !== null };
  // (1) 連携・ヘルプ・解除
  if (intent.kind === "link" || intent.kind === "help") return { route: "rule" };
  if (intent.kind === "unlink") return linked ? { route: "unlink_confirm" } : { route: "rule" };
  // (2) 「〜と話す」の続き。短いコマンドはコマンドを優先し、宛先メモは消す
  if (linked && i.askedAgent) {
    // 教材の依頼は長文でもコマンド扱い（「〜と話す」中でも案内役の推薦に回す）
    if (!(COMMAND_INTENTS.has(intent.kind) && (i.isShort || intent.kind === "materials"))) {
      return { route: "chat", agent: i.askedAgent, offerQuiz: TASK_INTENTS.has(intent.kind), consumeAsk: true };
    }
  }
  // (2.5) 出題中の課題がある: 「ヒント」はその課題のヒント、自由文はその課題の担当（答えは言わない）へ
  if (linked && i.pendingDomain) {
    if (intent.kind === "hint") return { route: "hint" };
    if (intent.kind === "unknown" || intent.kind === "tired") {
      return { route: "chat", agent: i.pendingDomain, offerQuiz: false, consumeAsk: false, taskHelp: true };
    }
  }
  // 出題中でない「ヒント」「わからない」は案内役との会話へ
  if (intent.kind === "hint") return linked ? { route: "chat", agent: "LEADER", offerQuiz: true, consumeAsk: false } : { route: "rule" };
  // (3) 出題系
  if (intent.kind === "quiz") return { route: "quiz" };
  if (intent.kind === "generate") return { route: "generate" };
  if (intent.kind === "pass") return { route: "pass" };
  // 教材のおすすめ: 連携済みなら能力に合わせて選ぶ。未連携は案内（ルールベース）
  if (intent.kind === "materials") return linked ? { route: "materials" } : { route: "rule" };
  // (4) 既知の意図: 未連携、または短いコマンドはルールベース（長い自由文は会話へ）
  if (intent.kind !== "unknown" && (!linked || i.isShort)) return { route: "rule" };
  // (5) 残り
  if (linked) return { route: "chat", agent: "LEADER", offerQuiz: false, consumeAsk: false };
  return { route: "rule" };
}
