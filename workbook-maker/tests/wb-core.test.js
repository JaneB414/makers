// 실행: node --test workbook-maker/tests/wb-core.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const VM = require("../../variant-maker/src/core.js");
const WB = require("../src/wb-core.js");
const TEMPLATE = require("../../variant-maker/src/hwpx-template.js");

const PASSAGE = fs.readFileSync(path.join(__dirname, "../../variant-maker/tests/sample-passage.txt"), "utf8");
const SENTS = VM.splitSentences(PASSAGE);
const plain = (s) => s.replace(/<\/?b>/g, "");

test("빈칸 채우기: 빈칸 낱말을 순서대로 되돌리면 원문이 된다", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = WB.makeBlank(SENTS, VM.makeRng(seed), {});
    assert.ok(d.answers.length >= 5);
    let k = 0;
    const restored = plain(d.sentences.join(" ")).replace(/\(\d+\) [a-z]_{10}/g, () => d.answers[k++]);
    assert.strictEqual(restored, SENTS.join(" "));
  }
});

test("빈칸 채우기: 분석 어휘의 지문 속 형태를 먼저 빈칸으로 만든다", () => {
  const word = SENTS[1].match(/\b[a-z]{6,}\b/)[0];
  const d = WB.makeBlank(SENTS, VM.makeRng(3), { vocab: [{ word: word, form: word, meaning: "뜻" }] });
  assert.strictEqual(d.answers.indexOf(word) >= 0, true);
});

test("문장 순서 배열: 정답 순서대로 이으면 원문이고, 원래 순서 그대로 나오지 않는다", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = WB.makeOrder(SENTS, VM.makeRng(seed));
    const byLabel = {};
    d.chunks.forEach((c) => { byLabel[c.label] = c.text; });
    assert.strictEqual([d.given].concat(d.answer.split(" - ").map((l) => byLabel[l])).join(" "), SENTS.join(" "));
    assert.notStrictEqual(d.answer, d.chunks.map((c) => c.label).join(" - "));
    assert.ok(d.chunks.length <= 8);
  }
  assert.throws(() => WB.makeOrder(SENTS.slice(0, 3), VM.makeRng(1)));
});

test("단어 배열: 덩어리를 모으면 원래 문장의 낱말과 같다", () => {
  const d = WB.makeScramble(SENTS, VM.makeRng(5), {});
  d.items.forEach((it) => {
    const words = (s) => s.replace(/[.!?]+["')\]]*$/, "").toLowerCase().split(/\s+/).sort().join(" ");
    assert.strictEqual(words(it.chunks.replace(/ \/ /g, " ")), words(it.answer));
    assert.ok(it.chunks.split(" / ").length <= 10);
  });
});

test("어법 선택: 정답을 넣으면 원문이 되고, 찾지 못한 항목은 빼고 번호를 매긴다", () => {
  const word = SENTS[0].split(" ")[2];
  const d = WB.makeChoice(SENTS, [
    { s: 1, answer: word, wrong: "XXX", point: "p" },
    { s: 2, answer: "없는낱말", wrong: "YYY" }
  ], VM.makeRng(2));
  assert.strictEqual(d.answers.length, 1);
  assert.match(d.text, /<b>\(1\) \[/);
  const restored = d.text.replace(/<b>\(\d+\) \[([^\]]+)\]<\/b>/g, () => d.answers[0].answer);
  assert.strictEqual(restored, SENTS.join(" "));
});

test("AI 답변 읽기: 해석 개수를 맞추고, 문장 번호가 틀린 어법 항목은 낱말이 있는 문장으로 옮긴다", () => {
  const w = SENTS[2].split(" ")[1];
  const reply = "답변입니다\n```json\n" + JSON.stringify({ passages: [{
    key: "1",
    translations: ["하나", "둘"],
    vocab: [{ word: "x", form: "없는형태", pos: "n.", meaning: "엑스" }, { word: "", meaning: "" }],
    grammar: [{ s: 1, answer: w, wrong: w + "s", point: "수일치" }, { s: 1, answer: "zzz", wrong: "q" }, { s: 2, answer: "a", wrong: "A" }]
  }] }) + "\n```";
  const res = WB.parseAnalysis(reply, { "1": SENTS });
  const r = res.results["1"];
  assert.strictEqual(r.translations.length, SENTS.length);
  assert.strictEqual(r.vocab.length, 1);
  assert.strictEqual(r.vocab[0].form, "");
  assert.strictEqual(r.grammar.length, 1);
  assert.ok(VM.splitSentences(SENTS[r.grammar[0].s - 1]).length);
  assert.ok(WB.findAll(SENTS[r.grammar[0].s - 1], w).length);
  assert.ok(res.warnings.length >= 2);
});

test("요청문: 고른 항목만 묻고 문장 번호를 붙인다", () => {
  const p = WB.buildAnalysisPrompt([{ key: "1", sentences: SENTS }], ["vocab"]);
  assert.match(p, /"vocab"/);
  assert.doesNotMatch(p, /"grammar":/);
  assert.match(p, new RegExp("^1\\. " + SENTS[0].slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m"));
  assert.deepStrictEqual(WB.missingNeeds({ vocab: [] }, ["vocab", "compose", "translate", "blank"]), ["translations"]);
});

test("워크북 문서: 활동별 구간에 모든 지문을 출처와 함께 싣고 HWPX·DOCX 파일을 만든다", () => {
  const analysis = {
    translations: SENTS.map((_, i) => "해석 " + (i + 1)),
    vocab: [{ word: "a", form: "", pos: "n.", meaning: "가" }, { word: "b", form: "", pos: "v.", meaning: "나" }],
    grammar: [{ s: 1, answer: SENTS[0].split(" ")[1], wrong: "zz" }],
    lexical: [{ s: 2, answer: SENTS[1].split(" ")[1], wrong: "yy" }]
  };
  const rng = VM.makeRng(9);
  const items = [];
  [{ exam: "올림포스2 독해의 기본", no: "11강 Practice 3" }, { exam: "올림포스2 독해의 기본", no: "12" }].forEach((src) => {
    WB.ACTIVITIES.forEach((a) => items.push({ id: src.no + a.key, type: a.key, source: src, data: WB.makeActivity(a.key, SENTS, analysis, rng) }));
  });
  assert.throws(() => WB.makeActivity("translate", SENTS, {}, rng), /AI 분석/);
  assert.throws(() => WB.makeActivity("blank", SENTS, {}, rng), /AI 분석/);
  const sorted = WB.sortItems(items.slice().reverse(), (s) => (s.no === "12" ? 1 : 0));
  assert.deepStrictEqual(sorted.slice(0, 2).map((i) => i.id), ["11강 Practice 3study", "12study"]);
  assert.deepStrictEqual([...new Set(sorted.map((i) => i.type))].slice(0, 6), ["study", "translate", "lexical", "blank", "grammar", "scramble"]);
  for (const columns of [1, 2]) {
    const doc = { title: "워크북", layout: {}, options: { columns, newPage: true }, items: sorted };
    const blocks = WB.buildBlocks(doc);
    assert.strictEqual(blocks.filter((b) => b.kind === "typeHead").length, WB.ACTIVITIES.length);
    const asks = blocks.filter((b) => b.kind === "ask").map((b) => b.runs.map((r) => r.text).join(""));
    assert.strictEqual(asks[0], "1올림포스2 독해의 기본 11강 Practice 3");
    assert.strictEqual(asks[1], "2올림포스2 독해의 기본 12번");
    assert.ok(blocks.some((b) => b.kind === "ansTitle"));
    const hwpx = VM.buildHwpx(TEMPLATE, doc, blocks);
    const docx = VM.buildDocx(doc, blocks);
    assert.ok(hwpx.length > 1000 && docx.length > 1000);
    assert.match(Buffer.from(hwpx).toString("utf8"), /colCnt="4"/); // 단어 정리 표
  }
});

test("빈칸 채우기: 문장마다 해석을 함께 준다", () => {
  const tr = SENTS.map((_, i) => "해석 " + i);
  const d = WB.makeActivity("blank", SENTS, { translations: tr }, VM.makeRng(4));
  assert.strictEqual(d.sentences.length, SENTS.length);
  assert.deepStrictEqual(d.translations, tr);
});
