// 워크북 메이커 화면 동작. 지문 보관함·쪽 나누기·파일 저장은 변형문제 메이커와 같은 방식이다.
(function () {
  "use strict";

  var SAMPLE = "Many people believe that creativity is a rare gift given to only a few. However, research suggests that creative thinking is more like a muscle that grows stronger with regular use. When we practice looking at familiar problems from new angles, our brains form connections that did not exist before. For example, a designer who sketches ten rough ideas each morning soon finds that unusual solutions come more easily. This habit works because quantity eventually leads to quality. Most of the early ideas will be ordinary, but a few will surprise even their creator. Such surprises rarely appear when we wait passively for inspiration. Instead, they tend to emerge in the middle of steady, sometimes boring, effort. Therefore, anyone who wants to be more creative should treat imagination as a daily practice rather than a lucky accident.";
  // 예시 지문의 AI 자료(처음 열었을 때 AI 활동이 어떻게 나오는지 보여 준다)
  var SAMPLE_ANALYSIS = {
    translations: [
      "많은 사람들은 창의성이 소수에게만 주어진 드문 재능이라고 믿는다.",
      "그러나 연구에 따르면 창의적 사고는 규칙적으로 쓸수록 더 강해지는 근육에 더 가깝다.",
      "익숙한 문제를 새로운 각도에서 바라보는 연습을 하면, 우리의 뇌는 전에는 없던 연결을 만들어 낸다.",
      "예를 들어, 매일 아침 대략적인 아이디어 열 개를 스케치하는 디자이너는 곧 특이한 해결책이 더 쉽게 떠오른다는 것을 알게 된다.",
      "이 습관이 효과가 있는 것은 양이 결국 질로 이어지기 때문이다.",
      "초기 아이디어의 대부분은 평범하겠지만, 몇몇은 그것을 만든 사람조차 놀라게 할 것이다.",
      "그런 놀라움은 우리가 수동적으로 영감을 기다릴 때는 좀처럼 나타나지 않는다.",
      "대신, 그것들은 꾸준하고 때로는 지루한 노력의 한가운데에서 나타나는 경향이 있다.",
      "그러므로 더 창의적이 되고 싶은 사람은 누구든 상상력을 운 좋은 우연이 아니라 매일의 연습으로 여겨야 한다."
    ],
    vocab: [
      { word: "creativity", form: "creativity", pos: "n.", meaning: "창의성" },
      { word: "rare", form: "rare", pos: "a.", meaning: "드문, 희귀한" },
      { word: "suggest", form: "suggests", pos: "v.", meaning: "시사하다, 보여 주다" },
      { word: "regular", form: "regular", pos: "a.", meaning: "규칙적인" },
      { word: "familiar", form: "familiar", pos: "a.", meaning: "익숙한" },
      { word: "angle", form: "angles", pos: "n.", meaning: "각도, 관점" },
      { word: "connection", form: "connections", pos: "n.", meaning: "연결" },
      { word: "rough", form: "rough", pos: "a.", meaning: "대략적인, 거친" },
      { word: "unusual", form: "unusual", pos: "a.", meaning: "특이한, 흔치 않은" },
      { word: "quantity", form: "quantity", pos: "n.", meaning: "양" },
      { word: "eventually", form: "eventually", pos: "ad.", meaning: "결국" },
      { word: "ordinary", form: "ordinary", pos: "a.", meaning: "평범한" },
      { word: "passively", form: "passively", pos: "ad.", meaning: "수동적으로" },
      { word: "inspiration", form: "inspiration", pos: "n.", meaning: "영감" },
      { word: "emerge", form: "emerge", pos: "v.", meaning: "나타나다, 생겨나다" },
      { word: "steady", form: "steady", pos: "a.", meaning: "꾸준한" },
      { word: "treat A as B", form: "", pos: "phr.", meaning: "A를 B로 여기다" },
      { word: "accident", form: "accident", pos: "n.", meaning: "우연, 사고" }
    ],
    grammar: [
      { s: 1, answer: "given", wrong: "giving", point: "gift가 ‘주어지는’ 것이므로 과거분사" },
      { s: 2, answer: "grows", wrong: "grow", point: "관계절 동사는 선행사 a muscle에 수일치" },
      { s: 3, answer: "looking", wrong: "to look", point: "practice는 동명사를 목적어로 취함" },
      { s: 3, answer: "that", wrong: "what", point: "선행사 connections가 있으므로 관계대명사 that" },
      { s: 4, answer: "finds", wrong: "find", point: "주어 a designer(관계절이 수식)에 수일치" },
      { s: 4, answer: "easily", wrong: "easy", point: "동사 come을 꾸미는 부사" },
      { s: 7, answer: "passively", wrong: "passive", point: "동사 wait를 꾸미는 부사" },
      { s: 9, answer: "wants", wrong: "want", point: "anyone은 단수 취급" }
    ],
    lexical: [
      { s: 1, answer: "rare", wrong: "common", point: "소수에게만 주어진다고 믿는 재능" },
      { s: 2, answer: "stronger", wrong: "weaker", point: "규칙적으로 쓰면 강해지는 근육" },
      { s: 4, answer: "unusual", wrong: "usual", point: "연습으로 떠오르는 독창적인 해결책" },
      { s: 5, answer: "quality", wrong: "quantity", point: "양이 결국 질로 이어짐" },
      { s: 7, answer: "rarely", wrong: "frequently", point: "수동적으로 기다리면 놀라움은 잘 생기지 않음" },
      { s: 8, answer: "steady", wrong: "occasional", point: "꾸준한 노력 속에서 나타남" }
    ]
  };
  var STATE_KEY = "workbook-maker-v1";
  var ANALYSIS_KEY = "workbook-maker-analysis-v1";
  var LIB_KEY = "variant-maker-library-v1"; // 변형문제 메이커와 같은 보관함
  var LIBS = {
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
  };
  var PROMPT_PASSAGES = 2; // 수동 요청문 하나에 넣는 지문 수
  var DESC = {
    read: "문장 번호를 붙인 본문",
    bilingual: "영어 문장 아래 우리말 해석",
    vocab: "단어·품사·뜻 표",
    grammar: "[맞는 형태 / 틀린 형태] 고르기",
    lexical: "[알맞은 낱말 / 반대 낱말] 고르기",
    blank: "핵심 낱말 빈칸, 첫 글자 힌트",
    order: "첫 문장 뒤 (A)~(H) 순서 쓰기",
    scramble: "문장마다 낱말 덩어리 배열",
    translate: "영어 문장 보고 해석 쓰기",
    compose: "해석 보고 영어 문장 쓰기"
  };

  function $(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var state = {
    items: [], selection: {},
    layout: { title: "영어 워크북", eyebrow: "ENGLISH · WORKBOOK", headerLeft: "", headerRight: "", footerLeft: "", footerRight: "", showName: true },
    options: { columns: 1, answers: true, groupBy: "passage", newPage: true }
  };
  var lib = { exams: [], currentExam: null };
  var analysis = {};         // 지문 키(WB.passageKey) → AI 자료 {translations, vocab, grammar, lexical}
  var editing = null;        // 편집 중인 지문 id (null이면 새 지문)
  var checked = {};          // 워크북에 넣을 지문 id
  var examForm = null;       // "new" | "rename"
  var pending = null;        // 수동 AI 붙여넣기를 기다리는 {target, types, keyMap}
  var sampleFn = null, downloadsCap = null, aborter = null;

  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("sample").then(function (s) { sampleFn = s; updateManualIntro(); }).catch(function () {});
    window.claude.use("downloads").then(function (d) { downloadsCap = d; updateSaveHint(); }).catch(function () {});
  }

  // ---------- 저장 ----------

  function loadJson(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 공간을 못 쓰는 환경 */ }
  }
  function saveState() {
    saveJson(STATE_KEY, { items: state.items, selection: state.selection, layout: state.layout, options: state.options, checked: checked, byLine: $("by-line").checked });
  }
  function saveLib() { saveJson(LIB_KEY, lib); }
  function saveAnalysis() { saveJson(ANALYSIS_KEY, analysis); }

  // ---------- 알림 ----------

  function show(el, kind, text) {
    el.hidden = !text;
    el.className = "msg " + (kind || "");
    el.textContent = text || "";
  }

  // ---------- 지문 보관함 ----------

  function currentExam() {
    return lib.exams.filter(function (e) { return e.id === lib.currentExam; })[0] || null;
  }

  function sortPassages(list) {
    return list.slice().sort(function (a, b) {
      var na = parseInt(a.no, 10), nb = parseInt(b.no, 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return String(a.no).localeCompare(String(b.no));
    });
  }

  function renderExams() {
    var sel = $("exam");
    sel.textContent = "";
    lib.exams.forEach(function (e) {
      var o = document.createElement("option");
      o.value = e.id; o.textContent = e.name + " (" + e.passages.length + ")";
      sel.appendChild(o);
    });
    if (!lib.exams.length) {
      var o = document.createElement("option");
      o.value = ""; o.textContent = "교재가 없어요. ‘새 교재’를 눌러 만드세요.";
      sel.appendChild(o);
    }
    sel.value = lib.currentExam || "";
    $("exam-rename").disabled = $("exam-delete").disabled = !currentExam();
    renderChips();
  }

  // 보관함(관리)의 지문 목록: 번호를 누르면 편집 칸에 불러온다.
  function renderChips() {
    var box = $("chips");
    box.textContent = "";
    var exam = currentExam();
    var list = exam ? sortPassages(exam.passages) : [];
    $("chips-count").textContent = exam && list.length ? "지문 " + list.length + "개. 번호를 누르면 아래에서 고칠 수 있어요." : "";
    if (!list.length) {
      var e = document.createElement("span");
      e.className = "empty-chip";
      e.textContent = exam ? "아직 등록한 지문이 없어요. 아래에 번호와 지문을 넣고 ‘지문 저장’을 누르세요." : "먼저 ‘새 교재’를 눌러 교재를 만드세요.";
      box.appendChild(e);
    }
    list.forEach(function (p) {
      var chip = document.createElement("span");
      chip.className = "chip plain" + (editing === p.id ? " editing" : "");
      var b = document.createElement("button");
      b.type = "button"; b.textContent = VM.noLabel(p.no);
      b.title = p.text.slice(0, 80);
      b.addEventListener("click", function () { editPassage(p.id); });
      chip.appendChild(b);
      box.appendChild(chip);
    });
    renderPicker();
  }

  // 워크북에 넣을 지문 고르기: 모든 교재의 지문을 교재별로 묶어 보여 준다.
  var openGroups = {};
  function renderPicker() {
    var box = $("picker");
    box.textContent = "";
    var withPassages = lib.exams.filter(function (e) { return e.passages.length; });
    if (!withPassages.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "보관함에 지문을 등록하면 여기에서 고를 수 있어요.";
      box.appendChild(empty);
    }
    withPassages.forEach(function (exam) {
      var list = sortPassages(exam.passages);
      var n = list.filter(function (p) { return checked[p.id]; }).length;
      var group = document.createElement("details");
      group.className = "pick-group";
      group.open = openGroups[exam.id] !== undefined ? openGroups[exam.id] : (n > 0 || withPassages.length === 1);
      group.addEventListener("toggle", function () { openGroups[exam.id] = group.open; });
      var sum = document.createElement("summary");
      var all = document.createElement("input");
      all.type = "checkbox"; all.id = "pick-all-" + exam.id;
      all.checked = n === list.length; all.indeterminate = n > 0 && n < list.length;
      all.setAttribute("aria-label", exam.name + " 지문 모두 선택");
      all.addEventListener("click", function (ev) { ev.stopPropagation(); });
      all.addEventListener("change", function () {
        list.forEach(function (p) { if (all.checked) checked[p.id] = true; else delete checked[p.id]; });
        openGroups[exam.id] = true;
        saveState(); renderPicker();
      });
      var name = document.createElement("span"); name.textContent = exam.name;
      var cnt = document.createElement("span"); cnt.className = "n"; cnt.textContent = n + " / " + list.length;
      sum.append(all, name, cnt);
      group.appendChild(sum);
      var chips = document.createElement("div");
      chips.className = "chips";
      list.forEach(function (p) {
        var chip = document.createElement("label");
        chip.className = "chip" + (checked[p.id] ? " checked" : "");
        chip.title = p.text.slice(0, 80);
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!checked[p.id]; cb.id = "pick-" + p.id;
        cb.addEventListener("change", function () {
          if (cb.checked) checked[p.id] = true; else delete checked[p.id];
          openGroups[exam.id] = true;
          saveState(); renderPicker();
        });
        var t = document.createElement("span");
        t.className = "chip-text"; t.textContent = VM.noLabel(p.no);
        chip.append(cb, t);
        chips.appendChild(chip);
      });
      group.appendChild(chips);
      box.appendChild(group);
    });
    updateTarget();
  }

  function editPassage(id) {
    var exam = currentExam();
    var p = exam && exam.passages.filter(function (x) { return x.id === id; })[0];
    editing = p ? p.id : null;
    $("p-no").value = p ? p.no : "";
    $("passage").value = p ? p.text : "";
    $("p-delete").disabled = !p;
    renderSentences(); renderChips();
  }

  function savePassage() {
    var exam = currentExam();
    if (!exam) return show($("lib-status"), "err", "먼저 ‘새 교재’를 눌러 교재를 만드세요.");
    var no = VM.normalizeNo($("p-no").value);
    var text = $("passage").value.trim();
    if (!no) return show($("lib-status"), "err", "지문 번호를 넣어 주세요. 예: 29, 41-42");
    if (!text) return show($("lib-status"), "err", "지문을 넣어 주세요.");
    var same = exam.passages.filter(function (p) { return p.no === no && p.id !== editing; })[0];
    var target = exam.passages.filter(function (p) { return p.id === editing; })[0] || same;
    if (target) {
      if (same && same !== target) exam.passages = exam.passages.filter(function (p) { return p !== same; });
      target.no = no; target.text = text;
    } else {
      target = { id: uid(), no: no, text: text };
      exam.passages.push(target);
    }
    editing = target.id;
    saveLib(); renderExams();
    show($("lib-status"), "ok", no + "번 지문을 저장했어요.");
  }

  function deletePassage() {
    var exam = currentExam();
    if (!exam || !editing) return;
    var p = exam.passages.filter(function (x) { return x.id === editing; })[0];
    exam.passages = exam.passages.filter(function (x) { return x.id !== editing; });
    delete checked[editing];
    saveLib(); saveState(); editPassage(null); renderExams();
    show($("lib-status"), "ok", (p ? p.no + "번 " : "") + "지문을 지웠어요.");
  }

  function openExamForm(kind) {
    examForm = kind;
    $("exam-form").hidden = false;
    $("exam-form-label").textContent = kind === "new" ? "새 교재 이름" : "바꿀 이름";
    $("exam-name").value = kind === "rename" && currentExam() ? currentExam().name : "";
    $("exam-name").focus();
  }

  function submitExamForm() {
    var name = $("exam-name").value.trim();
    if (!name) return $("exam-name").focus();
    if (examForm === "new") {
      var e = { id: uid(), name: name, passages: [] };
      lib.exams.push(e);
      lib.currentExam = e.id;
      editPassage(null);
    } else if (currentExam()) {
      currentExam().name = name;
    }
    examForm = null;
    $("exam-form").hidden = true;
    saveLib(); renderExams();
  }

  function deleteExam() {
    var exam = currentExam();
    if (!exam) return;
    lib.exams = lib.exams.filter(function (e) { return e !== exam; });
    exam.passages.forEach(function (p) { delete checked[p.id]; });
    saveState();
    lib.currentExam = lib.exams.length ? lib.exams[0].id : null;
    $("exam-confirm").hidden = true;
    saveLib(); editPassage(null); renderExams();
    show($("lib-status"), "ok", "‘" + exam.name + "’ 교재를 지웠어요.");
  }

  function bulkAdd() {
    var exam = currentExam();
    if (!exam) return show($("lib-status"), "err", "먼저 ‘새 교재’를 눌러 교재를 만드세요.");
    var list = VM.parseBulkPassages($("bulk").value);
    if (!list.length) return show($("lib-status"), "err", "번호 줄([18] 또는 18번)을 찾지 못했어요. 지문마다 번호 줄을 먼저 써 주세요.");
    var replaced = 0;
    list.forEach(function (p) {
      var old = exam.passages.filter(function (x) { return x.no === p.no; })[0];
      if (old) { old.text = p.text; replaced++; }
      else exam.passages.push({ id: uid(), no: p.no, text: p.text });
    });
    $("bulk").value = "";
    saveLib(); renderExams();
    show($("lib-status"), "ok", "지문 " + list.length + "개를 등록했어요" + (replaced ? " (" + replaced + "개는 바꿈)" : "") + ": " + list.map(function (p) { return p.no; }).join(", "));
  }

  async function exportLib() {
    var blob = new Blob([JSON.stringify(lib, null, 1)], { type: "application/json" });
    try {
      var r = await offerFile("영어 지문 보관함.json", blob);
      if (r !== "declined") show($("lib-status"), "ok", "보관함을 파일로 저장했어요.");
    } catch (e) { show($("lib-status"), "err", "저장에 실패했어요: " + (e.message || e.code)); }
  }

  function importLib(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.exams)) throw new Error("보관함 파일이 아니에요.");
        var added = 0;
        data.exams.forEach(function (e) {
          if (!e || !e.name || !Array.isArray(e.passages)) return;
          var mine = lib.exams.filter(function (x) { return x.name === e.name; })[0];
          if (!mine) { mine = { id: uid(), name: e.name, passages: [] }; lib.exams.push(mine); }
          e.passages.forEach(function (p) {
            if (!p || !p.no || !p.text) return;
            var old = mine.passages.filter(function (x) { return x.no === p.no; })[0];
            if (old) old.text = p.text; else mine.passages.push({ id: uid(), no: String(p.no), text: String(p.text) });
            added++;
          });
        });
        if (!lib.currentExam && lib.exams.length) lib.currentExam = lib.exams[0].id;
        saveLib(); renderExams();
        show($("lib-status"), "ok", "지문 " + added + "개를 불러왔어요.");
      } catch (err) { show($("lib-status"), "err", "불러오지 못했어요: " + err.message); }
    };
    reader.readAsText(file);
  }

  // ---------- 지문 확인 ----------

  function renderSentences() {
    var list = VM.splitSentences($("passage").value, $("by-line").checked);
    $("sent-summary").textContent = "문장 나누기 확인 (" + list.length + "문장)";
    var ol = $("sentences");
    ol.textContent = "";
    list.forEach(function (s) { var li = document.createElement("li"); li.textContent = s; ol.appendChild(li); });
  }

  // ---------- 활동 선택 ----------

  function renderTypes() {
    var box = $("types");
    box.textContent = "";
    WB.ACTIVITIES.forEach(function (a) {
      var row = document.createElement("label");
      row.className = "type" + (state.selection[a.key] ? " on" : "");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = "type-" + a.key; cb.checked = !!state.selection[a.key];
      var name = document.createElement("span");
      name.textContent = a.name;
      var tag = document.createElement("span");
      tag.className = "tag " + a.mode; tag.textContent = a.mode === "auto" ? "자동" : "AI";
      name.appendChild(tag);
      var desc = document.createElement("span");
      desc.className = "desc"; desc.textContent = DESC[a.key] || "";
      cb.addEventListener("change", function () { setSel(a.key, cb.checked); row.classList.toggle("on", cb.checked); });
      row.append(cb, name, desc);
      box.appendChild(row);
    });
  }

  function setSel(key, on) {
    if (on) state.selection[key] = true; else delete state.selection[key];
    saveState(); updateTarget();
  }

  function selectedTypes() {
    return WB.ACTIVITIES.filter(function (a) { return state.selection[a.key]; }).map(function (a) { return a.key; });
  }

  // 워크북에 넣을 지문: 고르기에서 체크한 지문(모든 교재), 없으면 편집 칸의 지문
  function targetPassages() {
    var list = [];
    lib.exams.forEach(function (e) {
      sortPassages(e.passages).forEach(function (p) {
        if (checked[p.id]) list.push({ exam: e.name, no: p.no, text: p.text, byLine: false });
      });
    });
    if (list.length) return { passages: list, fromLibrary: true };
    // 고른 지문이 없을 때는 보관함에 저장하지 않은 새 지문(편집 칸)으로만 만든다.
    var text = $("passage").value.trim();
    if (!text || editing) return { passages: [] };
    var exam = currentExam();
    return { passages: [{ exam: exam ? exam.name : "", no: VM.normalizeNo($("p-no").value), text: text, byLine: $("by-line").checked }], fromLibrary: false };
  }

  function withSentences(p) {
    var sents = VM.splitSentences(p.text, p.byLine);
    return { exam: p.exam, no: p.no, sentences: sents, key: WB.passageKey(sents) };
  }

  function updateTarget() {
    var t = targetPassages();
    var types = selectedTypes();
    var groups = [], byExam = {};
    t.passages.forEach(function (p) {
      if (!byExam[p.exam]) { byExam[p.exam] = []; groups.push(p.exam); }
      byExam[p.exam].push(p.no ? VM.noLabel(p.no) : "편집 중인 지문");
    });
    var summary = groups.map(function (g) { return (g ? g + ": " : "") + byExam[g].join(", "); }).join(" / ");
    var needAi = t.passages.map(withSentences).filter(function (p) { return WB.missingNeeds(analysis[p.key], types).length; }).length;
    $("pick-count").textContent = t.fromLibrary ? "선택한 지문 " + t.passages.length + "개" : "고른 지문이 없어요.";
    $("make-target").textContent = t.passages.length
      ? "대상: " + summary + " · 활동 " + types.length + "개" + (needAi ? " · AI 자료를 새로 만들 지문 " + needAi + "개" : "")
      : "2번 칸에서 워크북에 넣을 지문을 골라 주세요.";
  }

  // ---------- 만들기 ----------

  function passageRank() {
    var rank = {}, n = 0;
    lib.exams.forEach(function (e) {
      sortPassages(e.passages).forEach(function (p) { rank[e.name + "\u0001" + p.no] = n++; });
    });
    return function (src) { var r = rank[(src.exam || "") + "\u0001" + src.no]; return r === undefined ? null : r; };
  }

  // 지문 × 활동으로 워크북을 새로 짠다. AI 자료가 없는 활동은 건너뛰고 이유를 돌려준다.
  function build(passages, types) {
    var rng = VM.makeRng();
    var items = [], skipped = [];
    passages.forEach(function (p) {
      types.forEach(function (t) {
        try {
          items.push({ id: uid(), type: t, source: { exam: p.exam, no: p.no }, data: WB.makeActivity(t, p.sentences, analysis[p.key], rng) });
        } catch (e) { skipped.push((p.no ? VM.noLabel(p.no) + " " : "") + WB.BY_KEY[t].name + ": " + e.message); }
      });
    });
    state.items = WB.sortItems(items, passageRank(), state.options.groupBy);
    saveState(); renderPages();
    return skipped;
  }

  function buildMessage(skipped, extra) {
    var text = ["활동 " + state.items.length + "개로 워크북을 만들었어요."].concat(extra || []);
    if (skipped.length) text.push("빠진 활동: " + skipped.join(" / "));
    return text.join(" ");
  }

  function make() {
    var target = targetPassages();
    var types = selectedTypes();
    if (!target.passages.length) return show($("status"), "err", "2번 칸 ‘워크북에 넣을 지문 고르기’에서 지문을 골라 주세요. 교재 이름 옆 체크박스로 한 번에 고를 수 있어요.");
    if (!types.length) return show($("status"), "err", "넣을 활동을 하나 이상 골라 주세요.");
    var passages = target.passages.map(withSentences).filter(function (p) { return p.sentences.length; });
    var needs = passages.filter(function (p) { return WB.missingNeeds(analysis[p.key], types).length; });
    $("manual").hidden = true;
    if (!needs.length) {
      var skipped = build(passages, types);
      return show($("status"), skipped.length ? "warn" : "ok", buildMessage(skipped));
    }
    pending = { passages: passages, types: types };
    if (sampleFn) return runAi(passages, needs, types);
    renderPrompts(needs, types);
    $("manual").hidden = false;
    // AI 자료가 없어서 빠진 활동은 자료를 불러오면 들어가므로 따로 알리지 않는다.
    var skippedNow = build(passages, types).filter(function (m) { return m.indexOf("AI 분석") < 0; });
    show($("status"), "warn", buildMessage(skippedNow, ["AI 활동은 자료가 필요한 지문이 " + needs.length + "개 있어 아직 빠져 있어요. 아래 순서대로 자료를 불러오면 워크북을 다시 짜요."]));
  }

  // Claude 화면 안에서는 지문마다 한 번씩 Claude에게 바로 요청한다.
  async function runAi(passages, needs, types) {
    var failed = [];
    $("make").disabled = true;
    $("stop").hidden = false;
    for (var i = 0; i < needs.length; i++) {
      var p = needs[i];
      aborter = new AbortController();
      show($("status"), "", "AI가 워크북 자료(해석·어휘·어법)를 만드는 중이에요 (" + (i + 1) + "/" + needs.length + ": " + (p.no ? VM.noLabel(p.no) : "지문") + "). 하나에 30초~1분쯤 걸려요.");
      try {
        var want = WB.missingNeeds(analysis[p.key], types);
        var data = await sampleFn.json(WB.buildAnalysisPrompt([{ key: "1", sentences: p.sentences }], want), { signal: aborter.signal });
        var res = WB.parseAnalysis(data, { "1": p.sentences });
        analysis[p.key] = Object.assign(analysis[p.key] || {}, res.results["1"]);
        saveAnalysis();
        if (res.warnings.length) failed.push((p.no ? VM.noLabel(p.no) + " " : "") + res.warnings.join(" "));
      } catch (e) {
        if (e && e.code === "cancelled") { failed.push("멈췄어요."); break; }
        if (e && e.code === "not_granted") { failed.push("Claude 사용을 허용하지 않아 AI 자료를 만들지 못했어요. 아래 요청문으로 직접 만들 수 있어요."); showManual(needs.slice(i), types); break; }
        if (e && e.code === "rate_limited") { failed.push("요청이 많아 잠시 막혔어요. 1~2분 뒤 다시 눌러 주세요."); showManual(needs.slice(i), types); break; }
        failed.push("[" + (p.no ? VM.noLabel(p.no) : "지문") + "] AI 자료 만들기에 실패했어요" + (e && e.code === "invalid_json" ? " (답변 형식 오류)" : "") + ".");
        showManual(needs.slice(i), types);
      }
    }
    aborter = null;
    $("make").disabled = false;
    $("stop").hidden = true;
    var skipped = build(passages, types);
    show($("status"), failed.length || skipped.length ? "warn" : "ok", buildMessage(skipped, failed));
    updateTarget();
  }

  function showManual(needs, types) {
    renderPrompts(needs.filter(function (p) { return WB.missingNeeds(analysis[p.key], types).length; }), types);
    $("manual").hidden = false;
  }

  // 요청문에는 지문마다 1, 2, 3… 번호를 붙이고, 답변을 읽을 때 지문 키로 되돌린다.
  function renderPrompts(needs, types) {
    var box = $("prompts");
    box.textContent = "";
    pending.keyMap = {};
    var total = Math.ceil(needs.length / PROMPT_PASSAGES);
    for (var i = 0; i < needs.length; i += PROMPT_PASSAGES) {
      var chunk = needs.slice(i, i + PROMPT_PASSAGES);
      var want = [];
      var keyed = chunk.map(function (p, k) {
        var key = String(i + k + 1);
        pending.keyMap[key] = p;
        WB.missingNeeds(analysis[p.key], types).forEach(function (n) { if (want.indexOf(n) < 0) want.push(n); });
        return { key: key, sentences: p.sentences };
      });
      var row = document.createElement("div");
      row.className = "prompt-item";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "① 요청문 " + (total > 1 ? (i / PROMPT_PASSAGES + 1) + "/" + total + " " : "") + "복사" +
        " (" + chunk.map(function (p) { return p.no ? VM.noLabel(p.no) : "편집 중인 지문"; }).join(", ") + ")";
      var note = document.createElement("span");
      note.className = "hint";
      b.addEventListener("click", copier(WB.buildAnalysisPrompt(keyed, want), note));
      row.append(b, note);
      box.appendChild(row);
    }
  }

  function copier(text, note) {
    return function () {
      var done = function () { note.textContent = "복사했어요. Claude 채팅에 붙여 넣으세요."; };
      var fallback = function () {
        var ta = document.createElement("textarea");
        ta.value = text; ta.className = "mono"; ta.rows = 4; ta.readOnly = true;
        note.textContent = "";
        note.appendChild(ta);
        ta.focus(); ta.select();
        note.appendChild(document.createTextNode(" 선택된 글자를 Ctrl+C(⌘+C)로 복사하세요."));
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    };
  }

  function updateManualIntro() {
    if (sampleFn) $("manual-intro").textContent = "AI로 바로 만들기가 안 될 때는 요청문을 복사해 Claude 채팅에 붙여 넣고, 답변 전체를 아래 칸에 붙여 넣은 뒤 불러오기를 누르세요.";
  }

  function loadAi() {
    var text = $("ai-in").value.trim();
    if (!text) return show($("status"), "err", "Claude의 답변을 먼저 붙여 넣어 주세요.");
    if (!pending || !pending.keyMap) return show($("status"), "err", "먼저 ‘워크북 만들기’를 눌러 요청문을 만들어 주세요.");
    try {
      var byKey = {};
      Object.keys(pending.keyMap).forEach(function (k) { byKey[k] = pending.keyMap[k].sentences; });
      var res = WB.parseAnalysis(text, byKey);
      Object.keys(res.results).forEach(function (k) {
        var p = pending.keyMap[k];
        analysis[p.key] = Object.assign(analysis[p.key] || {}, res.results[k]);
      });
      saveAnalysis();
      $("ai-in").value = "";
      var left = Object.keys(pending.keyMap).filter(function (k) { return WB.missingNeeds(analysis[pending.keyMap[k].key], pending.types).length; });
      var skipped = build(pending.passages, pending.types);
      if (!left.length) $("manual").hidden = true;
      show($("status"), res.warnings.length || left.length ? "warn" : "ok", buildMessage(skipped, ["AI 자료 " + Object.keys(res.results).length + "개를 불러왔어요."].concat(res.warnings,
        left.length ? ["아직 자료가 없는 지문: " + left.map(function (k) { var p = pending.keyMap[k]; return p.no ? VM.noLabel(p.no) : "편집 중인 지문"; }).join(", ") + ". 나머지 요청문도 보내 주세요."] : [])));
      updateTarget();
    } catch (e) {
      show($("status"), "err", e.message);
    }
  }

  // ---------- 워크북 설정 ----------

  var LAYOUT_FIELDS = { title: "title", eyebrow: "eyebrow", "header-left": "headerLeft", "header-right": "headerRight", "footer-left": "footerLeft", "footer-right": "footerRight" };

  function docModel() {
    var L = state.layout;
    return {
      title: L.title || "영어 워크북",
      items: state.items,
      layout: {
        eyebrow: L.eyebrow, showName: L.showName,
        header: { left: L.headerLeft, right: L.headerRight },
        footer: { left: L.footerLeft, right: L.footerRight }
      },
      options: state.options
    };
  }

  // ---------- 쪽 나누어 그리기 ----------

  var HEAD_KINDS = { eyebrow: true, title: true, nameLine: true };

  function tableEl(bl) {
    var t = document.createElement("table");
    t.className = "answer-table" + (bl.span ? " wb-table" : "");
    if (bl.widths) {
      var sum = bl.widths.reduce(function (a, b) { return a + b; }, 0);
      var cg = document.createElement("colgroup");
      bl.widths.forEach(function (w) { var c = document.createElement("col"); c.style.width = (100 * w / sum) + "%"; cg.appendChild(c); });
      t.appendChild(cg);
    }
    var rows = Array.isArray(bl.rows) ? bl.rows : Array.from({ length: bl.rows }, function () { return bl.header.map(function () { return ""; }); });
    [bl.header].concat(rows).forEach(function (row, r) {
      var tr = document.createElement("tr");
      row.forEach(function (text) { var c = document.createElement(r ? "td" : "th"); c.textContent = text; tr.appendChild(c); });
      t.appendChild(tr);
    });
    return t;
  }

  function blockEl(bl, prev, next) {
    if (bl.kind === "answerTable") return tableEl(bl);
    var el = document.createElement("p");
    el.className = "k-" + bl.kind;
    if (bl.kind === "ask") {
      if (bl.first) el.classList.add("first");
      var num = document.createElement("span");
      num.className = "r-num";
      num.textContent = bl.runs[0].text;
      var text = document.createElement("span");
      runsToNodes(bl.runs.slice(2), text);
      el.append(num, text);
      return el;
    }
    if (bl.kind === "choice" && (!prev || prev.kind !== "choice")) el.classList.add("first");
    if (bl.kind === "box") {
      if (!prev || prev.kind !== "box") el.classList.add("first");
      if (!next || next.kind !== "box") el.classList.add("last");
    }
    runsToNodes(bl.runs, el);
    return el;
  }

  function runsToNodes(runs, parent) {
    runs.forEach(function (r) {
      if (r.tab) return;
      var node = document.createTextNode(r.text);
      if (r.u) { var u = document.createElement("u"); u.appendChild(node); node = u; }
      if (r.b) { var b = document.createElement("b"); b.appendChild(node); node = b; }
      if (r.role && r.role !== "num") { var s = document.createElement("span"); s.className = "r-" + r.role; s.appendChild(node); node = s; }
      parent.appendChild(node);
    });
  }

  // 블록을 묶음으로 나눈다. 활동 하나(묶음 제목~마지막 줄), 정답 한 줄이 한 묶음이다.
  function units(blocks) {
    var out = [], cur = null;
    blocks.forEach(function (bl, i) {
      if (HEAD_KINDS[bl.kind]) return;
      if (bl.kind === "pagebreak") { out.push({ pagebreak: true }); cur = null; return; }
      var prevKind = blocks[i - 1] && blocks[i - 1].kind;
      if (bl.full) {
        if (!cur || !cur.full) { cur = { blocks: [], item: null, full: true }; out.push(cur); }
        cur.blocks.push({ bl: bl, prev: blocks[i - 1], next: blocks[i + 1] });
        return;
      }
      if (cur && cur.full) cur = null;
      // 묶음 제목·원문 번호·정답 소제목은 바로 뒤 활동(정답)과 한 묶음으로 둔다.
      var afterHead = prevKind === "typeHead" || prevKind === "src" || prevKind === "gridCaption";
      var starts = bl.kind === "typeHead" || bl.kind === "gridCaption" ||
        (bl.kind === "src" && prevKind !== "typeHead") ||
        (bl.kind === "ask" && !afterHead) ||
        (bl.kind === "ans" && !afterHead && prevKind !== "ansTitle");
      if (starts || !cur) {
        cur = { blocks: [], item: null };
        out.push(cur);
      }
      if (bl.kind === "ask") cur.item = bl.item;
      cur.blocks.push({ bl: bl, prev: blocks[i - 1], next: blocks[i + 1] });
    });
    return out;
  }

  var curPage = null, curFull = null;

  function makePage(pagesEl, pageNo, headBlocks) {
    var L = state.layout;
    var page = document.createElement("div");
    page.className = "page";
    if (L.headerLeft || L.headerRight) {
      var h = document.createElement("div");
      h.className = "p-header";
      var hl = document.createElement("span"); hl.textContent = L.headerLeft || "";
      var hr = document.createElement("span"); hr.textContent = L.headerRight || "";
      h.append(hl, hr);
      page.appendChild(h);
    }
    if (headBlocks) {
      var top = document.createElement("div");
      top.className = "p-top";
      headBlocks.forEach(function (bl) { top.appendChild(blockEl(bl)); });
      page.appendChild(top);
    }
    curFull = document.createElement("div");
    curFull.className = "p-full";
    page.appendChild(curFull);
    curPage = page;
    var body = document.createElement("div");
    var two = state.options.columns === 2;
    body.className = "p-body" + (two ? " two" : "");
    var cols = [];
    for (var c = 0; c < (two ? 2 : 1); c++) {
      var col = document.createElement("div");
      col.className = "col";
      body.appendChild(col); cols.push(col);
    }
    page.appendChild(body);
    var f = document.createElement("div");
    f.className = "p-footer";
    var fl = document.createElement("span"); fl.textContent = L.footerLeft || "";
    var fc = document.createElement("span"); fc.textContent = String(pageNo);
    var fr = document.createElement("span"); fr.textContent = L.footerRight || "";
    f.append(fl, fc, fr);
    page.appendChild(f);
    pagesEl.appendChild(page);
    return cols;
  }

  function overflows(col) { return col.scrollHeight > col.clientHeight + 1; }

  function renderPages() {
    var pagesEl = $("pages");
    pagesEl.textContent = "";
    state.items = WB.sortItems(state.items, passageRank(), state.options.groupBy);
    var n = {};
    state.items.forEach(function (it) { if (it.source) n[(it.source.exam || "") + "\u0001" + it.source.no] = true; });
    $("count").textContent = state.items.length + "개 활동" + (state.items.length ? " · 지문 " + Object.keys(n).length + "개" : "");
    var blocks = WB.buildBlocks(docModel());
    var pageNo = 1;
    var cols = makePage(pagesEl, pageNo, blocks.filter(function (b) { return HEAD_KINDS[b.kind]; }));
    var ci = 0;
    function newPage() { pageNo++; cols = makePage(pagesEl, pageNo, null); ci = 0; }
    function nextCol() { ci++; if (ci >= cols.length) newPage(); }
    if (!state.items.length) {
      var e = document.createElement("p");
      e.className = "page-empty";
      e.textContent = "아직 활동이 없어요. 왼쪽에서 지문과 활동을 고르고 ‘워크북 만들기’를 누르세요.";
      cols[0].appendChild(e);
    }
    units(blocks).forEach(function (u) {
      if (u.pagebreak) { newPage(); return; }
      var els = u.blocks.map(function (x) { return blockEl(x.bl, x.prev, x.next); });
      if (u.full) {
        if (cols.some(function (c) { return c.childElementCount; })) newPage();
        var hadFull = curFull.childElementCount > 0;
        els.forEach(function (el) { curFull.appendChild(el); });
        if (hadFull && curPage.scrollHeight > curPage.clientHeight + 1) {
          els.forEach(function (el) { el.remove(); });
          newPage();
          els.forEach(function (el) { curFull.appendChild(el); });
        }
        return;
      }
      if (u.item) {
        var host = els[u.blocks.findIndex(function (x) { return x.bl.kind === "ask"; })];
        host.appendChild(itemTools(u.item));
      }
      var col = cols[ci];
      els.forEach(function (el) { col.appendChild(el); });
      if (!overflows(col)) return;
      els.forEach(function (el) { el.remove(); });
      // 짧은 활동은 통째로 다음 단으로 넘기고, 긴 활동(문장마다 쓰는 활동)은 빈자리부터 문단 단위로 나눠 싣는다.
      // 활동 제목은 첫 두 문단과 떨어지지 않게 한다.
      var lead = Math.min(els.length, u.blocks.findIndex(function (x) { return x.bl.kind === "ask"; }) + 3);
      if (els.length <= 4 && col.childElementCount) { nextCol(); col = cols[ci]; }
      els.slice(0, lead).forEach(function (el) { col.appendChild(el); });
      if (overflows(col) && col.childElementCount > lead) {
        els.slice(0, lead).forEach(function (el) { el.remove(); });
        nextCol(); col = cols[ci];
        els.slice(0, lead).forEach(function (el) { col.appendChild(el); });
      }
      els.slice(lead).forEach(function (el) {
        col.appendChild(el);
        if (overflows(col) && col.childElementCount > 1) { el.remove(); nextCol(); col = cols[ci]; col.appendChild(el); }
      });
    });
    fitPages();
  }

  function fitPages() {
    var wrap = $("pages-scroll"), pagesEl = $("pages");
    var s = Math.min(1, wrap.clientWidth / 794);
    pagesEl.style.transform = s < 1 ? "scale(" + s + ")" : "";
    wrap.style.height = s < 1 ? Math.ceil(pagesEl.offsetHeight * s) + "px" : "";
  }

  function itemTools(id) {
    var box = document.createElement("span");
    box.className = "tools";
    var del = document.createElement("button");
    del.type = "button"; del.textContent = "삭제"; del.title = "이 활동 삭제";
    del.addEventListener("click", function () {
      state.items = state.items.filter(function (it) { return it.id !== id; });
      saveState(); renderPages();
    });
    box.appendChild(del);
    return box;
  }

  // ---------- 파일 저장 ----------

  function fileBase() {
    return (state.layout.title || "영어 워크북").replace(/[\\/:*?"<>|]+/g, " ").trim() || "영어 워크북";
  }

  function plainDownload(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Claude 화면 안에서는 저장 확인창을 거친다. 그 밖에서는 바로 내려받는다.
  async function offerFile(name, blob) {
    if (!downloadsCap) { plainDownload(name, blob); return "saved"; }
    try {
      await downloadsCap.save({ filename: name, data: blob });
      return "saved";
    } catch (e) {
      if (e && e.code === "declined") return "declined";
      throw e;
    }
  }

  // Claude 화면 안에서는 .hwpx 저장이 막혀 있어, 한글에서 바로 열리는 .docx로 저장한다.
  function hangulFormat() { return downloadsCap ? "docx" : "hwpx"; }

  function updateSaveHint() {
    $("save-hint").textContent = hangulFormat() === "docx"
      ? "이 화면에서는 한글 파일을 .docx 형식으로 저장해요. 한글에서 바로 열리고, 한글의 [다른 이름으로 저장]에서 HWP로 바꿀 수 있어요."
      : "한글 파일은 .hwpx 형식으로 저장해요. 한글 2014 이상에서 열려요.";
  }

  async function saveHangul() {
    if (!state.items.length) return show($("save-status"), "err", "저장할 활동이 없어요.");
    var fmt = hangulFormat();
    var doc = docModel(), blocks = WB.buildBlocks(doc);
    try {
      var r = fmt === "docx"
        ? await offerFile(fileBase() + ".docx", new Blob([VM.buildDocx(doc, blocks)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
        : await offerFile(fileBase() + ".hwpx", new Blob([VM.buildHwpx(HWPX_TEMPLATE, doc, blocks)], { type: "application/hwp+zip" }));
      if (r === "declined") show($("save-status"), "", "저장을 취소했어요.");
      else if (fmt === "docx") show($("save-status"), "ok", "한글 파일(.docx)을 저장했어요. 한글에서 열어 [파일 → 다른 이름으로 저장]을 누르면 HWP로 바꿀 수 있어요.");
      else show($("save-status"), "ok", "한글 파일(.hwpx)을 저장했어요.");
    } catch (e) {
      show($("save-status"), "err", "한글 파일 저장에 실패했어요: " + (e.message || e.code || e));
    }
  }

  function loadScript(src, ready) {
    return new Promise(function (resolve, reject) {
      if (ready()) return resolve();
      var s = document.createElement("script");
      s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error("PDF 도구를 불러오지 못했어요. 인터넷 연결을 확인하세요.")); };
      document.head.appendChild(s);
    });
  }

  async function savePdf() {
    if (!state.items.length) return show($("save-status"), "err", "저장할 활동이 없어요.");
    var btn = $("save-pdf");
    btn.disabled = true;
    show($("save-status"), "", "PDF를 만드는 중이에요…");
    var holder = null;
    try {
      await loadScript(LIBS.html2canvas, function () { return !!window.html2canvas; });
      await loadScript(LIBS.jspdf, function () { return !!(window.jspdf && window.jspdf.jsPDF); });
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      holder = $("pages").cloneNode(true);
      holder.removeAttribute("id");
      holder.classList.add("pdf-mode");
      holder.style.cssText = "position:fixed;left:-10000px;top:0;transform:none";
      document.body.appendChild(holder);
      var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      var pages = holder.querySelectorAll(".page");
      for (var i = 0; i < pages.length; i++) {
        pages[i].style.boxShadow = "none";
        show($("save-status"), "", "PDF를 만드는 중이에요… (" + (i + 1) + "/" + pages.length + "쪽)");
        var canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff" });
        if (i) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
      }
      var r = await offerFile(fileBase() + ".pdf", pdf.output("blob"));
      show($("save-status"), r === "declined" ? "" : "ok", r === "declined" ? "저장을 취소했어요." : "PDF 파일을 저장했어요 (" + pages.length + "쪽).");
    } catch (e) {
      show($("save-status"), "err", "PDF 저장에 실패했어요: " + (e.message || e.code || e));
    } finally {
      if (holder) holder.remove();
      btn.disabled = false;
    }
  }

  // ---------- 시작 ----------

  function seedExample(savedLib) {
    if (savedLib) lib = savedLib;
    else {
      var exam = { id: uid(), name: "예시 교재", passages: [{ id: uid(), no: "29", text: SAMPLE }] };
      lib = { exams: [exam], currentExam: exam.id };
      checked = {}; checked[exam.passages[0].id] = true;
    }
    var sents = VM.splitSentences(SAMPLE);
    analysis[WB.passageKey(sents)] = SAMPLE_ANALYSIS;
    WB.DEFAULT_KEYS.forEach(function (k) { state.selection[k] = true; });
    if (!savedLib) {
      var rng = VM.makeRng(7);
      state.items = Object.keys(state.selection).map(function (t) {
        return { id: uid(), type: t, source: { exam: "예시 교재", no: "29" }, data: WB.makeActivity(t, sents, SAMPLE_ANALYSIS, rng) };
      });
    }
    state.layout.headerLeft = "예시 학원";
    state.layout.footerLeft = "예시 선생님";
  }

  function init() {
    var saved = loadJson(STATE_KEY);
    var savedLib = loadJson(LIB_KEY);
    analysis = loadJson(ANALYSIS_KEY) || {};
    if (savedLib && Array.isArray(savedLib.exams)) lib = savedLib;
    else savedLib = null;
    if (saved) {
      // 지금은 없는 활동(예전의 어휘 테스트)은 버린다.
      state.items = (saved.items || []).filter(function (it) { return WB.BY_KEY[it.type]; });
      state.selection = saved.selection || {};
      Object.keys(state.selection).forEach(function (k) { if (!WB.BY_KEY[k]) delete state.selection[k]; });
      Object.assign(state.layout, saved.layout || {});
      Object.assign(state.options, saved.options || {});
      checked = saved.checked || {};
      $("by-line").checked = !!saved.byLine;
    } else {
      // 처음 열었을 때: 보관함이 비어 있으면 예시 교재와 예시 워크북을 넣는다.
      seedExample(savedLib);
      saveLib(); saveState(); saveAnalysis();
    }

    Object.keys(LAYOUT_FIELDS).forEach(function (id) {
      var key = LAYOUT_FIELDS[id];
      $(id).value = state.layout[key] || "";
      $(id).addEventListener("input", function () { state.layout[key] = $(id).value; saveState(); renderPages(); });
    });
    $("opt-name").checked = state.layout.showName !== false;
    $("opt-cols").checked = state.options.columns === 2;
    $("opt-answers").checked = state.options.answers !== false;
    $("opt-newpage").checked = !!state.options.newPage;
    $("opt-group").value = state.options.groupBy || "passage";
    $("opt-name").addEventListener("change", function () { state.layout.showName = $("opt-name").checked; saveState(); renderPages(); });
    $("opt-cols").addEventListener("change", function () { state.options.columns = $("opt-cols").checked ? 2 : 1; saveState(); renderPages(); });
    $("opt-answers").addEventListener("change", function () { state.options.answers = $("opt-answers").checked; saveState(); renderPages(); });
    $("opt-newpage").addEventListener("change", function () { state.options.newPage = $("opt-newpage").checked; saveState(); renderPages(); });
    $("opt-group").addEventListener("change", function () { state.options.groupBy = $("opt-group").value; saveState(); renderPages(); });

    updateSaveHint();
    renderTypes();
    renderExams();
    var exam = currentExam();
    editPassage(exam && exam.passages.length ? sortPassages(exam.passages)[0].id : null);
    renderPages();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPages);
    window.addEventListener("resize", fitPages);
    // 변형문제 메이커가 다른 탭에서 보관함을 바꾸면 다시 읽는다.
    window.addEventListener("storage", function (e) {
      if (e.key !== LIB_KEY) return;
      var fresh = loadJson(LIB_KEY);
      if (fresh && Array.isArray(fresh.exams)) { lib = fresh; renderExams(); }
    });

    $("exam").addEventListener("change", function () { lib.currentExam = $("exam").value || null; saveLib(); editPassage(null); renderExams(); });
    $("exam-new").addEventListener("click", function () { openExamForm("new"); });
    $("exam-rename").addEventListener("click", function () { openExamForm("rename"); });
    $("exam-save").addEventListener("click", submitExamForm);
    $("exam-name").addEventListener("keydown", function (e) { if (e.key === "Enter") submitExamForm(); });
    $("exam-cancel").addEventListener("click", function () { $("exam-form").hidden = true; });
    $("exam-delete").addEventListener("click", function () {
      var ex = currentExam(); if (!ex) return;
      $("exam-confirm-text").textContent = "‘" + ex.name + "’ 교재와 지문 " + ex.passages.length + "개를 지울까요? ";
      $("exam-confirm").hidden = false;
    });
    $("exam-confirm-yes").addEventListener("click", deleteExam);
    $("exam-confirm-no").addEventListener("click", function () { $("exam-confirm").hidden = true; });
    $("pick-none").addEventListener("click", function () { checked = {}; saveState(); renderPicker(); });
    $("p-save").addEventListener("click", savePassage);
    $("p-new").addEventListener("click", function () { editPassage(null); $("p-no").focus(); });
    $("p-delete").addEventListener("click", deletePassage);
    $("passage").addEventListener("input", function () { renderSentences(); updateTarget(); });
    $("p-no").addEventListener("input", updateTarget);
    $("by-line").addEventListener("change", function () { renderSentences(); saveState(); updateTarget(); });
    $("bulk-add").addEventListener("click", bulkAdd);
    $("lib-export").addEventListener("click", exportLib);
    $("lib-import").addEventListener("change", function () { if (this.files[0]) importLib(this.files[0]); this.value = ""; });

    $("make").addEventListener("click", make);
    $("stop").addEventListener("click", function () { if (aborter) aborter.abort(); });
    $("load-ai").addEventListener("click", loadAi);
    $("save-hwpx").addEventListener("click", saveHangul);
    $("save-pdf").addEventListener("click", savePdf);
    function selectWhere(test) {
      WB.ACTIVITIES.forEach(function (a) { if (test(a)) state.selection[a.key] = true; else delete state.selection[a.key]; });
      saveState(); renderTypes(); updateTarget();
    }
    $("select-default").addEventListener("click", function () { selectWhere(function (a) { return WB.DEFAULT_KEYS.indexOf(a.key) >= 0; }); });
    $("select-auto").addEventListener("click", function () { selectWhere(function (a) { return a.mode === "auto"; }); });
    $("select-all").addEventListener("click", function () { selectWhere(function () { return true; }); });
    $("select-none").addEventListener("click", function () { selectWhere(function () { return false; }); });
    $("clear").addEventListener("click", function () { $("confirm-clear").hidden = !state.items.length; });
    $("clear-no").addEventListener("click", function () { $("confirm-clear").hidden = true; });
    $("clear-yes").addEventListener("click", function () {
      state.items = []; saveState(); renderPages(); $("confirm-clear").hidden = true;
    });
  }

  init();
})();
