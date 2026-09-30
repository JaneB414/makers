// 변형문제 메이커 화면 동작.
(function () {
  "use strict";

  var SAMPLE = "Many people believe that creativity is a rare gift given to only a few. However, research suggests that creative thinking is more like a muscle that grows stronger with regular use. When we practice looking at familiar problems from new angles, our brains form connections that did not exist before. For example, a designer who sketches ten rough ideas each morning soon finds that unusual solutions come more easily. This habit works because quantity eventually leads to quality. Most of the early ideas will be ordinary, but a few will surprise even their creator. Such surprises rarely appear when we wait passively for inspiration. Instead, they tend to emerge in the middle of steady, sometimes boring, effort. Therefore, anyone who wants to be more creative should treat imagination as a daily practice rather than a lucky accident.";
  var STATE_KEY = "variant-maker-v2";
  var LIB_KEY = "variant-maker-library-v1";
  var LIBS = {
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
  };
  var PROMPT_PASSAGES = 3; // 수동 요청문 하나에 넣는 지문 수

  function $(id) { return document.getElementById(id); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var state = {
    problems: [], selection: {},
    layout: { title: "영어 변형문제", eyebrow: "ENGLISH · 변형문제", headerLeft: "", headerRight: "", footerLeft: "", footerRight: "", showName: true },
    options: { columns: 2, answers: true, explanations: true }
  };
  var lib = { exams: [], currentExam: null };
  var editing = null;        // 편집 중인 지문 id (null이면 새 지문)
  var checked = {};          // 문제를 만들 지문 id
  var examForm = null;       // "new" | "rename"
  var pendingCtx = null;     // 수동 AI 붙여넣기를 기다리는 {exam, passages}
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
    saveJson(STATE_KEY, { problems: state.problems, selection: state.selection, layout: state.layout, options: state.options, checked: checked, byLine: $("by-line").checked });
  }
  function saveLib() { saveJson(LIB_KEY, lib); }

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

  // 문제지에 넣을 지문 고르기: 모든 교재의 지문을 교재별로 묶어 보여 준다.
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
      var r = await offerFile("변형문제 지문 보관함.json", blob);
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

  // ---------- 유형 선택 ----------

  function renderTypes() {
    var box = $("types");
    box.textContent = "";
    VM.TYPES.forEach(function (t) {
      var sel = state.selection[t.key] || { on: false, count: 1 };
      var row = document.createElement("label");
      row.className = "type" + (sel.on ? " on" : "");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.id = "type-" + t.key; cb.checked = sel.on;
      var name = document.createElement("span");
      name.textContent = t.name;
      var tag = document.createElement("span");
      tag.className = "tag " + t.mode; tag.textContent = t.mode === "auto" ? "자동" : "AI";
      name.appendChild(tag);
      var num = document.createElement("input");
      num.type = "number"; num.min = "1"; num.max = "5"; num.value = sel.count; num.id = "count-" + t.key;
      num.setAttribute("aria-label", t.name + " 문제 수");
      cb.addEventListener("change", function () { setSel(t.key, cb.checked, num.value); row.classList.toggle("on", cb.checked); });
      num.addEventListener("input", function () {
        if (!cb.checked) { cb.checked = true; row.classList.add("on"); }
        setSel(t.key, true, num.value);
      });
      row.append(cb, name, num);
      box.appendChild(row);
    });
  }

  function setSel(key, on, count) {
    state.selection[key] = { on: on, count: Math.max(1, Math.min(5, parseInt(count, 10) || 1)) };
    saveState(); updateTarget();
  }

  function selectedTypes() {
    return VM.TYPES.filter(function (t) { return state.selection[t.key] && state.selection[t.key].on; })
      .map(function (t) { return { type: t.key, count: state.selection[t.key].count, mode: t.mode, name: t.name }; });
  }

  // 문제를 만들 지문: 고르기에서 체크한 지문(모든 교재), 없으면 편집 칸의 지문
  function targetPassages() {
    var list = [];
    lib.exams.forEach(function (e) {
      sortPassages(e.passages).forEach(function (p) {
        if (checked[p.id]) list.push({ id: p.id, exam: e.name, no: p.no, text: p.text });
      });
    });
    if (list.length) return { passages: list, fromLibrary: true };
    var text = $("passage").value.trim();
    if (!text) return { passages: [] };
    var exam = currentExam();
    return { passages: [{ exam: exam ? exam.name : "", no: VM.normalizeNo($("p-no").value), text: text }], fromLibrary: false };
  }

  function updateTarget() {
    var t = targetPassages();
    var per = selectedTypes().reduce(function (s, x) { return s + x.count; }, 0);
    var groups = [], byExam = {};
    t.passages.forEach(function (p) {
      if (!byExam[p.exam]) { byExam[p.exam] = []; groups.push(p.exam); }
      byExam[p.exam].push(p.no ? VM.noLabel(p.no) : "편집 중인 지문");
    });
    var summary = groups.map(function (g) { return (g ? g + ": " : "") + byExam[g].join(", "); }).join(" / ");
    $("pick-count").textContent = t.fromLibrary ? "선택한 지문 " + t.passages.length + "개" : "선택한 지문이 없으면 편집 칸의 지문으로 만들어요.";
    $("make-target").textContent = t.passages.length
      ? "대상: " + summary + " · 약 " + (per * t.passages.length) + "문제"
      : "지문을 고르거나 편집 칸에 지문을 넣어 주세요.";
  }

  // ---------- 만들기 ----------

  function srcOf(exam, p) { return p.no ? { exam: exam, no: p.no } : null; }

  // 문제는 늘 유형 순서대로 묶고, 같은 유형 안에서는 지문 순서(교재 순서 → 지문 번호 순서)로 놓는다.
  function sortAll() {
    var rank = {}, n = 0;
    lib.exams.forEach(function (e) {
      sortPassages(e.passages).forEach(function (p) { rank[e.name + "\u0001" + p.no] = n++; });
    });
    state.problems = VM.sortProblems(state.problems, function (src) {
      var r = rank[(src.exam || "") + "\u0001" + src.no];
      return r === undefined ? null : r;
    });
  }

  function insertProblems(list) {
    state.problems = state.problems.concat(list);
    sortAll();
  }

  function make() {
    var target = targetPassages();
    var types = selectedTypes();
    if (!target.passages.length) return show($("status"), "err", "지문을 고르거나 편집 칸에 지문을 넣어 주세요.");
    if (!types.length) return show($("status"), "err", "만들 유형을 하나 이상 골라 주세요.");

    var rng = VM.makeRng();
    var byLine = $("by-line").checked && !target.fromLibrary;
    var made = 0, errors = [];
    target.passages.forEach(function (p) {
      var sents = VM.splitSentences(p.text, byLine);
      types.filter(function (t) { return t.mode === "auto"; }).forEach(function (t) {
        try {
          var ps = VM.AUTO_MAKERS[t.type](sents, t.count, rng);
          ps.forEach(function (x) { x.source = srcOf(p.exam, p); });
          insertProblems(ps);
          made += ps.length;
        } catch (e) { errors.push((p.no ? p.no + "번 " : "") + t.name + ": " + e.message); }
      });
    });
    if (made) { saveState(); renderPages(); }

    var ai = types.filter(function (t) { return t.mode === "ai"; });
    var prefix = [];
    if (made) prefix.push("자동 유형 " + made + "문제를 추가했어요.");
    if (errors.length) prefix.push(errors.join(" "));
    show($("status"), errors.length ? "warn" : "ok", prefix.join(" "));
    if (!ai.length) { $("manual").hidden = true; return; }

    pendingCtx = target;
    renderPrompts(target, ai);
    if (sampleFn) {
      $("manual").hidden = true;
      runAi(target, ai, prefix);
    } else {
      $("manual").hidden = false;
      show($("status"), errors.length ? "warn" : "ok", prefix.concat(["AI 유형은 아래 순서대로 진행해 주세요."]).join(" "));
    }
  }

  // 요청문에는 지문마다 1, 2, 3… 번호를 붙이고, 답변을 읽을 때 원래 교재·번호로 되돌린다.
  function renderPrompts(target, ai) {
    var box = $("prompts");
    box.textContent = "";
    var reqs = ai.map(function (a) { return { type: a.type, count: a.count }; });
    target.keyMap = {};
    var keyed = target.passages.map(function (p, i) {
      var key = String(i + 1);
      target.keyMap[key] = p;
      return { no: key, text: p.text, label: (p.exam ? p.exam + " " : "") + (p.no ? VM.noLabel(p.no) : "") };
    });
    for (var i = 0; i < keyed.length; i += PROMPT_PASSAGES) {
      var chunk = keyed.slice(i, i + PROMPT_PASSAGES);
      var text = VM.buildCombinedPrompt(chunk, reqs);
      var row = document.createElement("div");
      row.className = "prompt-item";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "① 요청문 복사" + (keyed.length > PROMPT_PASSAGES ? " (" + chunk.map(function (p) { return p.label.trim() || "지문"; }).join(", ") + ")" : "");
      var note = document.createElement("span");
      note.className = "hint";
      b.addEventListener("click", copier(text, note));
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

  // Claude 화면 안에서는 지문·유형별로 한 번씩 Claude에게 바로 요청한다.
  async function runAi(target, ai, prefix) {
    var jobs = [];
    target.passages.forEach(function (p) { ai.forEach(function (a) { jobs.push({ p: p, a: a }); }); });
    var done = 0, failed = [];
    $("make").disabled = true;
    $("stop").hidden = false;
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      aborter = new AbortController();
      show($("status"), "", prefix.concat(["AI가 문제를 만드는 중이에요 (" + (i + 1) + "/" + jobs.length + ": " + (job.p.no ? job.p.no + "번 " : "") + job.a.name + "). 하나에 30초~1분쯤 걸려요."]).join(" "));
      try {
        var data = await sampleFn.json(VM.buildPrompt(job.p.text, job.a.type, job.a.count), { signal: aborter.signal });
        var res = VM.parseAiProblems(data, { type: job.a.type, exam: job.p.exam, no: job.p.no });
        res.problems.forEach(function (x) { x.type = job.a.type; x.source = srcOf(job.p.exam, job.p); });
        insertProblems(res.problems);
        saveState(); renderPages();
        done += res.problems.length;
        if (res.warnings.length) failed.push(res.warnings.join(" "));
      } catch (e) {
        if (e && e.code === "cancelled") { failed.push("멈췄어요."); break; }
        if (e && e.code === "not_granted") { failed.push("Claude 사용을 허용하지 않아 AI 유형을 만들지 못했어요. 아래 요청문으로 직접 만들 수 있어요."); $("manual").hidden = false; break; }
        if (e && e.code === "rate_limited") { failed.push("요청이 많아 잠시 막혔어요. 1~2분 뒤 다시 눌러 주세요."); $("manual").hidden = false; break; }
        failed.push("[" + (job.p.no ? job.p.no + "번 " : "") + job.a.name + "] 만들기에 실패했어요" + (e && e.code === "invalid_json" ? " (답변 형식 오류)" : "") + ".");
        $("manual").hidden = false;
      }
    }
    aborter = null;
    $("make").disabled = false;
    $("stop").hidden = true;
    var text = prefix.concat(done ? ["AI 유형 " + done + "문제를 추가했어요."] : []).concat(failed).join(" ");
    show($("status"), failed.length ? "warn" : "ok", text);
  }

  function loadAi() {
    var text = $("ai-in").value.trim();
    if (!text) return show($("status"), "err", "Claude의 답변을 먼저 붙여 넣어 주세요.");
    try {
      var ctx = pendingCtx || { passages: [], keyMap: {} };
      var res = VM.parseAiProblems(text, { no: ctx.passages.length === 1 ? "1" : "" });
      res.problems.forEach(function (x) {
        var p = x.source && ctx.keyMap && ctx.keyMap[x.source.no];
        x.source = p ? srcOf(p.exam, p) : null;
      });
      insertProblems(res.problems);
      saveState(); renderPages();
      $("ai-in").value = "";
      show($("status"), res.warnings.length ? "warn" : "ok", res.problems.length + "문제를 불러왔어요. " + res.warnings.join(" "));
    } catch (e) {
      show($("status"), "err", e.message);
    }
  }

  // ---------- 문제지 설정 ----------

  var LAYOUT_FIELDS = { title: "title", eyebrow: "eyebrow", "header-left": "headerLeft", "header-right": "headerRight", "footer-left": "footerLeft", "footer-right": "footerRight" };

  function docModel() {
    var L = state.layout;
    return {
      title: L.title || "영어 변형문제",
      problems: state.problems,
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

  function blockEl(bl, prev, next) {
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

  // 블록을 묶음으로 나눈다. 문제 하나(원문 번호~선지), 정답 한 줄이 한 묶음이다. 정답 제목은 첫 정답과 묶는다.
  function units(blocks) {
    var out = [], cur = null, qIndex = -1;
    blocks.forEach(function (bl, i) {
      if (HEAD_KINDS[bl.kind]) return;
      if (bl.kind === "pagebreak") { out.push({ pagebreak: true }); cur = null; return; }
      var prevKind = blocks[i - 1] && blocks[i - 1].kind;
      var starts = bl.kind === "src" || bl.kind === "ansTitle" ||
        (bl.kind === "ask" && prevKind !== "src") ||
        (bl.kind === "ans" && prevKind !== "ansTitle");
      if (starts || !cur) {
        cur = { blocks: [], problem: null };
        if (bl.kind === "src" || bl.kind === "ask") cur.problem = ++qIndex;
        out.push(cur);
      }
      cur.blocks.push({ bl: bl, prev: blocks[i - 1], next: blocks[i + 1] });
    });
    return out;
  }

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
    var body = document.createElement("div");
    var two = state.options.columns !== 1;
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
    var fc = document.createElement("span"); fc.textContent = "- " + pageNo + " -";
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
    sortAll(); // 예전에 만든 문제나 지문 번호를 바꾼 경우에도 순서를 맞춘다
    $("count").textContent = state.problems.length + "문제";
    var blocks = VM.buildBlocks(docModel());
    var pageNo = 1;
    var cols = makePage(pagesEl, pageNo, blocks.filter(function (b) { return HEAD_KINDS[b.kind]; }));
    var ci = 0;
    function newPage() { pageNo++; cols = makePage(pagesEl, pageNo, null); ci = 0; }
    function nextCol() { ci++; if (ci >= cols.length) newPage(); }
    if (!state.problems.length) {
      var e = document.createElement("p");
      e.className = "page-empty";
      e.textContent = "아직 문제가 없어요. 왼쪽에서 지문과 유형을 고르고 ‘문제 만들기’를 누르세요.";
      cols[0].appendChild(e);
    }
    units(blocks).forEach(function (u) {
      if (u.pagebreak) { newPage(); return; }
      var els = u.blocks.map(function (x) { return blockEl(x.bl, x.prev, x.next); });
      if (u.problem !== null) {
        els[0].style.position = "relative";
        els[0].appendChild(problemTools(u.problem));
      }
      var col = cols[ci];
      els.forEach(function (el) { col.appendChild(el); });
      if (!overflows(col)) return;
      els.forEach(function (el) { el.remove(); });
      if (col.childElementCount) { nextCol(); col = cols[ci]; }
      els.forEach(function (el) { col.appendChild(el); });
      if (!overflows(col)) return;
      // 한 단보다 긴 묶음은 문단 단위로 나눠 싣는다.
      els.forEach(function (el) { el.remove(); });
      els.forEach(function (el) {
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

  function problemTools(i) {
    var box = document.createElement("span");
    box.className = "tools";
    var del = document.createElement("button");
    del.type = "button"; del.textContent = "삭제"; del.title = (i + 1) + "번 삭제";
    del.addEventListener("click", function () { state.problems.splice(i, 1); saveState(); renderPages(); });
    box.appendChild(del);
    return box;
  }

  // ---------- 파일 저장 ----------

  function fileBase() {
    return (state.layout.title || "영어 변형문제").replace(/[\\/:*?"<>|]+/g, " ").trim() || "영어 변형문제";
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
    if (!state.problems.length) return show($("save-status"), "err", "저장할 문제가 없어요.");
    var fmt = hangulFormat();
    try {
      var r = fmt === "docx"
        ? await offerFile(fileBase() + ".docx", new Blob([VM.buildDocx(docModel())], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
        : await offerFile(fileBase() + ".hwpx", new Blob([VM.buildHwpx(HWPX_TEMPLATE, docModel())], { type: "application/hwp+zip" }));
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
    if (!state.problems.length) return show($("save-status"), "err", "저장할 문제가 없어요.");
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

  function seedExample() {
    var exam = { id: uid(), name: "예시 교재", passages: [{ id: uid(), no: "29", text: SAMPLE }] };
    lib = { exams: [exam], currentExam: exam.id };
    checked = {}; checked[exam.passages[0].id] = true;
    state.selection = { order: { on: true, count: 1 }, insert: { on: true, count: 1 }, arrange: { on: true, count: 1 } };
    var sents = VM.splitSentences(SAMPLE);
    state.problems = VM.makeOrder(sents, 1, VM.makeRng(3)).concat(VM.makeInsert(sents, 1, VM.makeRng(5)), VM.makeArrange(sents, 1, VM.makeRng(8)));
    state.problems.forEach(function (p) { p.source = { exam: exam.name, no: "29" }; });
    state.layout.headerLeft = "예시 학원";
    state.layout.footerLeft = "예시 선생님";
  }

  function init() {
    var saved = loadJson(STATE_KEY);
    var savedLib = loadJson(LIB_KEY);
    if (savedLib && Array.isArray(savedLib.exams)) lib = savedLib;
    if (saved) {
      state.problems = saved.problems || [];
      state.selection = saved.selection || {};
      Object.assign(state.layout, saved.layout || {});
      Object.assign(state.options, saved.options || {});
      checked = saved.checked || {};
      $("by-line").checked = !!saved.byLine;
    } else if (!savedLib) {
      seedExample();
      saveLib(); saveState();
    }

    Object.keys(LAYOUT_FIELDS).forEach(function (id) {
      var key = LAYOUT_FIELDS[id];
      $(id).value = state.layout[key] || "";
      $(id).addEventListener("input", function () { state.layout[key] = $(id).value; saveState(); renderPages(); });
    });
    $("opt-name").checked = state.layout.showName !== false;
    $("opt-cols").checked = state.options.columns !== 1;
    $("opt-answers").checked = state.options.answers !== false;
    $("opt-expl").checked = state.options.explanations !== false;
    $("opt-name").addEventListener("change", function () { state.layout.showName = $("opt-name").checked; saveState(); renderPages(); });
    $("opt-cols").addEventListener("change", function () { state.options.columns = $("opt-cols").checked ? 2 : 1; saveState(); renderPages(); });
    $("opt-answers").addEventListener("change", function () { state.options.answers = $("opt-answers").checked; saveState(); renderPages(); });
    $("opt-expl").addEventListener("change", function () { state.options.explanations = $("opt-expl").checked; saveState(); renderPages(); });

    updateSaveHint();
    renderTypes();
    renderExams();
    var exam = currentExam();
    editPassage(exam && exam.passages.length ? sortPassages(exam.passages)[0].id : null);
    renderPages();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPages);
    window.addEventListener("resize", fitPages);

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
    $("by-line").addEventListener("change", function () { renderSentences(); saveState(); });
    $("bulk-add").addEventListener("click", bulkAdd);
    $("lib-export").addEventListener("click", exportLib);
    $("lib-import").addEventListener("change", function () { if (this.files[0]) importLib(this.files[0]); this.value = ""; });

    $("make").addEventListener("click", make);
    $("stop").addEventListener("click", function () { if (aborter) aborter.abort(); });
    $("load-ai").addEventListener("click", loadAi);
    $("save-hwpx").addEventListener("click", saveHangul);
    $("save-pdf").addEventListener("click", savePdf);
    $("select-auto").addEventListener("click", function () {
      VM.TYPES.forEach(function (t) { setSel(t.key, t.mode === "auto", (state.selection[t.key] || {}).count || 1); });
      renderTypes();
    });
    $("select-none").addEventListener("click", function () {
      VM.TYPES.forEach(function (t) { setSel(t.key, false, (state.selection[t.key] || {}).count || 1); });
      renderTypes();
    });
    $("clear").addEventListener("click", function () { $("confirm-clear").hidden = !state.problems.length; });
    $("clear-no").addEventListener("click", function () { $("confirm-clear").hidden = true; });
    $("clear-yes").addEventListener("click", function () {
      state.problems = []; saveState(); renderPages(); $("confirm-clear").hidden = true;
    });
  }

  init();
})();
