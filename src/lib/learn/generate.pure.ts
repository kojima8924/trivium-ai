// 作問結果の正規化・検証・依頼文の推定の純粋関数（server-only なし。テストから直接呼べる）
import type { DomainKey } from "../domain";
import type { Task } from "../tasks/types";
import { allowedTaskTypes, FREE_TASK_TYPES, type TaskPrefs } from "../task-types";
import { fnv1a } from "../hash";

/** 文字列としての「\\n」を実際の改行にし、title の domain 接頭辞を外す（LLM 出力の癖を吸収） */
export function normalizeGenerated<T extends { title: string; passage: string; prompt: string; choices: string[]; explanation: string }>(out: T): T {
  const nl = (s: string) => s.replace(/\\n/g, "\n").replace(/\\t/g, "    ").replace(/\r/g, "");
  const title = out.title.replace(/^\s*(READ|WRITE|LOGIC|CODE)\s*[:：]\s*/i, "").trim() || out.title;
  return { ...out, title, passage: nl(out.passage), prompt: nl(out.prompt), explanation: nl(out.explanation), choices: out.choices.map(nl) };
}

/** 決定論的な 32bit ハッシュ（FNV-1a）。推定できなかった問題タイプを「ユーザー×直近の作問数」でばらけさせる用 */
export const stableHash = fnv1a;

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

/** 依頼文から問題タイプを推定する（決定論）。判定できなければ null */
export function inferTaskTypeFromRequest(domain: DomainKey, text: string): string | null {
  const t = text.toLowerCase();
  if (domain === "READ") {
    if (/(語彙|言い換え|意味|表現)/.test(t)) return "vocabulary";
    if (/(表|グラフ|データ|数値|図)/.test(t)) return "data";
    if (/(批判|前提|反例|飛躍|妥当)/.test(t)) return "critique";
    if (/(推論|推測|読み取|暗示)/.test(t)) return "inference";
    if (/(要旨|要点|主張|要約)/.test(t)) return "summary";
    return null;
  }
  if (domain === "WRITE") {
    if (/(要約)/.test(t)) return "summary";
    if (/(書き換え|言い換え|書き直|敬語|短く)/.test(t)) return "rewrite";
    if (/(意見|主張|賛成|反対|作文|エッセイ)/.test(t)) return "argument";
    if (/(並べ替え|順序|接続|構成|段落)/.test(t)) return "structure";
    if (/(推敲|直し|明確|冗長|わかりやす)/.test(t)) return "revision";
    return null;
  }
  if (/(バグ|不具合|直して|間違い|エラー)/.test(t) && /(python|パイソン|コード|プログラ)/i.test(t)) return "debug";
  if (/(python|パイソン|コード|プログラ|出力予測|関数)/i.test(t)) return "python";
  if (/(数列|場合の数|確率|比率|割合|計算|数的)/.test(t)) return "math";
  if (/(手順|アルゴリズム|最短|フローチャート|擬似コード)/.test(t)) return "algorithm";
  if (/(パズル|推理|論理|条件)/.test(t)) return "puzzle";
  return null;
}

export function chooseTaskType(
  domain: DomainKey,
  req: { taskType?: string; kind?: Task["kind"]; request: string },
  prefs: TaskPrefs,
  kindHint: Task["kind"] | undefined,
  seed: number,
): { taskType: string | undefined; kind: Task["kind"] } {
  const kindOf = (t: string | undefined, fallback: Task["kind"]): Task["kind"] => (t && FREE_TASK_TYPES[domain].includes(t) ? "free" : fallback);
  if (req.taskType) return { taskType: req.taskType, kind: req.kind ?? kindOf(req.taskType, inferKind(req.request)) };
  const inferred = inferTaskTypeFromRequest(domain, req.request);
  const allowedAll = allowedTaskTypes(domain, prefs);
  if (inferred && allowedAll.includes(inferred)) return { taskType: inferred, kind: req.kind ?? kindOf(inferred, inferKind(req.request)) };
  // 形式ヒントに合うタイプ → 無ければ形式を free に切り替えて記述式タイプ → それも無ければ全許可タイプ
  const byKind = kindHint ? allowedTaskTypes(domain, prefs, kindHint) : allowedAll;
  const pool = byKind.length ? byKind : allowedTaskTypes(domain, prefs, "free").length ? allowedTaskTypes(domain, prefs, "free") : allowedAll;
  const taskType = pool.length ? pool[seed % pool.length] : undefined;
  const kind: Task["kind"] = req.kind ?? kindOf(taskType, kindHint ?? inferKind(req.request));
  return { taskType, kind };
}

/** 依頼文から domain を推定する（決定論）。判定できなければ null */
export function inferDomain(text: string): DomainKey | null {
  const t = text.toLowerCase();
  if (/(論理|パズル|推論|順番|条件|python|パイソン|コード|プログラ|バグ|計算|数列|手順|ロジック|logic|code)/.test(t)) return "CODE";
  if (/(書|作文|文章|要約を書|主張|反論|推敲|言い換え|説明文|write)/.test(t)) return "WRITE";
  if (/(読|読解|文章題|要旨|批判|記事|read|物語|文を読)/.test(t)) return "READ";
  return null;
}

/** 依頼文から形式を推定する。LINE では選択式が扱いやすいので既定は choice */
export function inferKind(text: string, fallback: Task["kind"] = "choice"): Task["kind"] {
  if (/(記述|自由|書いて|文章で|説明して)/.test(text)) return "free";
  if (/(短答|数値|数字で|一言で|答えだけ)/.test(text)) return "short";
  if (/(選択|4択|四択|クイズ)/.test(text)) return "choice";
  return fallback;
}

/** 依頼文から難易度を推定する（「やさしい」「むずかしい」など） */
export function inferDifficultyDelta(text: string): number {
  if (/(やさし|易し|簡単|入門|初級|軽め)/.test(text)) return -1;
  if (/(むずかし|難し|上級|難問|ハード|歯ごたえ)/.test(text)) return 1;
  return 0;
}

/** LOGIC の出題形式（Python か論理パズルか）を依頼文から決める。LLM に任せない */
export function inferLogicStyle(text: string): "python" | "logic" | null {
  if (/(python|パイソン|コード|プログラ|バグ|出力予測|関数)/i.test(text)) return "python";
  if (/(パズル|論理|推論|順番|条件|嘘|並び|手順|ロジック|logic)/.test(text)) return "logic";
  return null;
}
