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

test("정답 옮기기: 객관식은 선지를, 순서는 이름표를, 삽입은 자리 표시를 옮겨도 정답이 맞다", () => {
  const rng = VM.makeRng(11);
  const mc = { type: "title", choices: ["a", "b", "c", "d", "e"], answer: "②", explanation: "②가 정답, ④는 오답" };
  VM.moveAnswer(mc, 4);
  assert.deepStrictEqual([mc.choices, mc.answer, mc.explanation], [["a", "e", "c", "d", "b"], "⑤", "⑤가 정답, ④는 오답"]);
  for (let t = 0; t < 5; t++) {
    const [o] = VM.makeOrder(SENTS, 1, rng);
    VM.moveAnswer(o, t);
    assert.strictEqual(o.answer, VM.CIRCLED[t]);
    const parts = {};
    o.passage.split("\n").forEach((line) => { parts[line.slice(0, 3)] = line.slice(4); });
    assert.strictEqual([o.box].concat(o.choices[t].split(" - ").map((l) => parts[l])).join(" "), SENTS.join(" "));
  }
  const [ins] = VM.makeInsert(SENTS, 1, rng);
  VM.answerOptions(ins).forEach((t) => {
    VM.moveAnswer(ins, t);
    const restored = ins.passage.replace("( " + ins.answer + " )", ins.box).replace(/ ?\( [①②③④⑤] \)/g, "");
    assert.strictEqual(restored, SENTS.join(" "));
  });
  assert.deepStrictEqual(VM.answerOptions({ type: "grammar", choices: null, answer: "③" }), []);
});

test("정답 고르게: 앞뒤 문제와 겹치지 않고, 전체에서 ①~⑤가 고르게", () => {
  const types = ["claim", "gist", "topic", "title", "implied", "grammar", "vocab", "blank", "summary"];
  for (let seed = 0; seed < 50; seed++) {
    const rng = VM.makeRng(seed);
    const problems = [];
    types.forEach((type) => ["A", "B", "C", "D"].forEach((no) => {
      const fixed = type === "grammar" || type === "vocab";
      problems.push({ type, source: { exam: "E", no }, choices: fixed ? null : ["1", "2", "3", "4", "5"], answer: fixed ? VM.CIRCLED[rng.int(0, 4)] : "③", explanation: "" });
    }));
    VM.balanceAnswers(problems, null, rng);
    const counts = VM.answerCounts(problems);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "seed " + seed + ": " + counts);
    for (let i = 1; i < problems.length; i++) {
      const fixedPair = !problems[i].choices && !problems[i - 1].choices;
      if (!fixedPair) assert.notStrictEqual(problems[i].answer, problems[i - 1].answer, "seed " + seed + " #" + i);
    }
    problems.forEach((p) => { if (p.choices) assert.strictEqual(p.choices[VM.CIRCLED.indexOf(p.answer)], "3", "정답 선지 내용은 그대로"); });
  }
});

test("정답 고르게: 고정된 정답이 몰려 있어도 ①⑤①⑤나 네 칸 주기 같은 되풀이를 만들지 않는다", () => {
  let aba = 0, pairs = 0, p4 = 0;
  for (let seed = 0; seed < 50; seed++) {
    const rng = VM.makeRng(seed);
    const problems = [];
    for (let k = 0; k < 30; k++) problems.push({ type: "title", choices: ["1", "2", "3", "4", "5"], answer: "③" });
    for (let k = 0; k < 12; k++) problems.push({ type: "grammar", choices: null, answer: k % 2 ? "③" : "④" });
    VM.balanceAnswers(problems, null, rng);
    for (let i = 4; i < 30; i++) {
      pairs++;
      if (problems[i].answer === problems[i - 2].answer) aba++;
      if (problems[i].answer === problems[i - 4].answer) p4++;
    }
    const counts = VM.answerCounts(problems);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "seed " + seed + ": " + counts);
  }
  // 무작위로 고르면 각각 약 20%. 한 칸 걸러 되풀이는 훨씬 적고, 네 칸 주기 되풀이도 두드러지지 않아야 한다.
  assert.ok(aba / pairs < 0.1, "두 칸 앞과 같은 비율 " + (aba / pairs).toFixed(3));
  assert.ok(p4 / pairs < 0.35, "네 칸 앞과 같은 비율 " + (p4 / pairs).toFixed(3));
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
  assert.ok(VM.buildPrompt(PASSAGE, "grammar", 2, [1, 4]).includes("정답 번호는 문제 순서대로 ②, ⑤가 되게"));
  const planned = VM.buildCombinedPrompt([{ no: "1", text: "a" }, { no: "2", text: "b" }], [{ type: "vocab", count: 1 }], { vocab: { "1": [2], "2": [0] } });
  assert.ok(planned.includes("지문 [1] 어휘: 정답 번호를 문제 순서대로 ③로") && planned.includes("지문 [2] 어휘: 정답 번호를 문제 순서대로 ①로"));
});

test("문제 정렬: 유형 순서대로 묶고, 같은 유형 안에서는 지문 순서대로", () => {
  const mk = (type, no) => ({ type, source: no ? { exam: "E", no } : null });
  const rank = { "29": 0, "30": 1 };
  const sorted = VM.sortProblems([mk("order", "30"), mk("title", "30"), mk("compose", "29"), mk("order", "29"), mk("title", "29"), mk("claim", null)], (s) => rank[s.no]);
  assert.deepStrictEqual(sorted.map((p) => p.type + (p.source ? p.source.no : "")), ["claim", "title29", "title30", "order29", "order30", "compose29"]);
  assert.deepStrictEqual(VM.TYPES.map((t) => t.name), ["주장", "요지", "주제", "제목", "함축적 의미", "어법", "어휘", "빈칸", "순서", "문장삽입", "요약", "요약 서술형", "어법 오류 고치기", "서술형 문장배열", "한글 문장 영작"]);
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

test("유형 표시: 꼬리표는 발문 끝에, 구간 제목은 유형이 바뀌는 곳에 번호 범위와 함께", () => {
  const mk = (type) => ({ type, instruction: "q", passage: "p", choices: null, answer: "①", source: null });
  const problems = [mk("claim"), mk("claim"), mk("order")];
  const text = (b) => b.runs.map((r) => r.text).join("");
  const tag = VM.buildBlocks({ title: "t", problems, options: { answers: false } });
  assert.ok(text(tag.filter((b) => b.kind === "ask")[0]).endsWith("\u00a0◆ 주장\u00a0"), "기본은 꼬리표");
  const sec = VM.buildBlocks({ title: "t", problems, options: { answers: false, typeMark: "section" } });
  assert.deepStrictEqual(sec.filter((b) => b.kind === "typeHead").map(text), ["◆ 주장   1–2번", "▲ 순서   3번"]);
  const none = VM.buildBlocks({ title: "t", problems, options: { answers: false, typeMark: "none" } });
  assert.ok(!none.some((b) => b.kind === "typeHead") && !text(none.filter((b) => b.kind === "ask")[0]).includes("주장"));
});

test("정답표: 객관식 정답만 한 줄에 10쌍씩, 회차를 나누면 회차마다", () => {
  const mk = (type, answer, round) => ({ type, round, instruction: "q", passage: "p", choices: null, answer, source: null });
  const problems = [];
  for (let k = 0; k < 12; k++) problems.push(mk("title", VM.CIRCLED[k % 5], 0));
  problems.push(mk("arrange", "This habit works", 0));
  const grids = VM.buildBlocks({ title: "t", problems, options: { answers: true } }).filter((b) => b.kind === "answerGrid");
  assert.strictEqual(grids.length, 1);
  assert.strictEqual(grids[0].cells.length, 12, "서술형은 빼고");
  assert.deepStrictEqual(grids[0].cells[10], ["11", "①"]);
  assert.strictEqual(grids[0].perRow, 10);
  const two = problems.slice(0, 4).map((p, i) => Object.assign({}, p, { round: i < 2 ? 0 : 1 }));
  const b2 = VM.buildBlocks({ title: "t", problems: two, options: { answers: true, rounds: true } });
  assert.deepStrictEqual(b2.filter((b) => b.kind === "gridCaption").map((b) => b.runs[0].text), ["[1회차]", "[2회차]"]);
  assert.deepStrictEqual(b2.filter((b) => b.kind === "answerGrid").map((g) => g.cells.map((c) => c[0]).join(",")), ["1,2", "1,2"]);
});

test("어법·어휘: 밑줄 친 부분은 굵게 (Word 파일 포함)", () => {
  const p = { type: "vocab", instruction: "q", passage: "a <u>①big</u> b", choices: null, answer: "①", source: null };
  const para = VM.buildBlocks({ title: "t", problems: [p], options: { answers: false } }).filter((b) => b.kind === "para")[0];
  assert.deepStrictEqual(para.runs.find((r) => r.u), { text: "①big", u: true, b: true });
  const docx = Buffer.from(VM.buildDocx({ title: "t", problems: [p], options: { answers: false } })).toString("utf8");
  assert.ok(/<w:b\/>[^]*?<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">①big/.test(docx));
});

test("형식 검사: 선지 중복, 밑줄 번호 수, 정답 위치를 찾아낸다", () => {
  assert.deepStrictEqual(VM.checkProblem({ type: "title", passage: "p", choices: ["A", "B", "a.", "C", "D"], answer: "②" }), ["①와 ③ 선지가 같아요"]);
  assert.deepStrictEqual(VM.checkProblem({ type: "grammar", passage: "<u>①a</u> <u>②b</u> <u>③c</u> <u>④d</u>", choices: null, answer: "⑤" }),
    ["밑줄 번호(①~⑤)가 4개예요", "정답 ⑤가 지문의 밑줄 번호에 없어요"]);
  assert.deepStrictEqual(VM.checkProblem({ type: "vocab", passage: "<u>①a</u> <u>②b</u> <u>③c</u> <u>④d</u> <u>⑤e</u>", choices: null, answer: "③" }), []);
  assert.deepStrictEqual(VM.checkProblem(VM.makeOrder(SENTS, 1, VM.makeRng(1))[0]), []);
});

test("AI 검수: 요청문에 검수 기준이 들어가고, 결과로 선지·해설을 고친다", () => {
  const p1 = { type: "title", instruction: "q", passage: "p", choices: ["a", "b", "c", "d", "e"], answer: "②", explanation: "" };
  const p2 = { type: "gist", instruction: "q", passage: "p", choices: ["a", "b", "c", "d", "e"], answer: "④", explanation: "" };
  const prompt = VM.buildReviewPrompt([{ id: "r1", problem: p1, original: "Original text." }, { id: "r2", problem: p2 }]);
  assert.ok(prompt.includes("복수 정답") && prompt.includes("### 문제 r1 [제목]") && prompt.includes("원문: Original text.") && prompt.includes("표시된 정답: ④"));
  const res = VM.applyReview('```json\n{"reviews":[{"id":"r1","ok":true},{"id":"r2","ok":false,"issue":"③도 정답 가능","fix":{"choices":["a","b","x","d","e"],"explanation":"고침"}}]}\n```', { r1: p1, r2: p2 });
  assert.deepStrictEqual([res.checked, res.fixed], [2, 1]);
  assert.deepStrictEqual([p1.reviewed, p2.reviewed, p2.choices[2], p2.answer, p2.reviewNote], [true, true, "x", "④", "③도 정답 가능"]);
});

test("생성 요청문에 복수 정답 금지 규칙이 들어간다", () => {
  assert.ok(VM.buildPrompt(PASSAGE, "title", 1).includes("정답은 반드시 하나뿐"));
  assert.ok(VM.buildCombinedPrompt([{ no: "1", text: "a" }], [{ type: "title", count: 1 }]).includes("정답은 반드시 하나뿐"));
});

test("회차: 이미 만든 문제와 겹치지 않게 새 회차를 만든다 (순서·삽입·배열)", () => {
  for (const mk of [VM.makeOrder, VM.makeInsert, VM.makeArrange]) {
    for (let seed = 0; seed < 20; seed++) {
      const rng = VM.makeRng(seed);
      let all = [];
      for (let round = 0; round < 3; round++) all = all.concat(mk(SENTS, 1, rng, VM.answerDeck(rng), all));
      const sigs = all.map(VM.problemSignature);
      assert.strictEqual(new Set(sigs).size, 3, mk.name + " seed " + seed);
    }
  }
});

test("회차 중복 찾기: 같은 지문·유형에서 알맹이가 같은 문제", () => {
  const src = { exam: "E", no: "29" };
  const g = (u) => ({ type: "grammar", source: src, passage: u.map((w, i) => "<u>" + VM.CIRCLED[i] + w + "</u>").join(" "), choices: null, answer: "①" });
  const t1 = { type: "title", source: src, choices: ["A", "B", "C", "D", "E"], answer: "②" };
  const t2 = { type: "title", source: src, choices: ["X", "Y", "b", "Z", "W"], answer: "③" };
  const t3 = { type: "title", source: { exam: "E", no: "30" }, choices: ["A", "B", "C", "D", "E"], answer: "②" };
  assert.deepStrictEqual(VM.findDuplicates([g(["a", "b", "c", "d", "e"]), t1, g(["e", "d", "c", "b", "a"]), t2, t3]), [[0, 2], [1, 3]]);
  assert.strictEqual(VM.avoidNote(g(["go", "went", "x", "y", "z"])), "밑줄 친 곳: go, went, x, y, z");
  assert.ok(VM.buildPrompt(PASSAGE, "title", 1, null, ["정답 선지: b"]).includes("이미 만든 문제") );
  const combined = VM.buildCombinedPrompt([{ no: "1", text: "a" }], [{ type: "vocab", count: 1 }], { __avoid: { vocab: { "1": ["밑줄 친 곳: big, small"] } } });
  assert.ok(combined.includes("지문 [1] 어휘는 이미 만든 문제와 겹치지 않게 (밑줄 친 곳: big, small)"));
});

test("쪽 번호는 숫자만 (- 3 - 가 아님)", () => {
  const doc = { title: "t", problems: [{ type: "title", instruction: "q", passage: "p", choices: ["a", "b", "c", "d", "e"], answer: "①" }], layout: { footer: { left: "L", right: "R" } }, options: {} };
  const hw = Buffer.from(VM.buildHwpx(TEMPLATE, doc)).toString("utf8");
  assert.ok(!hw.includes("<hp:t>- </hp:t>") && !hw.includes("<hp:t> -</hp:t>"));
  const dx = Buffer.from(VM.buildDocx(doc)).toString("utf8");
  assert.ok(!dx.includes('xml:space="preserve">- </w:t>'));
});

test("요약 서술형: 빈칸 (A)~(C), 답 칸, 정답 단어가 본문에 있는지 검사", () => {
  const p = { type: "summaryWrite", instruction: VM.TYPE_BY_KEY.summaryWrite.instruction, passage: PASSAGE, box: "Creativity grows through daily (A) ________, because (B) ________ leads to quality through steady (C) ________.", boxFirst: false, choices: null, answer: "(A) practice (B) quantity (C) effort" };
  assert.deepStrictEqual(VM.checkProblem(p), []);
  assert.deepStrictEqual(VM.checkProblem(Object.assign({}, p, { answer: "(A) practise (B) quantity (C) hard work" })), ["(A) 정답 'practise'가 본문에 없어요", "(C) 정답이 한 단어가 아니에요"]);
  const blocks = VM.buildBlocks({ title: "t", problems: [p], options: { answers: false } });
  assert.ok(blocks.some((b) => b.kind === "answerLine" && b.runs[0].text.startsWith("(A) ___")));
  assert.ok(VM.buildPrompt(PASSAGE, "summaryWrite", 1).includes("본문(passage)에 그대로 나오는 한 단어"));
});

test("어법 오류 고치기: (A)~(E) 중 2개, <조건> 상자와 답안 표, 형식 검사", () => {
  const passage = "Many people <u>(A) believes that</u> creativity is rare. Research <u>(B) suggests that</u> thinking <u>(C) is like</u> a muscle. When we <u>(D) practicing looking</u> at problems, brains <u>(E) form connections</u>.";
  const p = { type: "fix", instruction: VM.TYPE_BY_KEY.fix.instruction, passage, choices: null, answer: "(A) believes → believe, (D) practicing → practice", source: null };
  assert.deepStrictEqual(VM.checkProblem(p), []);
  assert.deepStrictEqual(VM.checkProblem(Object.assign({}, p, { answer: "(A) belief → believe" })), ["고친 곳이 2개가 아니에요 (1개)", "(A)의 틀린 부분 'belief'가 밑줄 안에 없어요"]);
  const blocks = VM.buildBlocks({ title: "t", problems: [p], options: { answers: false } });
  assert.ok(VM.TYPE_BY_KEY.fix.instruction.includes("(A)~(E) 중 어법상 틀린 부분이 있는 것을 2개 골라 <조건>"));
  assert.deepStrictEqual(blocks.filter((b) => b.kind === "box").map((b) => b.runs[0].text.slice(0, 4)), ["<조건>", "1. 어", "2. 아"]);
  const table = blocks.find((b) => b.kind === "answerTable");
  assert.deepStrictEqual([table.header, table.rows], [["알파벳", "어법상 틀린 부분 (1단어)", "어법상 맞는 형태 (1단어)"], 2]);
  assert.ok(!blocks.some((b) => b.kind === "answerLine"));
  const hw = Buffer.from(VM.buildHwpx(TEMPLATE, { title: "t", problems: [p], options: {} })).toString("utf8");
  assert.ok(hw.includes('rowCnt="3" colCnt="3"') && hw.includes("<hp:t>어법상 맞는 형태 (1단어)</hp:t>"));
  const dx = Buffer.from(VM.buildDocx({ title: "t", problems: [p], options: {} })).toString("utf8");
  assert.ok(dx.includes("어법상 틀린 부분 (1단어)"));
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
  assert.ok(text.includes('charPrIDRef="' + style.char.bodyBU + '"><hp:t>①go</hp:t>'), "어법 밑줄은 굵은 밑줄");
  assert.ok(text.includes("<hp:tbl ") && text.includes('rowCnt="1" colCnt="20"'), "정답표");
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
