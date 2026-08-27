// 問題タイプの定義（純粋モジュール。server-only なし。クライアントの設定画面とサーバーの出題・作問の両方から使う）
//   - 系統ごとに 5 タイプ。ストック生成（scripts/stock/gen_stock.mts）もこのキーで taskType を付ける
//   - 複合問題（2 系統以上の axes を持つ課題）は "composite" として系統横断で扱う
//   - 学習者は /settings で「出題しないタイプ」を除外できる（LeaderProfile.preferences に保存。src/lib/task-prefs.ts）
import type { DomainKey } from "./domain";

export type TaskTypeDef = { key: string; label: string; description: string };

export const TASK_TYPES = {
  READ: [
    { key: "summary", label: "要旨把握", description: "本文の主張・要点を選ぶ" },
    { key: "inference", label: "推論", description: "書かれていないことを根拠から推し量る" },
    { key: "critique", label: "批判的読解", description: "前提・反例・論理の飛躍を見抜く" },
    { key: "vocabulary", label: "語彙・表現", description: "文脈での語の意味・言い換え" },
    { key: "data", label: "図表・データ読解", description: "文章で示された表・数値を読む" },
  ],
  WRITE: [
    { key: "revision", label: "推敲（明確な文を選ぶ）", description: "冗長・曖昧・ねじれを直した文を選ぶ" },
    { key: "structure", label: "構成（順序・接続）", description: "文や段落の順序・接続詞・主張と根拠の対応" },
    { key: "argument", label: "意見文（記述）", description: "お題に意見と理由を書く" },
    { key: "summary", label: "要約（記述）", description: "文章を指定字数で要約する" },
    { key: "rewrite", label: "書き換え（記述）", description: "指定の条件で文を書き直す" },
  ],
  CODE: [
    { key: "python", label: "Python 読解", description: "短いコードの出力を予測する" },
    { key: "debug", label: "Python バグ発見", description: "期待と違う動作の原因行を見つける" },
    { key: "puzzle", label: "論理パズル", description: "条件から一意に決まる答えを推理する" },
    { key: "math", label: "数的推理", description: "数列・場合の数・比率などの推理" },
    { key: "algorithm", label: "手順・アルゴリズム", description: "手順の結果や最短手順を考える" },
  ],
} as const satisfies Record<DomainKey, readonly TaskTypeDef[]>;

export const COMPOSITE_TYPE: TaskTypeDef = { key: "composite", label: "複合問題（2 系統以上）", description: "READ+LOGIC など複数系統にまたがる課題" };

export type TaskTypeKey<D extends DomainKey = DomainKey> = (typeof TASK_TYPES)[D][number]["key"];

/** 系統のタイプキー一覧 */
export function allTaskTypeKeys(domain: DomainKey): string[] {
  return TASK_TYPES[domain].map((t) => t.key);
}

/** 表示名（未知のキーはそのまま返す） */
export function taskTypeLabel(domain: DomainKey, key: string): string {
  if (key === COMPOSITE_TYPE.key) return COMPOSITE_TYPE.label;
  return TASK_TYPES[domain].find((t) => t.key === key)?.label ?? key;
}

/** 記述式（free）で出すタイプ（LINE の選択式出題では自動的に外れる） */
export const FREE_TASK_TYPES: Record<DomainKey, readonly string[]> = {
  READ: [],
  WRITE: ["argument", "summary", "rewrite"],
  CODE: [],
};

/** 学習者の出題設定（/settings）。すべて省略＝全部出す */
export type TaskPrefs = {
  /** 系統ごとに「出さない」タイプのキー */
  excludedTaskTypes: Record<DomainKey, string[]>;
  /** 複合問題を出さない */
  excludeComposite: boolean;
};

export const DEFAULT_TASK_PREFS: TaskPrefs = {
  excludedTaskTypes: { READ: [], WRITE: [], CODE: [] },
  excludeComposite: false,
};

/** 未知の JSON から TaskPrefs を組み立てる（不正な値は無視して既定に） */
export function parseTaskPrefs(raw: unknown): TaskPrefs {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ex = (o.excludedTaskTypes && typeof o.excludedTaskTypes === "object" ? o.excludedTaskTypes : {}) as Record<string, unknown>;
  const pick = (d: DomainKey): string[] => {
    const v = ex[d];
    if (!Array.isArray(v)) return [];
    const keys = new Set(allTaskTypeKeys(d));
    return v.filter((k): k is string => typeof k === "string" && keys.has(k));
  };
  return {
    excludedTaskTypes: { READ: pick("READ"), WRITE: pick("WRITE"), CODE: pick("CODE") },
    excludeComposite: o.excludeComposite === true,
  };
}

/**
 * 各系統で少なくとも 1 タイプは残っているか（全部除外は出題不能になるので保存時に拒否する）。
 * LINE は選択式しか出せないので、選択式（choice）で出せるタイプが 0 になる設定も拒否する（kind: "choice" を返す）。
 */
export function taskPrefsLeaveSomething(prefs: TaskPrefs): { ok: true } | { ok: false; domain: DomainKey; kind?: "choice" } {
  for (const d of ["READ", "WRITE", "CODE"] as const) {
    if (prefs.excludedTaskTypes[d].length >= allTaskTypeKeys(d).length) return { ok: false, domain: d };
    if (allowedTaskTypes(d, prefs, "choice").length === 0) return { ok: false, domain: d, kind: "choice" };
  }
  return { ok: true };
}

/** axes が 2 系統以上で正なら複合課題 */
export function isCompositeAxes(axes: { read?: number; write?: number; code?: number } | undefined): boolean {
  if (!axes) return false;
  return [axes.read ?? 0, axes.write ?? 0, axes.code ?? 0].filter((v) => v > 0).length >= 2;
}

/** 設定に照らして、この課題を出してよいか（taskType 未設定の課題は常に可） */
export function taskAllowedByPrefs(task: { domain: DomainKey; taskType?: string; axes?: { read?: number; write?: number; code?: number } }, prefs: TaskPrefs): boolean {
  const composite = task.taskType === COMPOSITE_TYPE.key || isCompositeAxes(task.axes);
  if (composite) return !prefs.excludeComposite;
  if (!task.taskType) return true;
  return !prefs.excludedTaskTypes[task.domain].includes(task.taskType);
}

/** 系統の中で「出してよい」タイプ（kind を指定すると、その形式で出せるタイプに絞る） */
export function allowedTaskTypes(domain: DomainKey, prefs: TaskPrefs, kind?: "choice" | "short" | "free"): string[] {
  return allTaskTypeKeys(domain).filter((k) => {
    if (prefs.excludedTaskTypes[domain].includes(k)) return false;
    if (kind === "free") return FREE_TASK_TYPES[domain].includes(k);
    if (kind === "choice" || kind === "short") return !FREE_TASK_TYPES[domain].includes(k);
    return true;
  });
}
