// 観察メモの純粋関数（server-only を付けない。テストから直接 import できる）
import { EXTERNAL } from "@/config/trivium.config";

/** メモの後処理: 数値つきの評価語を伏せ、空白を整え、上限で切る。LLM が規約を破っても DB には入れない */
export function sanitizeNotes(notes: string, maxChars: number = EXTERNAL.agentMemoryMaxChars): string {
  const cleaned = notes
    .replace(/\d+(?:[.,]\d+)?\s*(%|％|点|件|回|問|位|レベル|pt)/g, "（数値）")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...cleaned].slice(0, maxChars).join("");
}

/** 回答の要約（先頭 N 字。改行は空白に） */
export function answerExcerpt(answer: string, max = 200): string {
  return [...answer.replace(/\s+/g, " ").trim()].slice(0, max).join("");
}
