// LINE から Web へ渡すリンク（urls.ts）と Flex の低レベル部品（flex.parts.ts）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardUrl, learnUrl } from "../src/lib/line/urls";
import { bar, text } from "../src/lib/line/flex.parts";

test("learnUrl: 末尾スラッシュの有無にかかわらず同じ URL になる", () => {
  const expected = "https://trivium.example.com/learn/read";
  assert.equal(learnUrl("https://trivium.example.com", "READ"), expected);
  assert.equal(learnUrl("https://trivium.example.com/", "READ"), expected);
});

test("learnUrl: taskId を渡すとその問題を開くクエリが付く（エンコードされる）", () => {
  const url = learnUrl("https://trivium.example.com", "CODE", "task a/1");
  assert.equal(url, "https://trivium.example.com/learn/logic?task=task%20a%2F1");
});

test("dashboardUrl: 末尾スラッシュを重ねない", () => {
  assert.equal(dashboardUrl("https://trivium.example.com/"), "https://trivium.example.com/dashboard");
});

test("bar: 比率は 0..1 に丸め、0 でも 1% は描く（LINE の描画エラー回避）", () => {
  const inner = (ratio: number) => (bar(ratio, "#000000").contents[0] as { width?: string }).width;
  assert.equal(inner(0), "1%");
  assert.equal(inner(0.5), "50%");
  assert.equal(inner(2), "100%");
  assert.equal(inner(-1), "1%");
});

test("text: 空文字は空白 1 つに置き換える（LINE は空テキストを拒否する）", () => {
  assert.equal(text("").text, " ");
  assert.equal(text("ok").text, "ok");
});
