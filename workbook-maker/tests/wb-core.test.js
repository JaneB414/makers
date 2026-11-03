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

test("단어 순서 배열: 한 단어씩 잘라 섞고, 모으면 원래 문장의 낱말과 같다", () => {
  const d = WB.makeScramble(SENTS, VM.makeRng(5), {});
  d.items.forEach((it) => {
    const words = (s) => s.replace(/[.!?]+["')\]]*$/, "").toLowerCase().split(/\s+/).sort().join(" ");
    assert.strictEqual(words(it.chunks.replace(/ \/ /g, " ")), words(it.answer));
    assert.strictEqual(it.chunks.split(" / ").length, it.answer.split(/\s+/).length);
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
    lexical: [{ s: 2, answer: SENTS[1].split(" ")[1], wrong: "yy" }],
    summary: { gist: "요지", topic: "topic", topicKo: "주제", title: "Title", titleKo: "제목", flow: [{ part: "도입", from: 1, to: 2 }] },
    syntax: { marks: SENTS.map(() => ({ subjects: [], verbs: [] })), points: [{ s: 1, phrase: SENTS[0].split(" ").slice(0, 2).join(" "), note: "설명" }] }
  };
  const rng = VM.makeRng(9);
  const items = [];
  [{ exam: "올림포스2 독해의 기본", no: "11강 Practice 3" }, { exam: "올림포스2 독해의 기본", no: "12" }].forEach((src) => {
    WB.ACTIVITIES.forEach((a) => items.push({ id: src.no + a.key, type: a.key, source: src, data: WB.makeActivity(a.key, SENTS, analysis, rng) }));
  });
  assert.throws(() => WB.makeActivity("translate", SENTS, {}, rng), /AI 자료/);
  assert.throws(() => WB.makeActivity("blank", SENTS, {}, rng), /AI 자료/);
  const sorted = WB.sortItems(items.slice().reverse(), (s) => (s.no === "12" ? 1 : 0));
  assert.deepStrictEqual(sorted.slice(0, 2).map((i) => i.id), ["11강 Practice 3study", "12study"]);
  assert.deepStrictEqual([...new Set(sorted.map((i) => i.type))], ["study", "syntax", "lexical", "blank", "grammar", "scramble", "order", "compose", "translate"]);
  for (const columns of [1, 2]) {
    const doc = { title: "워크북", layout: {}, options: { columns, newPage: true }, items: sorted };
    const blocks = WB.buildBlocks(doc);
    // 지문 정리는 지문마다 제목(2개), 나머지는 활동마다 구간 제목
    assert.strictEqual(blocks.filter((b) => b.kind === "typeHead").length, 2 + WB.ACTIVITIES.length - 1);
    assert.strictEqual(blocks.filter((b) => b.kind === "richTable").length, 4); // 본문|해석 2개 + 구문 분석 2개
    const asks = blocks.filter((b) => b.kind === "ask").map((b) => b.runs.map((r) => r.text).join(""));
    assert.strictEqual(asks[0], "1올림포스2 독해의 기본 11강 Practice 3");
    assert.strictEqual(asks[1], "2올림포스2 독해의 기본 12번");
    assert.ok(blocks.some((b) => b.kind === "ansTitle"));
    const hwpx = VM.buildHwpx(TEMPLATE, doc, blocks);
    const docx = VM.buildDocx(doc, blocks);
    assert.ok(hwpx.length > 1000 && docx.length > 1000);
    const xml = Buffer.from(hwpx).toString("utf8");
    assert.match(xml, /colCnt="8"/); // 단어 정리 표(두 칸)
    assert.ok(xml.includes('charPrIDRef="' + TEMPLATE.__style.char.hl + '"')); // 구문 분석 형광펜
  }
});

test("빈칸 채우기: 문장마다 해석을 함께 준다", () => {
  const tr = SENTS.map((_, i) => "해석 " + i);
  const d = WB.makeActivity("blank", SENTS, { translations: tr }, VM.makeRng(4));
  assert.strictEqual(d.sentences.length, SENTS.length);
  assert.deepStrictEqual(d.translations, tr);
});

test("구문 분석: 주어 밑줄·동사 굵게·핵심 구문 형광펜과 지문 안에서 이어지는 번호", () => {
  const sents = ["Many people believe that creativity is rare.", "The ocean covers most of our planet."];
  const d = WB.makeActivity("syntax", sents, { syntax: {
    marks: [{ subjects: ["Many people"], verbs: ["believe"] }, { subjects: ["The ocean"], verbs: ["covers"] }],
    points: [{ s: 1, phrase: "that creativity is rare", note: "that절 → believe의 목적어" }, { s: 2, phrase: "most of our planet", note: "most of + 명사" }]
  } }, VM.makeRng(1));
  const blocks = WB.activityBlocks({ type: "syntax", data: d }, 1);
  const rows = blocks[0].rows;
  const left = rows[0][0][0];
  assert.deepStrictEqual(left.filter((r) => r.u).map((r) => r.text), ["Many people"]);
  assert.deepStrictEqual(left.filter((r) => r.b).map((r) => r.text), ["believe"]);
  assert.deepStrictEqual(left.filter((r) => r.role === "hl").map((r) => r.text), ["that creativity is rare"]);
  assert.strictEqual(rows[1][1][0][0].text.trim(), "❷"); // 둘째 문장의 설명 번호는 ❷
  assert.strictEqual(left.map((r) => r.text).join(""), "① Many people believe that creativity is rare❶.");
});

test("AI 답변 읽기: 내용 정리와 구문 분석에서 지문에 없는 표시는 뺀다", () => {
  const reply = JSON.stringify({ passages: [{ key: "1",
    summary: { gist: "요지", topic: "t", topicKo: "주제", title: "T", titleKo: "제목", flow: [{ part: "도입", from: 1, to: 2 }, { part: "잘못", from: 99, to: 99 }] },
    syntax: { marks: [{ s: 1, subjects: [SENTS[0].split(" ")[0], "없는주어"], verbs: [] }], points: [{ s: 1, phrase: "없는 구문", note: "x" }, { s: 2, phrase: SENTS[1].split(" ").slice(0, 2).join(" "), note: "설명" }] }
  }] });
  const r = WB.parseAnalysis(reply, { "1": SENTS });
  const a = r.results["1"];
  assert.strictEqual(a.summary.flow.length, 1);
  assert.strictEqual(a.summary.flow[0].to, 2);
  assert.deepStrictEqual(a.syntax.marks[0].subjects, [SENTS[0].split(" ")[0]]);
  assert.strictEqual(a.syntax.marks.length, SENTS.length);
  assert.strictEqual(a.syntax.points.length, 1);
  assert.ok(r.warnings.some((w) => /구문 분석/.test(w)));
  assert.strictEqual(WB.flowText(a.summary.flow), "도입 ①~②");
});

test("AI 구절 찾기: 대소문자·끝 문장부호·따옴표·줄임표가 달라도 지문의 글자 그대로 찾는다", () => {
  const s = "The ocean covers most of our planet, and it's \"deep\" there.";
  assert.strictEqual(WB.locate(s, "the ocean"), "The ocean");
  assert.strictEqual(WB.locate(s, "most of our planet."), "most of our planet");
  assert.strictEqual(WB.locate(s, "it’s “deep”"), "it's \"deep\"");
  assert.strictEqual(WB.locate(s, "covers ... planet"), "covers most of our planet");
  assert.strictEqual(WB.locate(s, "cover"), ""); // 낱말 일부는 찾지 않는다
  assert.strictEqual(WB.locate(s, "moon"), "");
});

test("AI 답변 읽기: 비어 있는 항목은 받지 않은 것으로 두고, 빠진 항목을 알려 준다", () => {
  const reply = JSON.stringify({ passages: [{ key: "1",
    summary: { gist: "", title: "" }, translations: ["", ""], vocab: [],
    syntax: { marks: [], points: [] }, grammar: [{ s: 1, answer: "없는낱말", wrong: "x" }]
  }] });
  const r = WB.parseAnalysis(reply, { "1": SENTS }, ["summary", "translations", "vocab", "syntax", "grammar", "lexical"]);
  assert.deepStrictEqual(Object.keys(r.results["1"]), []);
  // 그래서 다시 만들 때 모두 다시 요청한다.
  assert.deepStrictEqual(WB.missingNeeds(r.results["1"], ["study", "syntax", "grammar", "lexical"]), ["translations", "vocab", "summary", "syntax", "grammar", "lexical"]);
  assert.ok(r.warnings.some((w) => /내용 정리·해석·단어·구문 분석·어법 양자택일·어휘 양자택일 자료가 비어 있거나 빠져서/.test(w)));
});

test("요청 묶음: 지문 하나의 자료를 세 번에 나눠 요청한다", () => {
  assert.deepStrictEqual(WB.needGroups(["lexical", "syntax", "summary", "translations", "vocab", "grammar"]),
    [["summary", "translations", "vocab"], ["syntax"], ["grammar", "lexical"]]);
  assert.deepStrictEqual(WB.needGroups(["syntax"]), [["syntax"]]);
});

test("예전 자료 정리: 빈 내용 정리·구문 분석·빈 목록은 지워 다시 요청하게 한다", () => {
  const a = { summary: { gist: "", title: "T" }, syntax: { marks: [], points: [] }, translations: ["", ""], vocab: [], grammar: [{ s: 1 }] };
  assert.strictEqual(WB.pruneAnalysis(a), 4);
  assert.deepStrictEqual(Object.keys(a), ["grammar"]);
});

test("내용 정리: 요청문의 형식 예시는 객체로 보여 주고, 목록·우리말 이름표로 온 답도 읽는다", () => {
  const prompt = WB.buildAnalysisPrompt([{ key: "1", sentences: SENTS }], ["summary", "syntax"]);
  const shape = JSON.parse(prompt.split("형식: ")[1]).passages[0];
  assert.ok(!Array.isArray(shape.summary) && "gist" in shape.summary && "title" in shape.summary);
  assert.ok(!Array.isArray(shape.syntax) && Array.isArray(shape.syntax.points));
  const asList = WB.parseAnalysis(JSON.stringify({ passages: [{ key: "1", summary: [{ gist: "요지", title: "T", flow: [] }] }] }), { "1": SENTS }, ["summary"]);
  assert.strictEqual(asList.results["1"].summary.title, "T");
  const korean = WB.parseAnalysis(JSON.stringify({ passages: [{ key: "1", summary: { "요지": "요지", "제목": "제목" } }] }), { "1": SENTS }, ["summary"]);
  assert.strictEqual(korean.results["1"].summary.gist, "요지");
  const synList = WB.parseAnalysis(JSON.stringify({ passages: [{ key: "1", syntax: [{ s: 1, phrase: SENTS[0].split(" ").slice(0, 2).join(" "), note: "n" }] }] }), { "1": SENTS }, ["syntax"]);
  assert.strictEqual(synList.results["1"].syntax.points.length, 1);
});

test("지문 정리: 내용 정리를 아직 못 받아도 본문·해석·단어 쪽은 만들고, 내용 정리는 다시 요청한다", () => {
  const a = { translations: SENTS.map(() => "해석"), vocab: [{ word: "w", pos: "n.", meaning: "뜻" }] };
  const d = WB.makeActivity("study", SENTS, a, VM.makeRng(1));
  const blocks = WB.buildBlocks({ title: "t", layout: {}, options: {}, items: [{ id: "x", type: "study", source: { exam: "A", no: "1" }, data: d }] });
  assert.ok(blocks.some((b) => b.kind === "richTable"));
  assert.ok(!blocks.some((b) => b.kind === "box"));
  assert.deepStrictEqual(WB.missingNeeds(a, ["study"]), ["summary"]);
  assert.deepStrictEqual(WB.missingNeeds(a, ["study"], true), []);
});
