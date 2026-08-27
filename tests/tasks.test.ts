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
    assert.ok(Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= 10, `${t.id}: difficulty`);
    for (const [axis, difficulty] of Object.entries(t.axes ?? {})) {
      assert.ok(
        Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 10,
        `${t.id}: axes.${axis}`,
      );
    }
    assert.ok(t.hints.length >= 1 && t.hints.length <= 3, `${t.id}: hints は 1〜3 個`);
    assert.ok(t.explanation.length > 0, `${t.id}: explanation`);
    assert.ok(t.prompt.length > 0, `${t.id}: prompt`);
    assert.ok(
      t.id.startsWith("mix-") || t.id.toLowerCase().startsWith(t.domain.toLowerCase()),
      `${t.id}: id の接頭辞と domain`,
    );
  }
});

test("choice タスク: 4択で正解 index が1つ", () => {
  for (const t of ALL_TASKS.filter((t) => t.kind === "choice")) {
    assert.equal(t.choices?.length, 4, `${t.id}: choices`);
    assert.equal(t.answerKey?.length, 1, `${t.id}: answerKey`);
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

test("各 domain に低難度 1〜3 と高難度 8〜10 の問題が存在する", () => {
  for (const d of DOMAINS) {
    const ds = tasksFor(d).map((t) => t.difficulty);
    assert.ok(ds.some((difficulty) => difficulty >= 1 && difficulty <= 3), `${d}: difficulty 1〜3 が無い`);
    assert.ok(ds.some((difficulty) => difficulty >= 8 && difficulty <= 10), `${d}: difficulty 8〜10 が無い`);
  }
});

test("複合4類型が各3問以上ある", () => {
  const counts = new Map<string, number>();
  for (const t of ALL_TASKS.filter((task) => task.id.startsWith("mix-"))) {
    const axes = [
      ["read", t.axes?.read ?? 0],
      ["write", t.axes?.write ?? 0],
      ["logic", t.axes?.code ?? 0],
    ] as const;
    const key = axes
      .filter(([, difficulty]) => difficulty > 0)
      .map(([axis]) => axis)
      .join("+");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const type of ["read+write", "read+logic", "write+logic", "read+write+logic"]) {
    assert.ok((counts.get(type) ?? 0) >= 3, `${type}: ${counts.get(type) ?? 0} 問`);
  }
});

test("複合タスク: axes が2系統以上正で domain が最大系統", () => {
  const domainOfAxis = { read: "READ", write: "WRITE", code: "CODE" } as const;
  for (const t of ALL_TASKS.filter((task) => task.id.startsWith("mix-"))) {
    assert.ok(t.axes, `${t.id}: axes`);
    const axes = (["read", "write", "code"] as const).map((axis) => [axis, t.axes?.[axis] ?? 0] as const);
    const positive = axes.filter(([, difficulty]) => difficulty > 0);
    assert.ok(positive.length >= 2, `${t.id}: 正の axes が ${positive.length} 系統`);
    const max = Math.max(...positive.map(([, difficulty]) => difficulty));
    const primaryAxis = axes.find(([, difficulty]) => difficulty === max)?.[0];
    assert.ok(primaryAxis, `${t.id}: 主系統が決まらない`);
    assert.equal(t.domain, domainOfAxis[primaryAxis!], `${t.id}: domain`);
    assert.equal(t.difficulty, max, `${t.id}: difficulty は主系統の axes と一致`);
  }
});

test("複合タスク: 形式ごとのコンテンツ条件を満たす", () => {
  const mixed = ALL_TASKS.filter((task) => task.id.startsWith("mix-"));
  assert.equal(mixed.length, 12);
  assert.deepEqual(
    mixed.map((t) => t.id),
    Array.from({ length: 12 }, (_, i) => `mix-${String(i + 1).padStart(3, "0")}`),
  );
  for (const t of mixed) {
    assert.match(t.hints[0], /[？?]\s*$/, `${t.id}: 第1ヒントが問い返しでない`);
    if (t.kind === "free") {
      assert.ok(t.rubric, `${t.id}: rubric`);
      const rubric = t.rubric;
      assert.ok(
        rubric.mustInclude && rubric.mustInclude.length >= 8 && rubric.mustInclude.length <= 12,
        `${t.id}: mustInclude は8〜12語`,
      );
      assert.ok(
        rubric.criteria.length >= 2 && rubric.criteria.length <= 3,
        `${t.id}: criteria は2〜3項目`,
      );
      assert.ok(rubric.minLength && rubric.maxLength, `${t.id}: minLength / maxLength`);
    }
    if (t.kind === "short") {
      assert.ok((t.answerKey?.length ?? 0) >= 2, `${t.id}: short の表記ゆれ`);
    }
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
    const displayed = [t.title, t.passage ?? "", t.prompt, ...(t.choices ?? []), ...t.hints, t.explanation];
    for (const text of displayed) assert.ok(!text.includes("`"), `${t.id}: 表示文にバッククォート`);
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

test("LOGIC(CODE): Python を読めなくても解ける論理問題が 8 問以上ある", () => {
  // passage に Python らしい記号（def / print( / for / =）が無い問題を「非 Python」とみなす
  const isPython = (t: (typeof ALL_TASKS)[number]) => /def |print\(|for |=/.test(t.passage ?? "");
  const logic = tasksFor("CODE").filter((t) => !isPython(t));
  assert.ok(logic.length >= 8, `非 Python の LOGIC 問題が ${logic.length} 問しかない`);
  // 4 つの subskill を非 Python 問題だけでも 2 問以上ずつカバーする
  for (const skill of SUBSKILLS.CODE) {
    const n = logic.filter((t) => t.skillTags.includes(skill)).length;
    assert.ok(n >= 2, `非 Python の LOGIC 問題で subskill ${skill} が ${n} 問しかない`);
  }
  // LINE の Quick Reply で答えられるよう choice が 6 問以上
  assert.ok(logic.filter((t) => t.kind === "choice").length >= 6);
});

test("LOGIC(CODE): 並び順パズル code-016 の答えは全順列の中で唯一", () => {
  // 条件: A は先頭ではない / B は C より前 / C は最後尾ではない
  const perms: string[][] = [];
  const gen = (rest: string[], acc: string[]) => {
    if (rest.length === 0) return perms.push(acc);
    rest.forEach((x, i) => gen([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]));
  };
  gen(["A", "B", "C"], []);
  const ok = perms.filter((p) => p[0] !== "A" && p.indexOf("B") < p.indexOf("C") && p[2] !== "C");
  assert.equal(ok.length, 1);
  const t = getTask("code-016")!;
  assert.equal(t.choices![Number(t.answerKey![0])], ok[0].join(", "));
});

test("LOGIC(CODE): 追加した choice / short の正誤が checkDeterministic で判定できる", () => {
  const cases: [string, string, boolean][] = [
    ["code-017", "1", true], ["code-017", "0", false],
    ["code-018", "0", true], ["code-018", "1", false],
    ["code-019", "1", true], ["code-019", "2", false],
    ["code-020", "7", true], ["code-020", "７回", true], ["code-020", "6", false],
    ["code-021", "2", true], ["code-021", "3", false],
    ["code-022", "2", true], ["code-022", "3", false],
    ["code-023", "1", true], ["code-023", "2", false],
    ["code-025", "1", true], ["code-025", "3", false],
    ["code-026", "2", true], ["code-026", "0", false],
    ["code-027", "6", true], ["code-027", "６回", true], ["code-027", "8", false],
  ];
  for (const [id, answer, expected] of cases) {
    assert.equal(checkDeterministic(getTask(id)!, answer), expected, `${id} answer=${answer}`);
  }
});

// ---- 生成ストック（scripts/stock/gen_stock.mts → src/lib/tasks/stock/*.generated.ts）の品質ゲート ----
// 上の全タスク共通テスト（id 一意・4 択・difficulty 1〜10・skillTags・hints 3 段・バッククォート禁止）はストックにも効く。
// ここではストック固有の規約（id 形式と難易度の整合・選択肢の重複・文字列の \n）だけを見る。ストックが空でも通る。

const STOCK_ID = /^(read|write|code)-s(\d+)-(\d+)$/;

test("ストック: id は <domain>-s<難易度>-<連番> 形式で、難易度が id と一致する", () => {
  for (const t of ALL_TASKS.filter((x) => STOCK_ID.test(x.id))) {
    const m = t.id.match(STOCK_ID)!;
    assert.equal(m[1].toUpperCase(), t.domain, `${t.id}: domain`);
    assert.equal(Number(m[2]), t.difficulty, `${t.id}: difficulty が id と一致しない`);
  }
});

test("ストック: 選択肢が重複せず、表示文に文字列としての \\n を含まない", () => {
  for (const t of ALL_TASKS.filter((x) => STOCK_ID.test(x.id))) {
    const texts = [t.title, t.passage ?? "", t.prompt, ...(t.choices ?? []), ...t.hints, t.explanation];
    for (const text of texts) assert.ok(!text.includes("\\n"), `${t.id}: 文字列としての \\n`);
    if (t.kind === "choice") {
      const norm = t.choices!.map((c) => c.replace(/\s+/g, ""));
      assert.equal(new Set(norm).size, 4, `${t.id}: 選択肢が重複`);
    }
  }
});

test("pickNextTask: tieBreak で同じ難易度距離の並びを変えられる（省略時は定義順）", () => {
  const pool = tasksFor("CODE").filter((t) => t.difficulty === 5);
  if (pool.length < 2) return; // 同難易度が 2 問未満なら検証対象なし
  const desc = (a: Task, b: Task) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  assert.equal(pickNextTask("CODE", 5, []).id, pool[0].id);
  assert.equal(pickNextTask("CODE", 5, [], undefined, desc).id, [...pool].sort(desc)[0].id);
});
