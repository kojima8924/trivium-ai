// 作問結果の正規化・検証の純粋関数（server-only なし。テストから直接呼べる）

/** 文字列としての「\\n」を実際の改行にし、title の domain 接頭辞を外す（LLM 出力の癖を吸収） */
export function normalizeGenerated<T extends { title: string; passage: string; prompt: string; choices: string[]; explanation: string }>(out: T): T {
  const nl = (s: string) => s.replace(/\\n/g, "\n").replace(/\\t/g, "    ").replace(/\r/g, "");
  const title = out.title.replace(/^\s*(READ|WRITE|LOGIC|CODE)\s*[:：]\s*/i, "").trim() || out.title;
  return { ...out, title, passage: nl(out.passage), prompt: nl(out.prompt), explanation: nl(out.explanation), choices: out.choices.map(nl) };
}

/** Python コードらしいか（出力予測問題の検証対象かどうか） */
export function looksLikePython(text: string): boolean {
  return /^\s*(def |for |while |import |print\(|[a-zA-Z_]\w*\s*=\s*)/m.test(text) && /print\(/.test(text);
}

/** 出力の比較用に正規化（空白・引用符の種類・行末を無視） */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/"/g, "'")
    .replace(/\s+/g, "");
}

