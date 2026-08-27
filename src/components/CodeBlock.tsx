// Python コードの簡易シンタックスハイライト（依存ライブラリなし・innerHTML 不使用）。
// 課題の passage に含まれる短いコード向け。行ごとに字句分割して span で色付けする。
import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
  "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield",
]);
const BUILTINS = new Set([
  "print", "len", "range", "int", "str", "float", "list", "dict", "set", "tuple", "sorted", "sum", "min", "max", "abs", "enumerate",
  "zip", "map", "filter", "input", "bool", "type", "isinstance", "reversed", "any", "all", "round", "append", "pop", "items", "keys",
  "values", "get", "join", "split", "strip", "format", "ord", "chr", "divmod", "pow",
]);

// 1 行ぶんの字句: コメント / 文字列 / 数値 / 識別子 / それ以外
const TOKEN = /(#.*$)|([bBrRfFuU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+|.)/g;

function highlightLine(line: string, key: number): ReactNode[] {
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line)) !== null) {
    const [tok, comment, str, num, ident] = m;
    if (tok === "") {
      TOKEN.lastIndex++;
      continue;
    }
    const k = `${key}-${i++}`;
    if (comment) out.push(<span key={k} className="tok-com">{comment}</span>);
    else if (str) out.push(<span key={k} className="tok-str">{str}</span>);
    else if (num) out.push(<span key={k} className="tok-num">{num}</span>);
    else if (ident) {
      const next = line.slice(m.index + tok.length).match(/^\s*\(/);
      const cls = KEYWORDS.has(ident) ? "tok-kw" : BUILTINS.has(ident) ? "tok-bi" : next ? "tok-fn" : "";
      out.push(cls ? <span key={k} className={cls}>{ident}</span> : ident);
    } else out.push(tok);
  }
  return out;
}

/** Python らしいコードを色付きで表示する。Python でなくても崩れない（識別子は素のまま） */
export function CodeBlock({ code, className = "" }: { code: string; className?: string }) {
  const lines = code.replace(/\r/g, "").split("\n");
  return (
    <pre className={`codeblock ${className}`}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="block min-h-[1.55em]">
            {highlightLine(line, i)}
          </span>
        ))}
      </code>
    </pre>
  );
}
