// 日付の共通処理。学習記録は「JST の 1 日」で区切る（デイリーミッション・連続日数・時系列グラフ）。
// タイムゾーンは config の XP.timezone を正とし、ここ以外で日付キーを組み立てない。
import { XP } from "@/config/trivium.config";

/** JST の日付キー（YYYY-MM-DD） */
export function jstDayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: XP.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
