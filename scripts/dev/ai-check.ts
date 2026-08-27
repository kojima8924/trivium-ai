// AI provider の疎通・品質チェック（開発用）。
//   npx tsx --conditions=react-server scripts/dev/ai-check.ts
// 現在の env（AI_PROVIDER / ANTHROPIC_* / DIFY_*）で LearningAIService を組み立て、
// 3つの呼び出し（evaluate / interpretDomain / leader）を代表入力で実行し、応答と所要時間を表示する。
// 「答えを漏らしていないか」「一段だけか」を目視で確認するためのもの。DB には触らない。
import "dotenv/config";
import { learningAI, aiStatus } from "../../src/lib/ai";
import { getTask } from "../../src/lib/tasks";

function pick(id: string) {
  const t = getTask(id);
  if (!t) throw new Error(`task not found: ${id}`);
  return {
    id: t.id,
    title: t.title,
    passage: t.passage,
    prompt: t.prompt,
    kind: t.kind,
    choices: t.choices,
    difficulty: t.difficulty,
    criteria: t.rubric?.criteria,
    hints: t.hints,
  };
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`\n=== ${label} (${Date.now() - t0} ms / provider=${aiStatus().lastUsed}) ===`);
  console.log(JSON.stringify(r, null, 2));
  return r;
}

async function main() {
  console.log("provider:", aiStatus());
  const profile = { score: 79, subskills: { tracing: 80, debugging: 79, algorithms: 79, design: 49 }, confidence: "high" as const, evidenceCount: 10, summary: "" };

  // 1) CODE 誤答（決定論的に incorrect）→ 一段ヒントのみ、答え(3.0)を漏らさないこと
  const wrong = await timed("evaluate: code-003 誤答 hint_level=0", () =>
    learningAI.evaluate({
      mode: "code",
      learnerRef: "dev-check",
      task: pick("code-003"),
      learnerAnswer: "4.0",
      deterministicResult: false,
      heuristicResult: null,
      hintLevel: 0,
      currentDomainProfile: profile,
      recentBehavior: ["code-001: success (hints=0, difficulty=2)"],
    }),
  );
  const leak = /3\.0|3\b/.test(`${wrong.feedback} ${wrong.hint}`);
  console.log(leak ? "!! 答えが漏れている可能性（3.0 / 3 を含む）" : "OK: 答え（3.0）を含まない");

  // 2) CODE 正答（決定論的に correct）
  await timed("evaluate: code-003 正答 hint_level=1", () =>
    learningAI.evaluate({
      mode: "code",
      learnerRef: "dev-check",
      task: pick("code-003"),
      learnerAnswer: "3.0",
      deterministicResult: true,
      heuristicResult: null,
      hintLevel: 1,
      currentDomainProfile: profile,
      recentBehavior: [],
    }),
  );

  // 3) WRITE 自由記述（弱い回答）→ needs_more で問い返し
  await timed("evaluate: write-002 弱い回答", () =>
    learningAI.evaluate({
      mode: "write",
      learnerRef: "dev-check",
      task: pick("write-002"),
      learnerAnswer: "スマホ禁止は正しいと思う。",
      deterministicResult: null,
      heuristicResult: false,
      hintLevel: 0,
      currentDomainProfile: { score: 57, subskills: { structure: 63, reasoning: 63, clarity: 41, revision: 41 }, confidence: "medium", evidenceCount: 5, summary: "" },
      recentBehavior: [],
    }),
  );

  // 4) 寸評
  await timed("interpretDomain: CODE", () =>
    learningAI.interpretDomain({
      mode: "code",
      learnerRef: "dev-check",
      stats: { ...profile, successRate: 0.9, avgHints: 0.3, avgDifficulty: 3.4 },
      recentEvents: [
        { taskTitle: "バグ発見: 平均値の計算", difficulty: 3, success: true, hintCount: 1, skillTags: ["debugging", "tracing"], daysAgo: 0 },
        { taskTitle: "設計の言語化: なぜ関数に分けるのか", difficulty: 3, success: false, hintCount: 3, skillTags: ["design"], daysAgo: 1 },
      ],
    }),
  );

  // 5) Leader
  await timed("leader", () =>
    learningAI.leader({
      learnerRef: "dev-check",
      totalEvents: 24,
      domains: [
        { domain: "READ", score: 72, subskills: { comprehension: 75, inference: 63, critical_reading: 46 }, confidence: "high", evidenceCount: 8, summary: "要旨把握は安定。批判的読解に改善余地。", observations: [], recommendedNext: "批判的読解の課題", eventsLast7Days: 4 },
        { domain: "WRITE", score: 57, subskills: { structure: 63, reasoning: 63, clarity: 41, revision: 41 }, confidence: "medium", evidenceCount: 5, summary: "明確さ・推敲に改善余地。", observations: [], recommendedNext: "明確さの課題", eventsLast7Days: 2 },
        { domain: "CODE", score: 80, subskills: { tracing: 80, debugging: 79, algorithms: 79, design: 49 }, confidence: "high", evidenceCount: 11, summary: "トレース・デバッグ・アルゴリズムは安定。設計の言語化に余地。", observations: [], recommendedNext: "設計の言語化の課題", eventsLast7Days: 7 },
      ],
      lastEvent: { domain: "CODE", taskTitle: "バグ発見: 平均値の計算", difficulty: 3, success: true, hintCount: 1, minutesAgo: 1 },
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
