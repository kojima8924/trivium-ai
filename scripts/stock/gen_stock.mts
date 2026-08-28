// 問題ストック生成・検証スクリプト v2（問題タイプ付き・難易度 1〜10 を「誰でも解ける〜非常に難しい」に再設計・複合問題）
//
//   npx tsx scripts/stock/gen_stock.mts                       # READ / WRITE / CODE / MIX すべて
//   npx tsx scripts/stock/gen_stock.mts --domain code,mix     # 一部だけ
//   npx tsx scripts/stock/gen_stock.mts --emit-only           # 生成せず out/*.json から .generated.ts を書き出す
//
// 生成: 既定はサブスクの Codex CLI（`codex exec --output-schema`。API 課金なし）。`STOCK_BACKEND=openai` で OpenAI Responses API。
//       問題タイプは src/lib/task-types.ts のキーと一致させる。
// 検証（合格したものだけ採用）:
//   - 構造: 4 択・重複なし・answer_index 0..3・hints 3 段・explanation あり・バッククォート無し
//   - python / debug: ローカルの python で実際に実行（python は正解の選択肢と照合。別の選択肢が一致すれば index を修正）
//   - それ以外の 4 択: 正解を伏せた独立ソルバー（gpt-5.5）が同じ答えに到達し、曖昧さ・ヒントの答えバレが無いこと
//   - 記述（free）: 模範解答の長さが目安内、ヒントが完成解になっていない、レビュー担当（gpt-5.4-mini）が 5 段階で 4 以上
//   - 難易度: LOGIC はソルバー評価との差が大きいものを弾く。READ / WRITE / MIX は「明らかに難しすぎ」だけ弾く
// 進捗は scripts/stock/out/<DOMAIN>.json にチェックポイントし、再実行時は済んだスロットを飛ばす。
// 実装は同じディレクトリの config / plan / prompts / codex / verify / emit に分かれていて、
// このファイルは「作問 → 検証 → 保存」のループと CLI の引数処理だけを持つ。
import { CONCURRENCY, GEN_MODEL, MAX_ATTEMPTS, type Domain, type Slot } from "./config.mjs";
import { PLAN, STRUCTURES, allowedTags, difficultyGuide, slotId, slotKey, themeFor } from "./plan.mjs";
import { GEN_ROLE, fmt, genSchema, type Gen } from "./prompts.mjs";
import { parse } from "./codex.mjs";
import { verify } from "./verify.mjs";
import { emit, loadCheckpoint, saveCheckpoint, toTask } from "./emit.mjs";

// ---- 生成 ----
async function generate(s: Slot, attempt: number, recentTitles: string[]): Promise<Gen> {
  const domainLabel = s.domain === "MIX" ? `複合（主系統 ${s.spec.primary === "CODE" ? "LOGIC" : s.spec.primary}、関与: ${s.spec.axes.map((a) => (a === "CODE" ? "LOGIC" : a)).join("+")}）` : s.domain === "CODE" ? "LOGIC" : s.domain;
  const user = [
    fmt("domain", domainLabel),
    fmt("task_type", `${s.spec.key} — ${s.spec.label}`),
    fmt("kind", s.spec.kind),
    fmt("difficulty", difficultyGuide(s.domain, s.spec.key, s.difficulty)),
    fmt("theme_hint", `${themeFor(s, attempt)}（題材の参考。無理に使わなくてよい）`),
    ...(s.domain === "READ" || s.spec.key === "read_code" || s.spec.key === "read_write" ? [fmt("structure_hint", `本文の論理構造: ${STRUCTURES[(s.n + attempt) % STRUCTURES.length]}`)] : []),
    fmt("allowed_skill_tags", allowedTags(s)),
    fmt("recent_titles", recentTitles.slice(-40)),
  ].join("\n\n");
  // 作問は質優先で high（速度より質。検証で落ちた分を作り直すコストの方が大きい）
  void ["python", "debug", "puzzle", "math", "algorithm", "read_code"];
  return parse(GEN_MODEL, GEN_ROLE, user, genSchema, "generated_task", "high", s.difficulty >= 8 ? 16000 : 10000);
}

// ---- メイン ----
async function runDomain(domain: Domain): Promise<void> {
  const cp = loadCheckpoint(domain);
  const slots: Slot[] = [];
  for (let d = 1; d <= 10; d++) {
    let n = 0;
    for (const spec of PLAN[domain]) for (let i = 0; i < spec.count; i++) slots.push({ domain, spec, difficulty: d, n: n++ });
  }
  const todo = slots.filter((s) => !cp[slotKey(s)]);
  console.log(`[${domain}] slots=${slots.length} done=${slots.length - todo.length} todo=${todo.length}`);
  const titles = () => Object.values(cp).map((t) => t.title);
  let cursor = 0;
  const rejected: string[] = [];
  const worker = async () => {
    while (cursor < todo.length) {
      const s = todo[cursor++];
      let accepted = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt++) {
        try {
          const g = await generate(s, attempt, titles());
          const v = await verify(s, g);
          if (!v.ok) {
            console.log(`  [reject] ${slotKey(s)} try${attempt + 1}: ${v.reason}`);
            continue;
          }
          const seq = Object.values(cp).filter((t) => t.difficulty === s.difficulty).length + 1;
          cp[slotKey(s)] = { ...toTask(s, v.gen, slotId(s, seq)), rating: v.rating };
          saveCheckpoint(domain, cp);
          accepted = true;
          console.log(`  [ok] ${slotKey(s)} -> ${cp[slotKey(s)].id} 「${v.gen.title}」${v.rating ? ` (rated ${v.rating})` : ""}`);
        } catch (err) {
          console.log(`  [error] ${slotKey(s)} try${attempt + 1}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
      if (!accepted) rejected.push(slotKey(s));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const n = emit(domain, cp);
  console.log(`[${domain}] emitted ${n} tasks. unfilled slots: ${rejected.length}${rejected.length ? " -> " + rejected.join(", ") : ""}`);
}

/**
 * --recheck: 既存のチェックポイントを現在の検証基準で再判定し、落ちたものを外す（その後の通常実行で作り直す）。
 * 対象は --types で絞れる（既定: math,puzzle,algorithm,read_code）。生成はしないので Codex/API の消費は検証分だけ。
 */
async function recheckDomain(domain: Domain, types: string[]): Promise<void> {
  const cp = loadCheckpoint(domain);
  const keys = Object.keys(cp).filter((k) => types.includes(k.split(":")[1]));
  console.log(`[${domain}] recheck ${keys.length} tasks (${types.join(",")})`);
  let cursor = 0;
  const dropped: string[] = [];
  const worker = async () => {
    while (cursor < keys.length) {
      const k = keys[cursor++];
      const t = cp[k];
      const [, key, dStr, nStr] = k.split(":");
      const spec = PLAN[domain].find((x) => x.key === key);
      if (!spec) continue;
      const slot: Slot = { domain, spec, difficulty: Number(dStr), n: Number(nStr) };
      const gen: Gen = {
        title: t.title,
        passage: t.passage ?? "",
        prompt: t.prompt,
        choices: t.choices ?? [],
        answer_index: Number(t.answerKey?.[0] ?? 0),
        rubric_criteria: t.rubric?.criteria ?? [],
        must_include: t.rubric?.mustInclude ?? [],
        model_answer: t.rubric?.sampleAnswer ?? "",
        hints: t.hints,
        explanation: t.explanation,
        skill_tags: t.skillTags,
      };
      try {
        const v = await verify(slot, gen);
        if (!v.ok) {
          console.log(`  [drop] ${k} (${t.id}): ${v.reason}`);
          dropped.push(k);
        }
      } catch (err) {
        console.log(`  [error] ${k}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const k of dropped) delete cp[k];
  saveCheckpoint(domain, cp);
  console.log(`[${domain}] recheck done: dropped ${dropped.length}`);
}

const args = process.argv.slice(2);
const domainArg = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "read,write,code,mix";
const domains = domainArg.split(",").map((d) => d.trim().toUpperCase()) as Domain[];
if (args.includes("--recheck")) {
  const types = (args.includes("--types") ? args[args.indexOf("--types") + 1] : "math,puzzle,algorithm,read_code").split(",");
  for (const d of domains) await recheckDomain(d, types);
} else if (args.includes("--emit-only")) {
  for (const d of domains) console.log(`[${d}] emitted ${emit(d, loadCheckpoint(d))} tasks`);
} else {
  for (const d of domains) await runDomain(d);
}
