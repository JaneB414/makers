// 실행: node --test variant-maker/tests/core.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const VM = require("../src/core.js");
const TEMPLATE = require("../src/hwpx-template.js");

const PASSAGE = fs.readFileSync(path.join(__dirname, "sample-passage.txt"), "utf8");
const SENTS = VM.splitSentences(PASSAGE);

test("문장 나누기: 약어와 이니셜에서는 나누지 않는다", () => {
  assert.strictEqual(SENTS.length, 9);
  assert.deepStrictEqual(VM.splitSentences("Dr. Kim met J. K. Rowling. They talked. \"Why?\" she asked."), [
    "Dr. Kim met J. K. Rowling.", "They talked.", "\"Why?\" she asked."
  ]);
  assert.deepStrictEqual(VM.splitSentences("One two.\nThree four five\nSix.", true), ["One two.", "Three four five", "Six."]);
});

test("순서: 정답 순서대로 이으면 원문이 되고, (A)-(B)-(C)는 선지에 없다", () => {
  const ps = VM.makeOrder(SENTS, 5, VM.makeRng(1));
  const answers = new Set();
  for (const p of ps) {
    assert.strictEqual(p.choices.length, 5);
    assert.ok(!p.choices.includes("(A) - (B) - (C)"));
    const idx = VM.CIRCLED.indexOf(p.answer);
    answers.add(idx);
    const parts = {};
    p.passage.split("\n").forEach((line) => { parts[line.slice(0, 3)] = line.slice(4); });
    const rebuilt = [p.box].concat(p.choices[idx].split(" - ").map((l) => parts[l])).join(" ");
    assert.strictEqual(rebuilt, SENTS.join(" "));
  }
  assert.strictEqual(answers.size, 5, "정답 번호가 골고루 나와야 한다");
});

test("문장삽입: 정답 자리에 주어진 문장을 넣으면 원문이 된다", () => {
  for (const p of VM.makeInsert(SENTS, 4, VM.makeRng(2))) {
    const marks = p.passage.match(/\( [①②③④⑤] \)/g);
    assert.strictEqual(marks.length, 5);
    const restored = p.passage.replace("( " + p.answer + " )", p.box).replace(/ ?\( [①②③④⑤] \)/g, "");
    assert.strictEqual(restored, SENTS.join(" "));
  }
});

test("문장삽입: 문장이 적으면 자리 수를 줄인다", () => {
  const short = SENTS.slice(0, 4);
  const [p] = VM.makeInsert(short, 1, VM.makeRng(3));
  assert.strictEqual(p.passage.match(/\( [①②③④⑤] \)/g).length, 3);
  assert.throws(() => VM.makeInsert(SENTS.slice(0, 3), 1, VM.makeRng(3)));
});

test("문장배열: <보기> 단어가 정답의 단어와 같고 순서는 다르다", () => {
  for (const p of VM.makeArrange(SENTS, 5, VM.makeRng(4))) {
    const given = p.box.replace("<보기>", "").trim().split(" / ");
    const answerWords = p.answer.split(" ").map((w) => w.replace(/[.,;:!?"']/g, ""));
    assert.deepStrictEqual([...given].sort(), [...answerWords].sort());
    assert.notStrictEqual(given.join(" "), answerWords.join(" "));
    assert.ok(p.passage.includes("(A) ________________"));
  }
});

test("AI 답변 읽기: 코드 블록, 숫자 정답, 빠진 type을 처리한다", () => {
  const text = "여기 있습니다.\n```json\n{\"problems\":[{\"passage\":\"x\",\"choices\":[\"a\",\"b\",\"c\",\"d\",\"e\"],\"answer\":\"4\"}]}\n```";
  const { problems, warnings } = VM.parseAiProblems(text, "topic");
  assert.strictEqual(problems[0].type, "topic");
  assert.strictEqual(problems[0].answer, "④");
  assert.strictEqual(problems[0].instruction, VM.TYPE_BY_KEY.topic.instruction);
  assert.deepStrictEqual(warnings, []);
  assert.throws(() => VM.parseAiProblems("JSON이 아님"));
});

test("AI 요청문에 지문과 유형이 들어간다", () => {
  const prompt = VM.buildCombinedPrompt(PASSAGE, [{ type: "grammar", count: 2 }, { type: "title", count: 1 }]);
  assert.ok(prompt.includes("어법 (2문제"));
  assert.ok(prompt.includes("제목 (1문제"));
  assert.ok(prompt.includes(SENTS[0]));
  assert.throws(() => VM.buildPrompt(PASSAGE, "order", 1));
});

test("서식 태그를 글자 조각으로 나눈다", () => {
  assert.deepStrictEqual(VM.parseRuns("a <u>b <b>c</b></u> <i>d</i>"), [
    { text: "a ", u: false, b: false },
    { text: "b ", u: true, b: false },
    { text: "c", u: true, b: true },
    { text: " <i>d</i>", u: false, b: false }
  ]);
});

test("HWPX: mimetype이 맨 앞·무압축이고 본문에 문제가 들어간다", () => {
  const problems = VM.makeOrder(SENTS, 1, VM.makeRng(5)).concat([
    { type: "grammar", instruction: "어법 & <테스트>", passage: "He <u>①go</u> home.", choices: null, answer: "①", boxFirst: true }
  ]);
  const bytes = Buffer.from(VM.buildHwpx(TEMPLATE, { title: "시험", problems, options: { answers: true, explanations: true, columns: 2 } }));
  assert.strictEqual(bytes.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(bytes.readUInt16LE(8), 0, "무압축");
  assert.strictEqual(bytes.toString("latin1", 30, 38), "mimetype");
  assert.strictEqual(bytes.toString("latin1", 38, 57), "application/hwp+zip");
  const text = bytes.toString("utf8");
  assert.ok(text.includes("어법 &amp; &lt;테스트&gt;"));
  assert.ok(text.includes('charPrIDRef="8"><hp:t>①go</hp:t>'), "밑줄 글자 모양");
  assert.ok(text.includes('colCount="2"'));
  assert.ok(text.includes('pageBreak="1"'), "정답지는 새 쪽에서 시작");
});

test("zip의 CRC32 값이 표준과 같다", () => {
  assert.strictEqual(VM.crc32(Buffer.from("123456789")), 0xCBF43926);
});
