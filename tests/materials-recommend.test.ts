// 教材推薦（純粋関数）のテスト。ダミーのカタログで、弱い系統の優先・レベル帯・重複回避・条件の効きを確認する
import { test } from "node:test";
import assert from "node:assert/strict";
import { domainWeakness, matchMaterialId, recommendMaterials, summarizeLearner, tokenize } from "../src/lib/materials/recommend";
import type { LearnerProfileForMaterials, Material } from "../src/lib/materials/types";

const CATALOG: Material[] = [
  { id: "read-easy", title: "読解の入門書", kind: "book", author: "A", domains: ["READ"], subskills: ["comprehension", "inference"], levelMin: 1, levelMax: 3, summary: "短い文章の要旨をつかむ練習", why: "読解をこれから始める人向け", free: false, tags: ["読解", "入門"] },
  { id: "read-hard", title: "批判的読解の技法", kind: "book", author: "B", domains: ["READ"], subskills: ["critical_reading"], levelMin: 6, levelMax: 9, summary: "前提と反例を見抜く", why: "論説文を疑って読みたい人向け", free: false, tags: ["読解", "論説"] },
  { id: "write-mid", title: "文章の書き方サイト", kind: "web", url: "https://example.com/write", domains: ["WRITE"], subskills: ["structure", "clarity"], levelMin: 3, levelMax: 6, summary: "構成と明確さ", why: "段落の組み立てに迷う人向け", free: true, tags: ["作文", "構成"] },
  { id: "code-python", title: "Python チュートリアル", kind: "web", url: "https://docs.python.org/ja/3/tutorial/", domains: ["CODE"], subskills: ["tracing"], levelMin: 2, levelMax: 6, summary: "公式の入門", why: "Python の基本を一通り追いたい人向け", free: true, tags: ["Python", "プログラミング"] },
  { id: "code-puzzle", title: "論理パズル集", kind: "practice", domains: ["CODE"], subskills: ["algorithms", "design"], levelMin: 4, levelMax: 8, summary: "条件から一意に決める", why: "パズルで推論を鍛えたい人向け", free: false, tags: ["論理パズル", "推理"] },
];

function profile(over: Partial<LearnerProfileForMaterials> = {}): LearnerProfileForMaterials {
  return {
    levels: { READ: 5, WRITE: 2, CODE: 7 },
    evidence: { READ: 10, WRITE: 4, CODE: 12 },
    weakestSubskill: { READ: "inference", WRITE: "structure", CODE: "algorithms" },
    strugglingDomain: null,
    seenMaterialIds: [],
    ...over,
  };
}

test("弱い系統（レベルが低い・未計測）の教材が先に来る", () => {
  const top = recommendMaterials(profile(), {}, CATALOG);
  assert.equal(top[0].material.id, "write-mid", "WRITE Lv2 が最も弱い");
  // 未計測の系統は最優先
  const fresh = recommendMaterials(profile({ evidence: { READ: 10, WRITE: 4, CODE: 0 }, levels: { READ: 5, WRITE: 2, CODE: 0 } }), {}, CATALOG);
  assert.equal(fresh[0].material.domains[0], "CODE");
  assert.ok(domainWeakness(profile(), "WRITE") > domainWeakness(profile(), "CODE"));
});

test("レベル帯: 学習者レベル+1 が帯に入る教材が優先され、帯から外れるほど下がる", () => {
  const p = profile({ levels: { READ: 1, WRITE: 9, CODE: 9 }, evidence: { READ: 5, WRITE: 20, CODE: 20 } });
  const r = recommendMaterials(p, { domain: "READ" }, CATALOG);
  assert.equal(r[0].material.id, "read-easy");
  assert.ok(r[0].signals.levelFit > r[1].signals.levelFit);
  const p2 = profile({ levels: { READ: 7, WRITE: 9, CODE: 9 }, evidence: { READ: 5, WRITE: 20, CODE: 20 }, weakestSubskill: { READ: "critical_reading", WRITE: null, CODE: null } });
  assert.equal(recommendMaterials(p2, { domain: "READ" }, CATALOG)[0].material.id, "read-hard");
});

test("既に勧めた教材は下がる（novelty 0.3）", () => {
  const first = recommendMaterials(profile(), { limit: 1 }, CATALOG)[0].material.id;
  const next = recommendMaterials(profile({ seenMaterialIds: [first] }), { limit: 1 }, CATALOG)[0];
  assert.notEqual(next.material.id, first);
  assert.equal(recommendMaterials(profile({ seenMaterialIds: [first] }), { limit: 5 }, CATALOG).find((r) => r.material.id === first)?.signals.novelty, 0.3);
});

test("query: domain 指定・無料だけ・形式・自由語が効く", () => {
  const code = recommendMaterials(profile(), { domain: "CODE" }, CATALOG);
  assert.ok(code.slice(0, 2).every((r) => r.material.domains.includes("CODE")));
  const free = recommendMaterials(profile(), { freeOnly: true, limit: 10 }, CATALOG);
  assert.ok(free.every((r) => r.material.free));
  const books = recommendMaterials(profile(), { kind: "book", limit: 10 }, CATALOG);
  assert.ok(books.every((r) => r.material.kind === "book"));
  const py = recommendMaterials(profile(), { text: "Python の入門を教えて" }, CATALOG);
  assert.equal(py[0].material.id, "code-python");
  assert.ok(py[0].signals.textFit > 1);
});

test("理由は系統・レベル・小分類から決定論で組み立つ", () => {
  const r = recommendMaterials(profile(), { domain: "WRITE", limit: 1 }, CATALOG)[0];
  assert.match(r.reason, /WRITE/);
  assert.match(r.reason, /構成/);
  assert.match(r.reason, /レベル 3〜6/);
  assert.match(summarizeLearner(profile()), /WRITE: Lv2/);
});

test("tokenize / matchMaterialId", () => {
  assert.ok(tokenize("Python の入門書を教えて").includes("python"));
  assert.ok(!tokenize("おすすめの本").includes("おすすめ"));
  assert.equal(matchMaterialId("id: code-python\nPython の公式", "", CATALOG), "code-python");
  assert.equal(matchMaterialId("この本は 論理パズル集 がよい", "materials.md", CATALOG), "code-puzzle");
  assert.equal(matchMaterialId("無関係", "x", CATALOG), null);
});
