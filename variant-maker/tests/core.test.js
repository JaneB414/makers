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

test("정답 뽑개: 여러 지문에 걸쳐 정답 번호가 골고루 나온다", () => {
  const rng = VM.makeRng(9), deck = VM.answerDeck(rng);
  for (const maker of [VM.makeOrder, VM.makeInsert]) {
    const d = VM.answerDeck(rng);
    const answers = [];
    for (let k = 0; k < 5; k++) answers.push(...maker(SENTS, 2, rng, d).map((p) => p.answer));
    const counts = VM.CIRCLED.map((c) => answers.filter((a) => a === c).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, maker.name + " " + counts);
  }
  assert.ok(deck() >= 0);
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
  const prompt = VM.buildCombinedPrompt([{ no: "29", text: PASSAGE }, { no: "30", text: "Short text." }], [{ type: "grammar", count: 2 }, { type: "title", count: 1 }]);
  assert.ok(prompt.includes("어법 (지문마다 2문제"));
  assert.ok(prompt.includes("제목 (지문마다 1문제"));
  assert.ok(prompt.includes("### 지문 [29]\n" + SENTS[0]));
  assert.ok(prompt.includes("### 지문 [30]"));
  assert.throws(() => VM.buildPrompt(PASSAGE, "order", 1));
});

test("문제 정렬: 유형 순서대로 묶고, 같은 유형 안에서는 지문 순서대로", () => {
  const mk = (type, no) => ({ type, source: no ? { exam: "E", no } : null });
  const rank = { "29": 0, "30": 1 };
  const sorted = VM.sortProblems([mk("order", "30"), mk("title", "30"), mk("compose", "29"), mk("order", "29"), mk("title", "29"), mk("claim", null)], (s) => rank[s.no]);
  assert.deepStrictEqual(sorted.map((p) => p.type + (p.source ? p.source.no : "")), ["claim", "title29", "title30", "order29", "order30", "compose29"]);
  assert.deepStrictEqual(VM.TYPES.map((t) => t.name), ["주장", "요지", "주제", "제목", "함축적 의미", "어법", "어휘", "빈칸", "순서", "문장삽입", "요약", "어법 오류 고치기", "서술형 문장배열", "한글 문장 영작"]);
});

test("회차: 유형 안에서 지문들이 1회차, 2회차 순서로 번갈아 나온다", () => {
  const mk = (type, no, tag) => ({ type, tag, source: { exam: "3강", no } });
  const rank = { A: 0, P1: 1, P2: 2 };
  const made = [mk("claim", "A", "a1"), mk("claim", "A", "a2"), mk("claim", "P1", "p1"), mk("claim", "P1", "p1b"), mk("claim", "P2", "q1"), mk("claim", "P2", "q2"), mk("title", "A", "t1"), mk("title", "A", "t2")];
  const inType = VM.sortProblems(made, (s) => rank[s.no]);
  assert.deepStrictEqual(inType.map((p) => p.tag), ["a1", "p1", "q1", "a2", "p1b", "q2", "t1", "t2"]);
  assert.deepStrictEqual(inType.map((p) => p.round), [0, 0, 0, 1, 1, 1, 0, 1]);
  const again = VM.sortProblems(inType, (s) => rank[s.no]);
  assert.deepStrictEqual(again.map((p) => p.tag), inType.map((p) => p.tag), "다시 정렬해도 그대로");
  const byRound = VM.sortProblems(inType, (s) => rank[s.no], true);
  assert.deepStrictEqual(byRound.map((p) => p.tag), ["a1", "p1", "q1", "t1", "a2", "p1b", "q2", "t2"]);
});

test("회차별로 나누기: 회차 제목, 새 쪽, 번호를 1부터 다시", () => {
  const mk = (round, type) => ({ type, round, instruction: "q", passage: "p", choices: null, answer: "①", source: null });
  const blocks = VM.buildBlocks({ title: "t", problems: [mk(0, "claim"), mk(0, "title"), mk(1, "claim"), mk(1, "title")], options: { rounds: true, answers: true } });
  const seq = blocks.filter((b) => ["roundTitle", "ask", "pagebreak"].includes(b.kind)).map((b) => b.kind === "ask" ? b.runs[0].text : b.kind === "roundTitle" ? b.runs[0].text : "|");
  assert.deepStrictEqual(seq, ["1회차", "1", "2", "|", "2회차", "1", "2", "|"]);
  const ans = blocks.filter((b) => b.kind === "ans").map((b) => b.runs[0].text);
  assert.deepStrictEqual(ans, ["[1회차]", "1)", "2)", "[2회차]", "1)", "2)"]);
});

test("정답지에는 정답과 해설만 나온다", () => {
  const blocks = VM.buildBlocks({ title: "t", problems: [{ type: "title", instruction: "q", passage: "p", choices: null, answer: "③", explanation: "해설", source: { exam: "E", no: "29" } }], options: { answers: true, explanations: true } });
  const ans = blocks.filter((b) => b.kind === "ans")[0].runs.map((r) => r.text).join("");
  assert.strictEqual(ans, "1) ③  해설");
});

test("서식 태그를 글자 조각으로 나눈다", () => {
  assert.deepStrictEqual(VM.parseRuns("a <u>b <b>c</b></u> <i>d</i>"), [
    { text: "a ", u: false, b: false },
    { text: "b ", u: true, b: false },
    { text: "c", u: true, b: true },
    { text: " <i>d</i>", u: false, b: false }
  ]);
});

const DOC = {
  title: "시험",
  layout: { eyebrow: "ENGLISH", showName: true, header: { left: "행복학원", right: "고2" }, footer: { left: "김선생", right: "" } },
  options: { answers: true, explanations: true, columns: 2 }
};

test("HWPX: mimetype이 맨 앞·무압축이고 본문·머리말·쪽 번호·2단이 들어간다", () => {
  const style = TEMPLATE.__style;
  const problems = VM.makeOrder(SENTS, 1, VM.makeRng(5)).concat([
    { type: "grammar", instruction: "어법 & <테스트>", passage: "He <u>①go</u> home.", choices: null, answer: "①", boxFirst: true, source: { exam: "26년 9월", no: "29" } }
  ]);
  const bytes = Buffer.from(VM.buildHwpx(TEMPLATE, Object.assign({}, DOC, { problems })));
  assert.strictEqual(bytes.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(bytes.readUInt16LE(8), 0, "무압축");
  assert.strictEqual(bytes.toString("latin1", 30, 38), "mimetype");
  assert.strictEqual(bytes.toString("latin1", 38, 57), "application/hwp+zip");
  const text = bytes.toString("utf8");
  assert.ok(text.includes("어법 &amp; &lt;테스트&gt;"));
  assert.ok(text.includes('charPrIDRef="' + style.char.bodyU + '"><hp:t>①go</hp:t>'), "밑줄 글자 모양");
  assert.ok(text.includes('<hp:t>29번</hp:t>'), "원문 번호");
  assert.ok(text.includes('colCount="2"') && text.includes("<hp:colLine"), "2단과 구분선");
  assert.ok(text.includes("<hp:header") && text.includes("<hp:t>행복학원</hp:t>"), "머리말");
  assert.ok(text.includes('numType="PAGE"'), "쪽 번호");
  assert.ok(text.includes('face="Times New Roman"'), "영어 글꼴");
  assert.ok(text.includes('pageBreak="1"'), "정답지는 새 쪽에서 시작");
});

test("원문 번호: 시험이 섞이면 시험 이름을 붙인다", () => {
  const a = { source: { exam: "26년 9월", no: "29" } }, b = { source: { exam: "26년 6월", no: "41-42" } }, c = { source: null };
  assert.deepStrictEqual(VM.sourceLabels([a, a]), ["29번", "29번"]);
  assert.deepStrictEqual(VM.sourceLabels([a, b, c]), ["26년 9월 · 29번", "26년 6월 · 41-42번", ""]);
});

test("지문 번호: 숫자는 '번'을 붙이고, 교재식 번호는 그대로 둔다", () => {
  assert.strictEqual(VM.normalizeNo(" 41 ~ 42번 "), "41-42");
  assert.strictEqual(VM.normalizeNo("3강  1번"), "3강 1번");
  assert.strictEqual(VM.noLabel("29"), "29번");
  assert.strictEqual(VM.noLabel("3강 1번"), "3강 1번");
  assert.deepStrictEqual(VM.sourceLabels([{ source: { exam: "수능특강", no: "3강 1번" } }]), ["3강 1번"]);
});

test("지문 한꺼번에 등록: [번호] 또는 N번 줄로 나눈다", () => {
  const list = VM.parseBulkPassages("[18]\nDear Ms. Carter,\nThanks.\n\n19번\nThe sun rose.\n[41 ~ 42]\nLong text.\n[3강 1번]\nLesson text.\n");
  assert.deepStrictEqual(list, [
    { no: "18", text: "Dear Ms. Carter,\nThanks." },
    { no: "19", text: "The sun rose." },
    { no: "41-42", text: "Long text." },
    { no: "3강 1번", text: "Lesson text." }
  ]);
});

test("AI 답변 여러 개를 이어 붙여도 읽고, src로 원문 번호를 단다", () => {
  const one = '{"problems":[{"src":"29","type":"title","passage":"x","choices":["a","b","c","d","e"],"answer":"2"}]}';
  const two = '```json\n{"problems":[{"src":"30","type":"gist","passage":"y {braces}","choices":["a","b","c","d","e"],"answer":"③"}]}\n```';
  const { problems } = VM.parseAiProblems(one + "\n\n" + two, { exam: "26년 9월" });
  assert.deepStrictEqual(problems.map((p) => [p.type, p.answer, p.source.no, p.source.exam]), [["title", "②", "29", "26년 9월"], ["gist", "③", "30", "26년 9월"]]);
});

test("zip의 CRC32 값이 표준과 같다", () => {
  assert.strictEqual(VM.crc32(Buffer.from("123456789")), 0xCBF43926);
});

test("DOCX: 필요한 부분이 들어 있고 상자·밑줄·2단·머리말·쪽 번호가 표시된다", () => {
  const problems = VM.makeInsert(SENTS, 1, VM.makeRng(6)).concat([
    { type: "grammar", instruction: "어법 & <테스트>", passage: "He <u>①go</u> home.", choices: null, answer: "①", boxFirst: true }
  ]);
  const text = Buffer.from(VM.buildDocx(Object.assign({}, DOC, { problems }))).toString("utf8");
  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes('w:instr="PAGE"'), "쪽 번호");
  assert.ok(text.includes('w:ascii="Times New Roman"'), "영어 글꼴");
  assert.ok(text.includes("어법 &amp; &lt;테스트&gt;"));
  assert.ok(text.includes('<w:u w:val="single"/></w:rPr><w:t xml:space="preserve">①go</w:t>'));
  assert.ok(text.includes('w:fill="EEF2F8"'), "상자");
  assert.ok(text.includes('<w:cols w:num="2" w:space="567" w:sep="1"/>'));
  assert.ok(text.includes("<w:pageBreakBefore/>"));
});
