// 教材カタログ（src/lib/materials/catalog.ts）の品質ゲート
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATERIALS, findMaterial } from "../src/lib/materials/catalog";
import { DOMAINS, SUBSKILLS } from "../src/lib/domain";

test("教材カタログ: id が一意で接頭辞が形式（kind）と一致する", () => {
  const ids = new Set<string>();
  for (const m of MATERIALS) {
    assert.ok(!ids.has(m.id), `${m.id}: 重複`);
    ids.add(m.id);
    assert.match(m.id, /^(book|web|video|course|practice)-[a-z0-9-]+$/, `${m.id}: id 形式`);
    assert.ok(m.id.startsWith(`${m.kind}-`), `${m.id}: 接頭辞が kind（${m.kind}）と違う`);
  }
  assert.ok(MATERIALS.length >= 60, `${MATERIALS.length} 件（60 件以上）`);
  assert.equal(findMaterial(MATERIALS[0].id)?.id, MATERIALS[0].id);
  assert.equal(findMaterial("nope"), undefined);
});

test("教材カタログ: level・domains・subskills・URL・本文の整合性", () => {
  for (const m of MATERIALS) {
    assert.ok(m.levelMin >= 1 && m.levelMax <= 10 && m.levelMin <= m.levelMax, `${m.id}: level ${m.levelMin}〜${m.levelMax}`);
    assert.ok(m.domains.length >= 1, `${m.id}: domains 空`);
    for (const d of m.domains) assert.ok((DOMAINS as readonly string[]).includes(d), `${m.id}: domain ${d}`);
    assert.ok(m.subskills.length >= 1, `${m.id}: subskills 空`);
    const allowed = m.domains.flatMap((d) => [...SUBSKILLS[d]]);
    for (const s of m.subskills) assert.ok(allowed.includes(s), `${m.id}: subskill ${s} は ${m.domains.join("/")} のキーでない`);
    if (m.url !== undefined) assert.match(m.url, /^https:\/\//, `${m.id}: URL は https`);
    if (m.kind !== "book") assert.ok(m.url, `${m.id}: 書籍以外は URL 必須`);
    assert.ok(m.title.trim().length >= 2 && m.summary.length >= 10 && m.why.length >= 5, `${m.id}: 本文が短い`);
    assert.ok(m.tags.length >= 1, `${m.id}: tags 空`);
    assert.ok(!/`/.test(m.title + m.summary + m.why), `${m.id}: バッククォート`);
  }
});

test("教材カタログ: 各系統に 15 件以上、無料と難易度帯が広く揃っている", () => {
  for (const d of DOMAINS) {
    const n = MATERIALS.filter((m) => m.domains.includes(d)).length;
    assert.ok(n >= 15, `${d}: ${n} 件`);
    // 入門（level 1〜3 を含む）と上級（8 以上を含む）の両方がある
    assert.ok(MATERIALS.some((m) => m.domains.includes(d) && m.levelMin <= 3), `${d}: 入門帯が無い`);
    assert.ok(MATERIALS.some((m) => m.domains.includes(d) && m.levelMax >= 8), `${d}: 上級帯が無い`);
    assert.ok(MATERIALS.some((m) => m.domains.includes(d) && m.free), `${d}: 無料教材が無い`);
  }
});
