// 推薦（決定論）のテスト。LLM を呼ばず、config の候補から選ぶ
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECOMMENDATIONS } from "../src/config/trivium.config";
import { hashKey, pickRecommendation, recommendationLine, weakestAxis } from "../src/lib/recommend";

test("config: 3 系統すべてに候補があり、title は一意", () => {
  for (const axis of ["read", "write", "logic"] as const) {
    assert.ok(RECOMMENDATIONS.some((r) => r.axis === axis), `${axis} の候補が無い`);
  }
  const titles = RECOMMENDATIONS.map((r) => r.title);
  assert.equal(new Set(titles).size, titles.length);
  for (const r of RECOMMENDATIONS) assert.ok(r.url.startsWith("https://"), `${r.title} の URL が https ではない`);
});

test("pickRecommendation: 同じ日は同じ 1 件、別の日は回る（候補が 2 件以上なら）", () => {
  const a = pickRecommendation("read", [], "2026-08-28");
  const b = pickRecommendation("read", [], "2026-08-28");
  assert.ok(a && b);
  assert.equal(a.title, b.title);
  const days = ["2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"];
  const picked = new Set(days.map((d) => pickRecommendation("read", [], d)!.title));
  assert.ok(picked.size >= 2, "日付を変えても 1 件しか出ない");
});

test("pickRecommendation: seen にある候補は避け、全部 seen なら候補全体から選ぶ", () => {
  const pool = RECOMMENDATIONS.filter((r) => r.axis === "logic");
  const seen = pool.slice(0, pool.length - 1).map((r) => r.title);
  const r = pickRecommendation("logic", seen, "2026-08-28");
  assert.ok(r);
  assert.equal(r.title, pool[pool.length - 1].title);
  const all = pickRecommendation("logic", pool.map((x) => x.title), "2026-08-28");
  assert.ok(all && pool.some((x) => x.title === all.title));
});

test("pickRecommendation: 候補は必ずその系統のもの", () => {
  for (const axis of ["read", "write", "logic"] as const) {
    const r = pickRecommendation(axis, [], "2026-08-28");
    assert.ok(r);
    assert.equal(r.axis, axis);
  }
});

test("weakestAxis: 未計測が最優先、次にスコア最小", () => {
  assert.equal(
    weakestAxis([
      { domain: "READ", score: 72, evidenceCount: 8 },
      { domain: "WRITE", score: 57, evidenceCount: 5 },
      { domain: "CODE", score: 79, evidenceCount: 10 },
    ]),
    "write",
  );
  assert.equal(
    weakestAxis([
      { domain: "READ", score: 72, evidenceCount: 8 },
      { domain: "WRITE", score: 57, evidenceCount: 5 },
      { domain: "CODE", score: 0, evidenceCount: 0 },
    ]),
    "logic",
  );
  assert.equal(weakestAxis([]), "read");
});

test("hashKey は決定論で非負", () => {
  assert.equal(hashKey("a"), hashKey("a"));
  assert.ok(hashKey("read|2026-08-28") >= 0);
});

test("recommendationLine: 有料は明記される", () => {
  const line = recommendationLine({ axis: "read", title: "T", author: "A", note: "N", url: "https://x", kind: "site", paid: true });
  assert.match(line, /（有料）/);
  assert.match(line, /T/);
});
