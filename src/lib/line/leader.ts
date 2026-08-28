// LINE 表面に出す「Leader（ADVISOR）」の公開窓口。中身は 3 つに分かれている:
//   types.ts   … 返信・意図の型（LeaderReply / LeaderAction / LeaderContext / Intent）
//   intent.ts  … テキストの意図分類（classifyIntent と補助の判定）
//   replies.ts … ルールベースの返信テンプレート（歓迎・ヘルプ・領域案内・推薦）
// 既存の import パス（"@/lib/line/leader"）を変えないため、ここで再エクスポートだけ行う。
export type { Intent, LeaderAction, LeaderContext, LeaderReply } from "./types";
export { classifyIntent, domainInText, domainOf, parseDifficulty, parseMaterialsIntent } from "./intent";
export { buildPostbackReply, buildReply, confirmUnlinkReply, helpReply, pickBalancedDomain, quizOrWebActions, welcomeReply } from "./replies";
