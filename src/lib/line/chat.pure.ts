// LINE 会話履歴に使う純粋関数（server-only を付けない。テストから直接 import できる）。
import { EXTERNAL } from "@/config/trivium.config";
import type { ChatTurnInput } from "@/lib/ai/types";

/** 直近 N 往復（assistant の発話 1 つ = 1 往復）だけを古い順で残す */
export function trimHistory(turns: ChatTurnInput[], maxTurns: number = EXTERNAL.chatHistoryTurns): ChatTurnInput[] {
  let assistants = 0;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "assistant") {
      assistants++;
      if (assistants > maxTurns) break;
    }
    start = i;
  }
  return turns.slice(start);
}
