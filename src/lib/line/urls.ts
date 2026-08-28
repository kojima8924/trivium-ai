// LINE から Web へ渡すリンクの組み立て（純粋関数）。
// env を読まないので、テストや client からも安全に import できる（appUrl は呼び出し側が渡す）。
import { DOMAIN_META, type DomainKey } from "@/lib/domain";

/** 系統の学習ページ URL。taskId を渡すとその問題を開いた状態になる */
export function learnUrl(appUrl: string, domain: DomainKey, taskId?: string): string {
  const base = `${appUrl.replace(/\/$/, "")}${DOMAIN_META[domain].path}`;
  return taskId ? `${base}?task=${encodeURIComponent(taskId)}` : base;
}

export function dashboardUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/dashboard`;
}

/** 使い方画像（public/line/howto.png）の絶対 URL。LINE は HTTPS の絶対 URL しか受け付けない */
export function howtoImageUrl(appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/line/howto.png?v=1`;
}
