// 決定論的なハッシュ（FNV-1a, 32bit）。
// 出題順のばらけ・難易度のゆらぎ・タイプ選択など「乱数を使わずに散らしたい」箇所で共有する。
// 暗号用途ではない。同じ入力なら常に同じ値を返すこと（テスト・再現性）だけを保証する。

/** 文字列 → 32bit 符号なし整数 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** 文字列 → [0, 1) の擬似乱数 */
export function unitOf(s: string): number {
  return fnv1a(s) / 0x100000000;
}
