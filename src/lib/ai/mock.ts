// Mock provider: Dify 未設定・障害時でもアプリ全体が壊れないためのルールベース実装。
// 「一度に一段だけヒント」「完成解は渡さない」「証拠のない断定をしない」を守る。

import { DOMAIN_META, SUBSKILL_LABELS, SUBSKILLS, type DomainKey } from "../domain";
import type {
  DomainEvalInput,
  DomainEvalOutput,
  DomainInterpretInput,
  DomainInterpretOutput,
  LeaderInput,
  LeaderOutput,
  LearningAIProvider,
} from "./types";

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = {
  read: "READ",
  write: "WRITE",
  code: "CODE",
};

export class MockProvider implements LearningAIProvider {
  readonly name = "mock";

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const success = input.deterministicResult === true;
    const hintIdx = Math.min(input.hintLevel, input.task.hints.length - 1);
    const nextHint = input.task.hints[hintIdx] ?? "もう一度、問題文の条件を一つずつ確認してみましょう。";

    if (success) {
      const feedback =
        input.hintLevel === 0
          ? "正解です。ヒントなしで到達できました。どこで確信が持てたか、一言で言えますか？"
          : `正解です。ヒント${input.hintLevel}回で到達しました。最初の答えと何が違ったかを振り返ってみましょう。`;
      return {
        status: "success",
        feedback,
        hint: "",
        observations: [
          input.hintLevel === 0
            ? `難易度${input.task.difficulty}の課題をヒントなしで解決`
            : `難易度${input.task.difficulty}の課題をヒント${input.hintLevel}回で解決`,
        ],
        skillTags: [],
        recommendedNextDifficulty: Math.min(5, input.task.difficulty + (input.hintLevel === 0 ? 1 : 0)),
      };
    }

    if (input.deterministicResult === null) {
      // free タスク: ヒューリスティックが不合格と判断したケース
      return {
        status: "needs_more",
        feedback: "まだ観点が足りないようです。書き直す前に、次の問いを考えてみてください。",
        hint: nextHint,
        observations: [`難易度${input.task.difficulty}の記述課題で追加のヒントが必要だった`],
        skillTags: [],
        recommendedNextDifficulty: input.task.difficulty,
      };
    }

    const intro =
      input.hintLevel === 0
        ? "その答えでは正解になりません。まずは一つだけ確認してみましょう。"
        : "まだ違うようです。もう一段だけ考える材料を出します。";
    return {
      status: "retry",
      feedback: intro,
      hint: nextHint,
      observations: [`難易度${input.task.difficulty}の課題で誤答（ヒント${input.hintLevel + 1}回目）`],
      skillTags: [],
      recommendedNextDifficulty: Math.max(1, input.task.difficulty - (input.hintLevel >= 2 ? 1 : 0)),
    };
    void domain;
  }

  async interpretDomain(input: DomainInterpretInput): Promise<DomainInterpretOutput> {
    const domain = MODE_TO_DOMAIN[input.mode];
    const { stats } = input;
    if (stats.evidenceCount === 0) {
      return {
        summary: "まだ学習記録がありません。1問取り組むと分析が始まります。",
        observations: [],
        recommendedNext: `${DOMAIN_META[domain].ja}の課題を1問試してみましょう。`,
      };
    }
    const entries = Object.entries(stats.subskills).sort((a, b) => b[1] - a[1]);
    const strong = entries.filter(([, v]) => v >= 70).map(([k]) => SUBSKILL_LABELS[k] ?? k);
    const weak = entries.filter(([, v]) => v < 60).map(([k]) => SUBSKILL_LABELS[k] ?? k);
    const unmeasured = SUBSKILLS[domain]
      .filter((s) => !(s in stats.subskills))
      .map((s) => SUBSKILL_LABELS[s] ?? s);

    const parts: string[] = [];
    if (strong.length) parts.push(`${strong.join("・")}は安定しています。`);
    if (weak.length) parts.push(`${weak.join("・")}には改善余地があります。`);
    if (!strong.length && !weak.length) parts.push("各観点とも中程度で、偏りはまだ見えていません。");
    if (stats.confidence === "low") parts.push("記録がまだ少ないため、これは暫定的な見立てです。");
    if (unmeasured.length) parts.push(`${unmeasured.join("・")}は未計測です。`);

    const observations: string[] = [];
    if (stats.avgHints >= 1.5) observations.push("ヒントに頼る回数が多め（平均" + stats.avgHints.toFixed(1) + "回）");
    else if (stats.avgHints < 0.5) observations.push("ヒントなしで解決する割合が高い");
    if (stats.successRate >= 0.8) observations.push("成功率が高い（" + Math.round(stats.successRate * 100) + "%）");
    else if (stats.successRate < 0.5) observations.push("失敗が多く、難易度が合っていない可能性");
    const recentFail = input.recentEvents.filter((e) => !e.success).length;
    if (recentFail >= 2) observations.push(`直近${input.recentEvents.length}件中${recentFail}件が失敗`);

    let recommendedNext: string;
    if (unmeasured.length) recommendedNext = `未計測の「${unmeasured[0]}」を含む課題に取り組む`;
    else if (weak.length) recommendedNext = `「${weak[0]}」を扱う難易度${Math.max(1, Math.round(stats.avgDifficulty))}の課題を1問`;
    else recommendedNext = `難易度${Math.min(5, Math.round(stats.avgDifficulty) + 1)}の課題に挑戦する`;

    return { summary: parts.join(""), observations, recommendedNext };
  }

  async leader(input: LeaderInput): Promise<LeaderOutput> {
    const measured = input.domains.filter((d) => d.evidenceCount > 0);
    if (measured.length === 0) {
      return {
        summary: "まだ学習記録がありません。READ / WRITE / CODE のどれか1つから始めると、全体像の分析が始まります。",
        interests: [],
        preferences: {},
        observations: [],
        recommendation: "CODE の「出力予測」を1問（約3分）",
        recommendedDomain: "CODE",
      };
    }
    const sorted = [...measured].sort((a, b) => b.score - a.score);
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const leastPracticed = [...input.domains].sort((a, b) => a.eventsLast7Days - b.eventsLast7Days)[0];
    const mostPracticed = [...input.domains].sort((a, b) => b.eventsLast7Days - a.eventsLast7Days)[0];

    const summaryParts: string[] = [];
    summaryParts.push(`${strongest.domain}（${strongest.score}）を強みにしています。`);
    if (measured.length >= 2 && weakest.domain !== strongest.domain) {
      summaryParts.push(
        `${weakest.domain}（${weakest.score}）を伸ばすことで、${strongest.domain}の強みをより活かしやすくなります。`,
      );
    }
    if (measured.length < 3) {
      const missing = input.domains.filter((d) => d.evidenceCount === 0).map((d) => d.domain);
      summaryParts.push(`${missing.join("・")}は未計測のため、全体像はまだ暫定です。`);
    }
    const lowConf = measured.filter((d) => d.confidence === "low");
    if (lowConf.length) summaryParts.push(`${lowConf.map((d) => d.domain).join("・")}は記録が少なく信頼度lowです。`);

    const observations: string[] = [];
    if (mostPracticed.eventsLast7Days > 0)
      observations.push(`直近7日は${mostPracticed.domain}に偏っている（${mostPracticed.eventsLast7Days}件）`);
    if (leastPracticed.eventsLast7Days === 0)
      observations.push(`${leastPracticed.domain}は直近7日で取り組みなし`);

    // 次のおすすめ: 直近で少ない domain を優先し、その domain の recommendedNext を使う
    const target =
      leastPracticed.evidenceCount === 0 ? leastPracticed : weakest.domain === strongest.domain ? leastPracticed : weakest;
    const recommendation =
      target.recommendedNext && target.evidenceCount > 0
        ? `${target.domain}: ${target.recommendedNext}`
        : `${target.domain}: まず1問取り組んで計測を始める`;

    return {
      summary: summaryParts.join(""),
      interests: measured.map((d) => `${d.domain}: ${d.eventsLast7Days}件/週`),
      preferences: {
        practiceFocus: mostPracticed.domain,
        preferredDifficulty: String(Math.round(measured.reduce((a, d) => a + d.score, 0) / measured.length / 25) + 1),
      },
      observations,
      recommendation,
      recommendedDomain: target.domain,
    };
  }
}
