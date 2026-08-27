// MockProvider（Dify フォールバック）の振る舞い
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../src/lib/ai/mock";
import type { DomainEvalInput, DomainInterpretInput, LeaderInput } from "../src/lib/ai/types";

const provider = new MockProvider();

function evalInput(over: Partial<DomainEvalInput> = {}): DomainEvalInput {
  return {
    mode: "code",
    learnerRef: "user-1",
    task: {
      id: "code-001",
      title: "t",
      prompt: "p",
      kind: "short",
      difficulty: 3,
      hints: ["hint-0", "hint-1", "hint-2"],
    },
    learnerAnswer: "x",
    deterministicResult: false,
    heuristicResult: null,
    hintLevel: 0,
    currentDomainProfile: { score: 0, subskills: {}, confidence: "low", evidenceCount: 0, summary: "" },
    recentBehavior: [],
    ...over,
  };
}

test("evaluate: 成功時は hint 空・status success", async () => {
  const r = await provider.evaluate(evalInput({ deterministicResult: true, hintLevel: 0 }));
  assert.equal(r.status, "success");
  assert.equal(r.hint, "");
  assert.ok(r.feedback.length > 0);
  assert.equal(r.recommendedNextDifficulty, 4);
  const r2 = await provider.evaluate(evalInput({ deterministicResult: true, hintLevel: 2 }));
  assert.equal(r2.status, "success");
  assert.equal(r2.recommendedNextDifficulty, 3);
});

test("evaluate: retry 時は hints[hintLevel] を一段だけ返す", async () => {
  for (let lv = 0; lv < 3; lv++) {
    const r = await provider.evaluate(evalInput({ hintLevel: lv }));
    assert.equal(r.status, "retry");
    assert.equal(r.hint, `hint-${lv}`);
    assert.ok(!r.hint.includes(`hint-${lv + 1}`));
  }
});

test("evaluate: hintLevel が hints 長を超えても落ちず最後のヒントを返す", async () => {
  const r = await provider.evaluate(evalInput({ hintLevel: 10 }));
  assert.equal(r.status, "retry");
  assert.equal(r.hint, "hint-2");
  const empty = await provider.evaluate(evalInput({ hintLevel: 0, task: { ...evalInput().task, hints: [] } }));
  assert.equal(empty.status, "retry");
  assert.ok(empty.hint.length > 0);
});

test("evaluate: free タスクの不合格は needs_more", async () => {
  const r = await provider.evaluate(
    evalInput({ deterministicResult: null, task: { ...evalInput().task, kind: "free" } }),
  );
  assert.equal(r.status, "needs_more");
  assert.equal(r.hint, "hint-0");
});

test("evaluate: recommendedNextDifficulty は 1..5 に収まる", async () => {
  const hi = await provider.evaluate(
    evalInput({ deterministicResult: true, task: { ...evalInput().task, difficulty: 5 } }),
  );
  assert.equal(hi.recommendedNextDifficulty, 5);
  const lo = await provider.evaluate(evalInput({ hintLevel: 2, task: { ...evalInput().task, difficulty: 1 } }));
  assert.equal(lo.recommendedNextDifficulty, 1);
});

function interpretInput(over: Partial<DomainInterpretInput["stats"]> = {}): DomainInterpretInput {
  return {
    mode: "read",
    learnerRef: "user-1",
    stats: {
      score: 70,
      subskills: { comprehension: 80, inference: 55 },
      confidence: "medium",
      evidenceCount: 5,
      successRate: 0.8,
      avgHints: 0.4,
      avgDifficulty: 3,
      ...over,
    },
    recentEvents: [],
  };
}

test("interpretDomain: evidence 0 は「まだ学習記録がありません」", async () => {
  const r = await provider.interpretDomain(interpretInput({ evidenceCount: 0, score: 0, subskills: {} }));
  assert.ok(r.summary.includes("まだ学習記録がありません"));
  assert.deepEqual(r.observations, []);
  assert.ok(r.recommendedNext.length > 0);
});

test("interpretDomain: confidence low は「暫定」を含む", async () => {
  const r = await provider.interpretDomain(interpretInput({ confidence: "low", evidenceCount: 2 }));
  assert.ok(r.summary.includes("暫定"));
});

test("interpretDomain: 強み・弱み・未計測を要約に含める", async () => {
  const r = await provider.interpretDomain(interpretInput());
  assert.ok(r.summary.includes("要旨把握"));
  assert.ok(r.summary.includes("推論"));
  assert.ok(r.summary.includes("未計測"));
  assert.ok(r.summary.includes("批判的読解"));
  assert.ok(r.recommendedNext.includes("批判的読解"));
});

test("interpretDomain: 観察は行動ベース（ヒント依存・成功率）", async () => {
  const r = await provider.interpretDomain(interpretInput({ avgHints: 2.0, successRate: 0.3 }));
  assert.ok(r.observations.some((o) => o.includes("ヒント")));
  assert.ok(r.observations.some((o) => o.includes("失敗")));
});

function leaderInput(domains: Partial<LeaderInput["domains"][number]>[] = []): LeaderInput {
  const base = (d: "READ" | "WRITE" | "CODE") => ({
    domain: d,
    score: 0,
    subskills: {},
    confidence: "low" as const,
    evidenceCount: 0,
    summary: "",
    observations: [],
    recommendedNext: "",
    eventsLast7Days: 0,
  });
  const ds = (["READ", "WRITE", "CODE"] as const).map((d) => ({
    ...base(d),
    ...domains.find((x) => x.domain === d),
  }));
  return { learnerRef: "user-1", domains: ds, totalEvents: ds.reduce((a, d) => a + d.evidenceCount, 0) };
}

test("leader: measured 0 でも recommendedDomain を返す", async () => {
  const r = await provider.leader(leaderInput());
  assert.ok(["READ", "WRITE", "CODE"].includes(r.recommendedDomain));
  assert.ok(r.summary.includes("まだ学習記録がありません"));
  assert.ok(r.recommendation.length > 0);
});

test("leader: 強みと伸ばす domain を要約し、未計測 domain を推奨する", async () => {
  const r = await provider.leader(
    leaderInput([
      { domain: "CODE", score: 86, evidenceCount: 8, confidence: "high", eventsLast7Days: 5 },
      { domain: "READ", score: 78, evidenceCount: 6, confidence: "medium", eventsLast7Days: 2 },
    ]),
  );
  // ユーザー向け文言では内部キー CODE ではなく表示名 LOGIC を使う
  assert.ok(r.summary.includes("LOGIC"));
  assert.ok(!r.summary.includes("CODE"));
  assert.ok(r.summary.includes("86"));
  assert.ok(r.summary.includes("WRITE"));
  assert.equal(r.recommendedDomain, "WRITE");
  assert.ok(r.recommendation.startsWith("WRITE"));
  assert.ok(r.observations.some((o) => o.includes("LOGIC")));
});

test("leader: 全 domain 計測済みなら最弱 domain を推奨し、その recommendedNext を使う", async () => {
  const r = await provider.leader(
    leaderInput([
      { domain: "CODE", score: 86, evidenceCount: 8, confidence: "high", eventsLast7Days: 5, recommendedNext: "c" },
      { domain: "READ", score: 78, evidenceCount: 6, confidence: "medium", eventsLast7Days: 2, recommendedNext: "r" },
      { domain: "WRITE", score: 61, evidenceCount: 4, confidence: "medium", eventsLast7Days: 1, recommendedNext: "w" },
    ]),
  );
  assert.equal(r.recommendedDomain, "WRITE");
  assert.equal(r.recommendation, "WRITE: w");
  assert.ok(!r.summary.includes("未計測"));
});
