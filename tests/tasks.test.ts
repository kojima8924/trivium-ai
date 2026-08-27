// tasks/ の整合性と採点・選択ロジックのテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TASKS,
  getTask,
  tasksFor,
  pickNextTask,
  checkDeterministic,
  checkHeuristic,
  toPublic,
  type Task,
} from "../src/lib/tasks";
import { DOMAINS, SUBSKILLS } from "../src/lib/domain";

test("全タスク: id が一意", () => {
  const ids = ALL_TASKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("全タスク: domain・skillTags・difficulty・hints の整合性", () => {
  for (const t of ALL_TASKS) {
    assert.ok((DOMAINS as readonly string[]).includes(t.domain), `${t.id}: domain`);
    assert.ok(t.skillTags.length >= 1, `${t.id}: skillTags 空`);
    for (const tag of t.skillTags) {
      assert.ok(SUBSKILLS[t.domain].includes(tag), `${t.id}: tag ${tag} は ${t.domain} の subskill でない`);
    }
    assert.ok(Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= 5, `${t.id}: difficulty`);
    assert.ok(t.hints.length >= 1 && t.hints.length <= 3, `${t.id}: hints は 1〜3 個`);
    assert.ok(t.explanation.length > 0, `${t.id}: explanation`);
    assert.ok(t.prompt.length > 0, `${t.id}: prompt`);
    assert.ok(t.id.toLowerCase().startsWith(t.domain.toLowerCase()), `${t.id}: id の接頭辞と domain`);
  }
});

test("choice タスク: answerKey が choices の範囲内の index", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "choice")) {
    assert.ok(t.choices && t.choices.length >= 2, `${t.id}: choices`);
    assert.ok(t.answerKey && t.answerKey.length >= 1, `${t.id}: answerKey`);
    for (const k of t.answerKey!) {
      const idx = Number(k);
      assert.ok(Number.isInteger(idx) && idx >= 0 && idx < t.choices!.length, `${t.id}: answerKey ${k}`);
    }
  }
});

test("short タスク: answerKey が非空", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "short")) {
    assert.ok(t.answerKey && t.answerKey.length >= 1 && t.answerKey.every((k) => k.trim().length > 0), t.id);
  }
});

test("free タスク: rubric があり criteria が非空", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "free")) {
    assert.ok(t.rubric, `${t.id}: rubric`);
    assert.ok(t.rubric!.criteria.length >= 1, `${t.id}: criteria`);
    if (t.rubric!.minLength && t.rubric!.maxLength) {
      assert.ok(t.rubric!.minLength < t.rubric!.maxLength, `${t.id}: min < max`);
    }
  }
});

test("各 domain に最低 3 タスク", () => {
  for (const d of DOMAINS) assert.ok(tasksFor(d).length >= 3, d);
});

test("getTask / tasksFor", () => {
  assert.equal(getTask("code-001")?.domain, "CODE");
  assert.equal(getTask("nope"), undefined);
  assert.ok(tasksFor("READ").every((t) => t.domain === "READ"));
});

test("checkDeterministic: short の正規化（空白・カンマ・大文字小文字・引用符）", () => {
  const t = getTask("code-001")!; // answerKey: ["[4, 1, 5]", "[4,1,5]"]
  assert.equal(checkDeterministic(t, "[4, 1, 5]"), true);
  assert.equal(checkDeterministic(t, "[4,1,5]"), true);
  assert.equal(checkDeterministic(t, "  [4 ,1,  5]  "), true);
  assert.equal(checkDeterministic(t, "[4、1、5]"), true);
  assert.equal(checkDeterministic(t, "[4, 1, 6]"), false);

  const s = getTask("code-008")!; // "mui"
  assert.equal(checkDeterministic(s, "MUI"), true);
  assert.equal(checkDeterministic(s, "'mui'"), true);
  assert.equal(checkDeterministic(s, '"mui"'), true);
  assert.equal(checkDeterministic(s, " mui \n"), true);
  assert.equal(checkDeterministic(s, "ium"), false);
});

test("checkDeterministic: choice は index 文字列の完全一致（trim あり）", () => {
  const t = getTask("read-001")!; // answerKey ["1"]
  assert.equal(checkDeterministic(t, "1"), true);
  assert.equal(checkDeterministic(t, " 1 "), true);
  assert.equal(checkDeterministic(t, "0"), false);
  assert.equal(checkDeterministic(t, ""), false);
});

test("checkDeterministic: free は null", () => {
  const t = getTask("write-001")!;
  assert.equal(checkDeterministic(t, "何か書いた"), null);
});

test("checkHeuristic: minLength / maxLength / mustInclude", () => {
  const t = getTask("write-003")!; // min 15, max 70, mustInclude 学習/記録/次
  const ok = checkHeuristic(t, "このアプリは学習記録をもとに、次にやるべきことを示します。");
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.reasons, []);

  const short = checkHeuristic(t, "学習記録。次。");
  assert.equal(short.pass, false);
  assert.ok(short.reasons.some((r) => r.includes("短すぎ")));

  const long = checkHeuristic(t, "学習の記録を見て次にやることが分かる。".repeat(6));
  assert.equal(long.pass, false);
  assert.ok(long.reasons.some((r) => r.includes("長すぎ")));

  const missing = checkHeuristic(t, "このアプリはユーザーに何かを示すための便利な道具です。");
  assert.equal(missing.pass, false);
  assert.ok(missing.reasons.some((r) => r.includes("評価観点")));
});

test("checkHeuristic: rubric 無しは非空なら pass", () => {
  const t: Task = { ...getTask("write-001")!, rubric: undefined };
  assert.equal(checkHeuristic(t, "x").pass, true);
  assert.equal(checkHeuristic(t, "   ").pass, false);
});

test("pickNextTask: 未回答を優先し、目標難易度に近いものを選ぶ", () => {
  const t = pickNextTask("CODE", 4, []);
  assert.equal(t.domain, "CODE");
  assert.equal(Math.abs(t.difficulty - 4), 0);
  const easy = pickNextTask("CODE", 1, []);
  assert.equal(easy.difficulty, Math.min(...tasksFor("CODE").map((x) => x.difficulty)));
});

test("pickNextTask: 全て回答済みなら失敗したものを優先", () => {
  const pool = tasksFor("CODE");
  const history = pool.map((t, i) => ({
    taskId: t.id,
    success: t.id !== "code-005",
    createdAt: new Date(2026, 0, 1 + i),
  }));
  assert.equal(pickNextTask("CODE", 3, history).id, "code-005");
});

test("pickNextTask: 同じタスクの複数履歴は最新が使われる（失敗→成功なら成功扱い）", () => {
  const pool = tasksFor("CODE");
  const history = pool.map((t, i) => ({ taskId: t.id, success: true, createdAt: new Date(2026, 0, 10 + i) }));
  // code-005 は昔失敗、後で成功 → 失敗扱いにならない
  history.push({ taskId: "code-005", success: false, createdAt: new Date(2026, 0, 1) });
  const picked = pickNextTask("CODE", 3, history);
  assert.notEqual(picked.id, "code-005");
});

test("pickNextTask: 全て成功済みなら最も古いものを返す", () => {
  const pool = tasksFor("READ");
  const history = pool.map((t, i) => ({ taskId: t.id, success: true, createdAt: new Date(2026, 0, 1 + i) }));
  assert.equal(pickNextTask("READ", 3, history).id, pool[0].id);
});

test("pickNextTask: preferredTaskId は同 domain のときだけ尊重", () => {
  assert.equal(pickNextTask("CODE", 3, [], "code-006").id, "code-006");
  assert.notEqual(pickNextTask("CODE", 3, [], "read-001").id, "read-001");
  assert.equal(pickNextTask("CODE", 3, [], "nope").domain, "CODE");
});

test("toPublic: answerKey / hints / explanation / rubric を落とす", () => {
  const t = getTask("code-007")!;
  const p = toPublic(t) as Record<string, unknown>;
  for (const k of ["answerKey", "hints", "explanation", "rubric"]) assert.ok(!(k in p), k);
  assert.equal(p.id, t.id);
  assert.equal(p.prompt, t.prompt);
  assert.equal(p.passage, t.passage);
});

// ---- コンテンツ拡充後の網羅性チェック ----

test("各 domain に 10 問以上（実用に耐える量）", () => {
  for (const d of DOMAINS) {
    assert.ok(tasksFor(d).length >= 10, `${d}: ${tasksFor(d).length} 問`);
  }
});

test("全 subskill が 2 問以上でカバーされている", () => {
  for (const d of DOMAINS) {
    for (const skill of SUBSKILLS[d]) {
      const n = tasksFor(d).filter((t) => t.skillTags.includes(skill)).length;
      assert.ok(n >= 2, `${d}/${skill}: ${n} 問しかない`);
    }
  }
});

test("各 domain に difficulty 1 と 5 が存在する（幅がある）", () => {
  for (const d of DOMAINS) {
    const ds = new Set(tasksFor(d).map((t) => t.difficulty));
    assert.ok(ds.has(1), `${d}: difficulty 1 が無い`);
    assert.ok(ds.has(5), `${d}: difficulty 5 が無い`);
  }
});

test("全タスク: hints はちょうど 3 段（一段ずつ出すため）", () => {
  for (const t of ALL_TASKS) {
    assert.equal(t.hints.length, 3, `${t.id}: hints ${t.hints.length} 個`);
    for (const h of t.hints) assert.ok(h.trim().length > 0, `${t.id}: 空のヒント`);
  }
});

test("全タスク: 表示文にバッククォートを使わない（UI で生表示されるため）", () => {
  for (const t of ALL_TASKS) {
    assert.ok(!t.explanation.includes("`"), `${t.id}: explanation にバッククォート`);
    assert.ok(!t.prompt.includes("`"), `${t.id}: prompt にバッククォート`);
    for (const h of t.hints) assert.ok(!h.includes("`"), `${t.id}: hint にバッククォート`);
  }
});

test("free タスク: rubric に mustInclude と字数の目安がある", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "free")) {
    assert.ok(t.rubric?.mustInclude && t.rubric.mustInclude.length >= 1, `${t.id}: mustInclude`);
    assert.ok(t.rubric?.minLength && t.rubric.minLength > 0, `${t.id}: minLength`);
  }
});

test("kind は3種すべてが使われている（採点経路の網羅）", () => {
  for (const kind of ["choice", "short", "free"] as const) {
    assert.ok(ALL_TASKS.some((t) => t.kind === kind), `${kind} のタスクが無い`);
  }
});

test("追加した short タスクの正解が checkDeterministic を通る（表記ゆれ込み）", () => {
  const cases: [string, string[]][] = [
    ["read-005", ["700", "700杯", " 700 "]],
    ["code-009", ["3", " 3 "]],
    ["code-010", ["['a', 'b']", "[a,b]", "[a, b]", '["a", "b"]']],
    ["code-011", ["9"]],
    ["code-013", ["4 fox", "4  fox", "4 FOX"]],
  ];
  for (const [id, answers] of cases) {
    const t = getTask(id)!;
    assert.ok(t, `${id} が見つからない`);
    for (const a of answers) assert.equal(checkDeterministic(t, a), true, `${id}: ${a}`);
  }
  assert.equal(checkDeterministic(getTask("code-009")!, "3.5"), false);
  assert.equal(checkDeterministic(getTask("code-013")!, "4 the"), false);
});

// ---- 全角入力・ヒントの完成解漏れ（レビュー指摘の回帰防止） ----

/** ASCII 印字可能文字を全角に、半角スペースを全角スペースに変換する（日本語IMEでそのまま打った状態を再現） */
function toFullWidth(s: string): string {
  return [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === " ") return "　";
      if (c >= 0x21 && c <= 0x7e) return String.fromCharCode(c + 0xfee0);
      return ch;
    })
    .join("");
}

test("short タスク: 正解候補を全角で入力しても正解になる（IME 対策）", () => {
  const shorts = ALL_TASKS.filter((t) => t.kind === "short");
  assert.ok(shorts.length > 0);
  for (const t of shorts) {
    for (const key of t.answerKey ?? []) {
      assert.equal(checkDeterministic(t, key), true, `${t.id}: 半角 ${key}`);
      assert.equal(checkDeterministic(t, toFullWidth(key)), true, `${t.id}: 全角 ${toFullWidth(key)}`);
    }
  }
});

test("short タスク: Unicode のマイナス記号（− ‐ –）も '-' として扱う", () => {
  const t = getTask("code-006")!; // 答えは -1
  for (const minus of ["−", "‐", "–", "－"]) {
    assert.equal(checkDeterministic(t, `${minus}1`), true, `U+${minus.charCodeAt(0).toString(16)}`);
  }
  assert.equal(checkDeterministic(t, "1"), false);
});

test("デモの正解入力 ３.０ / ３．０（全角）が code-003 で正解になる", () => {
  const t = getTask("code-003")!;
  assert.equal(checkDeterministic(t, "３.０"), true);
  assert.equal(checkDeterministic(t, "３．０"), true);
  assert.equal(checkDeterministic(t, "３。０"), true); // MS-IME 日本語モードの "." は「。」
  assert.equal(checkDeterministic(t, "　3.0　"), true);
});

test("short タスク: answerKey に重複が無い（正規化後も一意）", () => {
  for (const t of ALL_TASKS.filter((x) => x.kind === "short")) {
    const keys = t.answerKey ?? [];
    assert.equal(new Set(keys).size, keys.length, `${t.id}: answerKey が重複`);
  }
});

test("free タスク: ヒントをそのまま提出しても rubric を満たさない（完成解を渡していない）", () => {
  // 完成解をヒントに書くと「字数が範囲内」かつ「mustInclude 語を複数含む」平叙文になりやすい。
  // その組み合わせを機械的に検出する。
  //  - 1 語だけの一致は「観点を示す」正当なヒントでも起きるので 2 語以上を条件にする
  //    （例: write-002 の「確かに〜。しかし〜」は 3 語一致するが minLength 90 に届かないので提出しても通らない＝OK）
  //  - 疑問文（「〜ませんか？」）はそのまま答えとして提出できないので対象外にする
  //    （例: write-003 hints[1] は要素名を 2 つ挙げるが「削れませんか？」と問い返している）
  for (const t of ALL_TASKS.filter((x) => x.kind === "free")) {
    const r = t.rubric!;
    for (const [i, h] of t.hints.entries()) {
      const len = [...h].length;
      const inRange = (!r.minLength || len >= r.minLength) && (!r.maxLength || len <= r.maxLength);
      const hits = (r.mustInclude ?? []).filter((w) => h.includes(w));
      const isQuestion = /[？?]\s*$/.test(h);
      assert.ok(
        !(inRange && hits.length >= 2 && !isQuestion),
        `${t.id} hints[${i}] は提出可能な完成解になっている可能性（${len}字, mustInclude 一致: ${hits.join("/")}）`,
      );
    }
  }
});

test("short タスク: ヒント本文に正解の値そのものが含まれない（DEMO 依存の code-003 / code-006 は例外として明示）", () => {
  // 3 段目のヒントでも最終値は書かない、が原則。
  // code-003 / code-006 は台本が依存しているため文言を凍結しており、値を含む可能性を検査対象から外す。
  const frozen = new Set(["code-003", "code-006"]);
  for (const t of ALL_TASKS.filter((x) => x.kind === "short" && !frozen.has(x.id))) {
    for (const key of t.answerKey ?? []) {
      // 1 文字・2 文字の短い数値（"3"、"9"）は文中に偶然現れるので、3 文字以上の正解だけを見る
      if ([...key].length < 3) continue;
      for (const [i, h] of t.hints.entries()) {
        assert.ok(!h.includes(key), `${t.id} hints[${i}] に正解 "${key}" が含まれている`);
      }
    }
  }
});
