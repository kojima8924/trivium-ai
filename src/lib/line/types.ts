// LINE レイヤーの共通型（返信の形・意図の種類）。値を持たない型だけのモジュールなので、
// どのファイルからも循環参照を気にせず import できる。
// 出力型は @line/bot-sdk の messagingApi.Message と互換な最小サブセット。
import type { messagingApi } from "@line/bot-sdk";
import type { DomainKey } from "@/lib/domain";
import type { MaterialKind } from "@/lib/materials/types";
import type { LineState } from "./state";

export type LeaderAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "message"; label: string; text: string }
  | { type: "postback"; label: string; data: string; displayText?: string };

export type LeaderReply = {
  text: string;
  /** 下部に並ぶ Quick Reply（最大13件、ここでは4件まで） */
  quickReplies?: LeaderAction[];
  /** ボタンテンプレート（Web へのリンク） */
  buttons?: { title: string; text: string; actions: LeaderAction[] };
  /** 状態更新（案内した domain） */
  suggestedDomain?: DomainKey;
  /** state.note に残すメモ */
  note?: string;
  /** キャラの吹き出し（Flex）。あれば text の代わりにこれを送る（quickReplies はこちらに付く） */
  flex?: messagingApi.FlexContainer;
  /** flex 送信時の通知文。省略時は text の先頭 */
  altText?: string;
};

export type LeaderContext = {
  state: LineState;
  appUrl: string;
  now?: Date;
  /** Web 側の Leader プロフィール（連携済みのときだけ。任意） */
  leaderProfile?: { summary: string; recommendation: string; recommendedDomain?: DomainKey | null } | null;
  /** Web アカウントと連携済みか */
  linked?: boolean;
  /** 連携用のワンタイムURL（未連携で連携を求められたときだけ渡す） */
  linkUrl?: string;
  /** 連携済みのときの能力スコア（数値は evidence。Dashboard と同じ集計値） */
  scores?: { domain: DomainKey; score: number; evidenceCount: number; confidence: string }[];
};

export type Intent =
  | { kind: "domain"; domain: DomainKey }
  | { kind: "quiz"; domain: DomainKey | null; difficulty?: number; difficultyDelta?: number; taskType?: string }
  | { kind: "generate"; request: string; domain?: DomainKey | null; difficulty?: number }
  | { kind: "link" }
  | { kind: "unlink" }
  /** 出題中の課題をパス（テキストの「パス」「スキップ」） */
  | { kind: "pass" }
  /** 出題中の課題へのヒント要求（「ヒント」「わからない」）。出題中でなければ会話へ */
  | { kind: "hint" }
  /** 教材（本・サイト・動画）のおすすめ。ADVISOR が能力プロフィールに合わせて選ぶ */
  | { kind: "materials"; domain: DomainKey | null; text: string; freeOnly?: boolean; kind_?: MaterialKind | null }
  | { kind: "today" }
  | { kind: "history" }
  | { kind: "profile" }
  | { kind: "short_time"; minutes: number | null }
  | { kind: "tired" }
  | { kind: "help" }
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "unknown" };
