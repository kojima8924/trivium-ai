// 使い方ガイドの定数（目次・難易度の目安・担当キャラの対応）。
// 表示の都合で長くなるデータはここに置き、page.tsx / sections.tsx は組み立てに集中する。
import { DOMAIN_META, type DomainKey } from "@/lib/domain";
import type { AgentKey } from "@/lib/persona";

export const SECTIONS = [
  { id: "about", label: "Trivium とは" },
  { id: "domains", label: "3 つの系統とキャラ" },
  { id: "difficulty", label: "難易度の目安（1〜10）" },
  { id: "scoring", label: "到達レベルと採点" },
  { id: "triangle", label: "三角グラフの読み方" },
  { id: "xp", label: "XP・ミッション・ランク" },
  { id: "line", label: "LINE での使い方" },
  { id: "policy", label: "AI の方針" },
] as const;

// 系統ごとの担当キャラ（内部キー LEADER = 表示名 ADVISOR）
export const AGENT_OF: Record<DomainKey, AgentKey> = { READ: "READ", WRITE: "WRITE", CODE: "CODE" };

/** 口癖は補足（extra）の「口癖は「…」」から抜く。無ければ空 */
export function catchphrases(extra: string): string[] {
  const m = extra.match(/口癖は(.+?)(?:（|$)/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/「([^」]+)」/g), (x) => x[1]);
}

export type DifficultyRow = { range: string; what: string };

export const DIFFICULTY: { key: string; title: string; color: string; rows: DifficultyRow[] }[] = [
  {
    key: "read",
    title: "READ（読解）",
    color: DOMAIN_META.READ.color,
    rows: [
      { range: "1〜2", what: "本文 60〜120 字の平易な文。要旨や事実の確認" },
      { range: "3〜4", what: "本文 120〜200 字。書かれていないことの推論、主張と理由の区別" },
      { range: "5〜6", what: "本文 200〜320 字。対比・因果・譲歩（しかし／ただし）から筆者の立場を読む" },
      { range: "7〜8", what: "本文 320〜450 字の論説。暗黙の前提・反例・論理の飛躍を見抜く" },
      { range: "9〜10", what: "本文 450〜600 字。複数の立場を根拠の強さで比較して判断する" },
    ],
  },
  {
    key: "write",
    title: "WRITE（作文）",
    color: DOMAIN_META.WRITE.color,
    rows: [
      { range: "1〜3", what: "短い文の明確さ（語順・冗長な語・指示語）。60〜100 字の意見文" },
      { range: "4〜6", what: "段落の順序・接続詞・主張と根拠の対応。100〜160 字で主張＋理由＋具体例" },
      { range: "7〜10", what: "論理の欠陥（根拠の飛躍・二重基準・曖昧な定義）を見抜く。150〜240 字で反論への応答" },
    ],
  },
  {
    key: "python",
    title: "LOGIC（Python の読解）",
    color: DOMAIN_META.CODE.color,
    rows: [
      { range: "1〜2", what: "変数・算術・文字列連結と print（1〜6 行）" },
      { range: "3〜4", what: "for / if・リストの基本操作（6〜10 行）" },
      { range: "5〜6", what: "辞書・スライス・文字列メソッド・while・関数（8〜14 行）" },
      { range: "7〜8", what: "再帰・sorted の key・内包表記・状態更新の追跡（12〜18 行）" },
      { range: "9〜10", what: "クロージャ・ジェネレータ・参照の共有・複合的な状態変化（15〜22 行）" },
    ],
  },
  {
    key: "logic",
    title: "LOGIC（論理パズル）",
    color: DOMAIN_META.CODE.color,
    rows: [
      { range: "1〜2", what: "3 要素の並び順。条件 2 つで一意に決まる" },
      { range: "3〜4", what: "4〜5 要素・条件 3〜4 つの割り当て" },
      { range: "5〜6", what: "真偽者（正直者と嘘つき）・表を使った対応づけ" },
      { range: "7〜8", what: "複数の制約の同時充足。場合分けが 2〜3 通り" },
      { range: "9〜10", what: "多段の推論と排反なケース分析。見落としやすい条件を含む" },
    ],
  },
];
