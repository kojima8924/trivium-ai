// achievement の定義（表示名・説明）。クライアント/サーバ両方から import できるよう server-only を付けない。
// 解除条件の判定は src/lib/achievements.ts（サーバ側）。

export const ACHIEVEMENTS: Record<string, { title: string; description: string }> = {
  first_step: { title: "最初の一歩", description: "初めて課題に取り組んだ" },
  no_hint: { title: "ノーヒント", description: "ヒントなしで正解した" },
  comeback: { title: "立て直し", description: "誤答のあとヒントで正解にたどり着いた" },
  trivium: { title: "TRIVIUM", description: "READ / WRITE / CODE すべてに取り組んだ" },
  ten_events: { title: "継続", description: "学習記録が10件に達した" },
  hard_clear: { title: "高難度クリア", description: "難易度4以上の課題を解いた" },
};

export function achievementTitle(key: string): string {
  return ACHIEVEMENTS[key]?.title ?? key;
}
