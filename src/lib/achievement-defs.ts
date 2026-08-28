// achievement の定義（表示名・説明・絵文字・ティア）。クライアント/サーバ両方から import できるよう server-only を付けない。
// 解除条件の判定は src/lib/achievements.pure.ts（決定論。events から計算）、保存は src/lib/achievements.ts（サーバ側）。

export type AchievementTier = "bronze" | "silver" | "gold";

export type AchievementDef = {
  title: string;
  description: string;
  emoji: string;
  tier: AchievementTier;
  /** 一覧のグルーピング用 */
  category: "first" | "streak" | "count" | "level" | "xp" | "rank" | "skill" | "habit" | "special";
};

export const TIER_LABEL: Record<AchievementTier, string> = { bronze: "ブロンズ", silver: "シルバー", gold: "ゴールド" };

export const CATEGORY_LABEL: Record<AchievementDef["category"], string> = {
  first: "はじめの一歩",
  streak: "連続記録",
  count: "積み上げ",
  level: "到達レベル",
  xp: "XP",
  rank: "ランク",
  skill: "腕前",
  habit: "習慣",
  special: "スペシャル",
};

const LEVEL_TITLES: Record<"READ" | "WRITE" | "CODE", Record<3 | 5 | 8 | 10, string>> = {
  READ: { 3: "読み手", 5: "熟読家", 8: "読解の達人", 10: "黄泉の司書" },
  WRITE: { 3: "書き手", 5: "文章家", 8: "推敲の達人", 10: "赤ペンの主" },
  CODE: { 3: "追跡者", 5: "論理家", 8: "論理の番人", 10: "ロゴスの継承者" },
};
const LEVEL_TIER: Record<3 | 5 | 8 | 10, AchievementTier> = { 3: "bronze", 5: "silver", 8: "gold", 10: "gold" };
const LEVEL_EMOJI: Record<"READ" | "WRITE" | "CODE", string> = { READ: "📘", WRITE: "📝", CODE: "🧩" };
const DOMAIN_LABEL: Record<"READ" | "WRITE" | "CODE", string> = { READ: "READ", WRITE: "WRITE", CODE: "LOGIC" };

function levelDefs(): Record<string, AchievementDef> {
  const out: Record<string, AchievementDef> = {};
  for (const d of ["READ", "WRITE", "CODE"] as const) {
    for (const lv of [3, 5, 8, 10] as const) {
      out[`${d.toLowerCase()}_lv${lv}`] = {
        title: `${LEVEL_TITLES[d][lv]}（${DOMAIN_LABEL[d]} Lv.${lv}）`,
        description: `${DOMAIN_LABEL[d]} の到達レベルが ${lv} に達した`,
        emoji: LEVEL_EMOJI[d],
        tier: LEVEL_TIER[lv],
        category: "level",
      };
    }
  }
  return out;
}

export const ACHIEVEMENTS: Record<string, AchievementDef> = {
  // ---- はじめの一歩 ----
  first_step: { title: "最初の一歩", description: "初めて課題に取り組んだ", emoji: "🚶", tier: "bronze", category: "first" },
  first_read: { title: "読みはじめ", description: "READ の課題に初めて正解した", emoji: "📖", tier: "bronze", category: "first" },
  first_write: { title: "書きはじめ", description: "WRITE の課題に初めて正解した", emoji: "✍️", tier: "bronze", category: "first" },
  first_logic: { title: "論理はじめ", description: "LOGIC の課題に初めて正解した", emoji: "🧠", tier: "bronze", category: "first" },
  no_hint: { title: "ノーヒント", description: "ヒントなしで正解した", emoji: "💡", tier: "bronze", category: "first" },
  comeback: { title: "立て直し", description: "ヒントを手がかりに、自分で正解にたどり着いた", emoji: "🔁", tier: "bronze", category: "first" },
  trivium: { title: "TRIVIUM", description: "READ / WRITE / LOGIC すべてに取り組んだ", emoji: "🔺", tier: "bronze", category: "first" },
  mission_first: { title: "今日の3問", description: "1 日で 3 系統すべてに取り組んだ（デイリーミッション達成）", emoji: "✅", tier: "bronze", category: "first" },

  // ---- 連続記録（デイリーミッションの連続日数） ----
  streak_3: { title: "三日坊主を超えて", description: "デイリーミッションを 3 日連続で達成", emoji: "🔥", tier: "bronze", category: "streak" },
  streak_7: { title: "一週間の火", description: "デイリーミッションを 7 日連続で達成", emoji: "🔥", tier: "silver", category: "streak" },
  streak_14: { title: "二週間の炎", description: "デイリーミッションを 14 日連続で達成", emoji: "🔥", tier: "gold", category: "streak" },
  streak_30: { title: "ひと月の灯", description: "デイリーミッションを 30 日連続で達成", emoji: "🏮", tier: "gold", category: "streak" },
  missions_10: { title: "ミッション 10 回", description: "デイリーミッションを通算 10 回達成", emoji: "📅", tier: "silver", category: "streak" },
  missions_30: { title: "ミッション 30 回", description: "デイリーミッションを通算 30 回達成", emoji: "📅", tier: "gold", category: "streak" },

  // ---- 積み上げ ----
  ten_events: { title: "継続", description: "学習記録が 10 件に達した", emoji: "📚", tier: "bronze", category: "count" },
  thirty_events: { title: "三十問", description: "学習記録が 30 件に達した", emoji: "📚", tier: "silver", category: "count" },
  hundred_events: { title: "百問", description: "学習記録が 100 件に達した", emoji: "🏛️", tier: "gold", category: "count" },
  three_hundred_events: { title: "三百問", description: "学習記録が 300 件に達した", emoji: "🏛️", tier: "gold", category: "count" },
  read_20: { title: "読書家", description: "READ の課題を 20 問解いた", emoji: "📘", tier: "silver", category: "count" },
  write_20: { title: "文筆家", description: "WRITE の課題を 20 問解いた", emoji: "📝", tier: "silver", category: "count" },
  logic_20: { title: "パズラー", description: "LOGIC の課題を 20 問解いた", emoji: "🧩", tier: "silver", category: "count" },

  // ---- 到達レベル（3 系統 × Lv3/5/8/10） ----
  ...levelDefs(),
  balanced_5: { title: "三位一体", description: "READ / WRITE / LOGIC すべてが Lv.5 以上", emoji: "⚖️", tier: "gold", category: "level" },
  balanced_8: { title: "三学の徒", description: "READ / WRITE / LOGIC すべてが Lv.8 以上", emoji: "👑", tier: "gold", category: "level" },

  // ---- XP ----
  xp_100: { title: "100 XP", description: "累計 100 XP を獲得", emoji: "✨", tier: "bronze", category: "xp" },
  xp_500: { title: "500 XP", description: "累計 500 XP を獲得", emoji: "✨", tier: "silver", category: "xp" },
  xp_1000: { title: "1000 XP", description: "累計 1000 XP を獲得", emoji: "🌟", tier: "silver", category: "xp" },
  xp_3000: { title: "3000 XP", description: "累計 3000 XP を獲得", emoji: "🌟", tier: "gold", category: "xp" },

  // ---- ランク ----
  rank_apprentice: { title: "Apprentice", description: "ランク「見習い」に到達", emoji: "🎓", tier: "bronze", category: "rank" },
  rank_grammarian: { title: "Grammarian", description: "ランク「文法家」に到達", emoji: "🎓", tier: "silver", category: "rank" },
  rank_logician: { title: "Logician", description: "ランク「論理家」に到達", emoji: "🎓", tier: "silver", category: "rank" },
  rank_rhetor: { title: "Rhetor", description: "ランク「修辞家」に到達", emoji: "🎓", tier: "gold", category: "rank" },
  rank_master: { title: "Trivium Master", description: "最高ランクに到達", emoji: "🏆", tier: "gold", category: "rank" },

  // ---- 腕前 ----
  no_hint_5: { title: "冴えている", description: "ヒントなしの正解を 5 問連続", emoji: "⚡", tier: "silver", category: "skill" },
  no_hint_10: { title: "無双", description: "ヒントなしの正解を 10 問連続", emoji: "⚡", tier: "gold", category: "skill" },
  hard_clear: { title: "高難度クリア", description: "難易度 7 以上の課題を解いた", emoji: "🏔️", tier: "silver", category: "skill" },
  expert_clear: { title: "壁を越えて", description: "難易度 9 以上の課題を解いた", emoji: "🏔️", tier: "gold", category: "skill" },
  summit: { title: "頂上", description: "難易度 10 の課題を解いた", emoji: "🗻", tier: "gold", category: "skill" },
  revenge: { title: "リベンジ", description: "一度は解けなかった課題に再挑戦して正解した", emoji: "🥊", tier: "silver", category: "skill" },
  flawless_day: { title: "完全な一日", description: "1 日に 3 問以上解いて、すべて正解", emoji: "💎", tier: "silver", category: "skill" },
  perfect_mission: { title: "完全ミッション", description: "1 日で 3 系統すべてに正解", emoji: "🎯", tier: "silver", category: "skill" },

  // ---- 習慣 ----
  early_bird: { title: "朝活", description: "朝 6〜9 時に課題を解いた", emoji: "🌅", tier: "bronze", category: "habit" },
  night_owl: { title: "夜更かし", description: "23 時以降に課題を解いた", emoji: "🦉", tier: "bronze", category: "habit" },
  five_a_day: { title: "1 日 5 問", description: "1 日に 5 問解いた", emoji: "🍙", tier: "bronze", category: "habit" },
  ten_a_day: { title: "1 日 10 問", description: "1 日に 10 問解いた", emoji: "🍱", tier: "silver", category: "habit" },
  weekend_learner: { title: "週末も", description: "土曜か日曜に課題を解いた", emoji: "🌿", tier: "bronze", category: "habit" },

  // ---- スペシャル ----
  generated_clear: { title: "オーダーメイド", description: "AI が作った課題に正解した", emoji: "🪄", tier: "bronze", category: "special" },
  generated_5: { title: "注文の多い学習者", description: "AI が作った課題に 5 問正解した", emoji: "🪄", tier: "silver", category: "special" },
  composite_clear: { title: "越境", description: "2 つ以上の系統にまたがる複合課題に正解した", emoji: "🌉", tier: "silver", category: "special" },
  composite_3: { title: "越境者", description: "複合課題に 3 問正解した", emoji: "🌉", tier: "gold", category: "special" },
};

export function achievementTitle(key: string): string {
  return ACHIEVEMENTS[key]?.title ?? key;
}

/** 「🏅 タイトル」のような 1 行表記（LINE 用） */
export function achievementLine(key: string): string {
  const a = ACHIEVEMENTS[key];
  return a ? `${a.emoji} ${a.title}` : key;
}
