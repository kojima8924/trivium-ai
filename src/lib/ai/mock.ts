// Mock provider: Dify 未設定・障害時でもアプリ全体が壊れないためのルールベース実装。
// 「一度に一段だけヒント」「完成解は渡さない」「証拠のない断定をしない」を守る。

import { DOMAIN_META, SUBSKILL_LABELS, SUBSKILLS, type DomainKey } from "../domain";
import type {
  DomainEvalInput,
  DomainEvalOutput,
  DomainInterpretInput,
  DomainInterpretOutput,
  GenerateTaskInput,
  GenerateTaskOutput,
  LeaderInput,
  LeaderOutput,
  LearningAIProvider,
  PersonaPrompt,
} from "./types";

/** 人格が指定されていれば短い名乗りを添える（Mock でも「4人いる」感を出す） */
function signed(text: string, persona?: PersonaPrompt): string {
  return persona ? `${persona.name}: ${text}` : text;
}

// LLM が使えないときの定型問題（domain ごとに 1 種類ずつ。数値は依頼ごとに少し変える）
const CANNED: Record<DomainKey, (seed: number) => GenerateTaskOutput> = {
  READ: (seed) => ({
    title: "推論: 行動から状況を読む",
    passage: `Dさんは会議室の前で立ち止まり、時計を見てから鞄の中を探した。${seed % 2 === 0 ? "資料は机の上に置いたままだった。" : "ノートパソコンの充電器が見当たらなかった。"}Dさんは小さくため息をつき、来た道を戻った。`,
    prompt: "Dさんが来た道を戻った理由として最も自然なものを選んでください。",
    choices: ["会議が中止になったから", "忘れ物を取りに行くため", "別の会議室に呼ばれたから", "時計が止まっていたから"],
    answerKey: ["1"],
    rubric: null,
    hints: ["Dさんが直前にしていた動作は何ですか？", "鞄の中を探して、見つからなかったものがあります。", "見つからなかったものを取りに行く、という流れで考えてみましょう。"],
    explanation: "鞄を探して見つからない→ため息→来た道を戻る、という行動の連鎖から、忘れ物を取りに戻ったと推論するのが自然です。",
    skillTags: ["inference"],
  }),
  WRITE: (seed) => ({
    title: "構成: 一文を分けて直す",
    passage: `元の文: 「${seed % 2 === 0 ? "この提案は費用がかかるが効果も大きいので採用すべきだと思うがリスクもあるので検討が必要だ" : "新しい手順は速いが慣れるまで時間がかかるので導入は段階的にすべきだと考えるが反対もある"}。」`,
    prompt: "この文を、意味を保ったまま2〜3文に分けて書き直してください（60〜120字）。",
    choices: [],
    answerKey: [],
    rubric: { mustInclude: ["。", "しかし", "ただし", "一方", "そのため", "だから"], minLength: 40, maxLength: 200, criteria: ["2〜3文に分かれているか", "主張と留保が区別されているか", "意味が変わっていないか"] },
    hints: ["この文には主張がいくつ入っていますか？", "「〜が」で繋がっている箇所で切ってみましょう。", "主張の文と、留保（ただし〜）の文を分けてみましょう。"],
    explanation: "「〜が〜が〜」と続く文は、主張・理由・留保に分けると読みやすくなります。",
    skillTags: ["structure", "clarity"],
  }),
  CODE: (seed) => ({
    title: "推論: 条件から順番を決める",
    passage: `A・B・C の3人が一列に並んでいる。
・A は B より前にいる。
・C は先頭ではない。
・${seed % 2 === 0 ? "B は最後尾ではない。" : "A は先頭ではない。"}`,
    prompt: "3人の並び順（先頭→最後尾）として正しいものを選んでください。",
    choices: seed % 2 === 0 ? ["A, B, C", "A, C, B", "B, A, C", "C, A, B"] : ["A, B, C", "B, A, C", "C, A, B", "B, C, A"],
    answerKey: seed % 2 === 0 ? ["1"] : ["2"],
    rubric: null,
    hints: ["条件を1つずつ使って、あり得ない並びを消してみましょう。", "「C は先頭ではない」で先頭候補は誰に絞れますか？", "残った候補に、3つ目の条件を当ててみましょう。"],
    explanation: seed % 2 === 0 ? "A が B より前・C は先頭でない・B は最後尾でない、を満たすのは A, C, B だけです。" : "A は先頭でない・C も先頭でない→先頭は B。A が B より前という条件と矛盾しない並びは C, A, B です。",
    skillTags: ["tracing", "algorithms"],
  }),
};

const MODE_TO_DOMAIN: Record<DomainEvalInput["mode"], DomainKey> = {
  read: "READ",
  write: "WRITE",
  code: "CODE",
};

export class MockProvider implements LearningAIProvider {
  readonly name = "mock";

  async generateTask(input: GenerateTaskInput): Promise<GenerateTaskOutput> {
    const seed = input.recentTitles.length + input.request.length;
    const t = CANNED[input.domain](seed);
    // 依頼の kind と違う形式しか用意がない場合はそのまま返す（呼び出し側が kind を合わせる）
    return { ...t, skillTags: t.skillTags.filter((x) => input.allowedSkillTags.includes(x)) };
  }

  async evaluate(input: DomainEvalInput): Promise<DomainEvalOutput> {
    const isFree = input.deterministicResult === null;
    const success = (input.deterministicResult ?? input.heuristicResult) === true;
    const hintIdx = Math.min(input.hintLevel, input.task.hints.length - 1);
    const nextHint = input.task.hints[hintIdx] ?? "もう一度、問題文の条件を一つずつ確認してみましょう。";

    if (success) {
      const feedback = isFree
        ? input.hintLevel === 0
          ? "評価観点を満たしています。自分の文章で一番効いている一文はどれか、意識してみてください。"
          : `問い返し${input.hintLevel}回を経て観点を満たしました。最初の文章から何を足したかを振り返ってみましょう。`
        : input.hintLevel === 0
          ? "正解です。ヒントなしで到達できました。どこで確信が持てたか、一言で言えますか？"
          : `正解です。ヒント${input.hintLevel}回で到達しました。最初の答えと何が違ったかを振り返ってみましょう。`;
      return {
        status: "success",
        feedback: signed(feedback, input.persona),
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
      feedback: signed(intro, input.persona),
      hint: nextHint,
      observations: [`難易度${input.task.difficulty}の課題で誤答（ヒント${input.hintLevel + 1}回目）`],
      skillTags: [],
      recommendedNextDifficulty: Math.max(1, input.task.difficulty - (input.hintLevel >= 2 ? 1 : 0)),
    };
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
        recommendation: "LOGIC の「出力予測」を1問（約3分）",
        recommendedDomain: "CODE",
      };
    }
    const sorted = [...measured].sort((a, b) => b.score - a.score);
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const leastPracticed = [...input.domains].sort((a, b) => a.eventsLast7Days - b.eventsLast7Days)[0];
    const mostPracticed = [...input.domains].sort((a, b) => b.eventsLast7Days - a.eventsLast7Days)[0];

    const summaryParts: string[] = [];
    const L = (d: DomainKey) => DOMAIN_META[d].label;
    summaryParts.push(`${L(strongest.domain)}（${strongest.score}）を強みにしています。`);
    if (measured.length >= 2 && weakest.domain !== strongest.domain) {
      summaryParts.push(
        `${L(weakest.domain)}（${weakest.score}）を伸ばすことで、${L(strongest.domain)}の強みをより活かしやすくなります。`,
      );
    }
    if (measured.length < 3) {
      const missing = input.domains.filter((d) => d.evidenceCount === 0).map((d) => L(d.domain));
      summaryParts.push(`${missing.join("・")}は未計測のため、全体像はまだ暫定です。`);
    }
    const lowConf = measured.filter((d) => d.confidence === "low");
    if (lowConf.length) summaryParts.push(`${lowConf.map((d) => L(d.domain)).join("・")}は記録が少なく信頼度lowです。`);

    if (input.lastEvent) {
      const e = input.lastEvent;
      const how = e.success ? (e.hintCount === 0 ? "ヒントなしで解決" : `ヒント${e.hintCount}回で解決`) : "未達";
      summaryParts.push(`直近では${L(e.domain)}「${e.taskTitle}」（難易度${e.difficulty}）を${how}。`);
    }

    const observations: string[] = [];
    if (mostPracticed.eventsLast7Days > 0)
      observations.push(`直近7日は${L(mostPracticed.domain)}に偏っている（${mostPracticed.eventsLast7Days}件）`);
    if (leastPracticed.eventsLast7Days === 0)
      observations.push(`${L(leastPracticed.domain)}は直近7日で取り組みなし`);

    // 次のおすすめ: 直近で少ない domain を優先し、その domain の recommendedNext を使う
    const target =
      leastPracticed.evidenceCount === 0 ? leastPracticed : weakest.domain === strongest.domain ? leastPracticed : weakest;
    const recommendation =
      target.recommendedNext && target.evidenceCount > 0
        ? `${L(target.domain)}: ${target.recommendedNext}`
        : `${L(target.domain)}: まず1問取り組んで計測を始める`;

    return {
      summary: signed(summaryParts.join(""), input.persona),
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
