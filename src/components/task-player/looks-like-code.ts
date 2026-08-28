// 課題本文・選択肢が「コードらしいか」の判定。
// LOGIC は Python と論理パズルが混在するので、コードらしい文字列だけ等幅ブロックで出すために使う。
export function looksLikeCode(passage: string): boolean {
  const firstLine = passage.split("\n")[0] ?? "";
  if (/^(def |print\(|for |import |[a-z_]+ = )/m.test(passage)) return true;
  if (/^[#・\s]/.test(firstLine)) return false;
  return /\b(def|print|for|while|if|import|return|range|len)\b|[=\[\]{}()]/.test(passage);
}
