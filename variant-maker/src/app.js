// 변형문제 메이커 화면 동작.
(function () {
  "use strict";

  var SAMPLE = "Many people believe that creativity is a rare gift given to only a few. However, research suggests that creative thinking is more like a muscle that grows stronger with regular use. When we practice looking at familiar problems from new angles, our brains form connections that did not exist before. For example, a designer who sketches ten rough ideas each morning soon finds that unusual solutions come more easily. This habit works because quantity eventually leads to quality. Most of the early ideas will be ordinary, but a few will surprise even their creator. Such surprises rarely appear when we wait passively for inspiration. Instead, they tend to emerge in the middle of steady, sometimes boring, effort. Therefore, anyone who wants to be more creative should treat imagination as a daily practice rather than a lucky accident.";
  var STORE_KEY = "variant-maker-v1";
  var HTML2PDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";

  function $(id) { return document.getElementById(id); }

  var state = { problems: [], selection: {} };
  var pendingAi = []; // 수동 붙여넣기를 기다리는 AI 유형 [{type, count}]
  var sampleFn = null;
  var downloadsCap = null;
  var aborter = null;

  // Claude 화면 안에서 열렸을 때만 쓸 수 있는 기능 (AI 바로 만들기, 파일 저장 확인창)
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("sample").then(function (s) { sampleFn = s; updateManualIntro(); }).catch(function () {});
    window.claude.use("downloads").then(function (d) { downloadsCap = d; updateSaveHint(); }).catch(function () {});
  }

  // ---------- 저장 ----------

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      state.problems = Array.isArray(s.problems) ? s.problems : [];
      state.selection = s.selection || {};
      $("passage").value = s.passage || "";
      $("title").value = s.title || "영어 변형문제";
      $("subtitle").value = s.subtitle || "";
      $("by-line").checked = !!s.byLine;
      return true;
    } catch (e) { return false; }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        problems: state.problems, selection: state.selection,
        passage: $("passage").value, title: $("title").value, subtitle: $("subtitle").value, byLine: $("by-line").checked
      }));
    } catch (e) { /* 저장 공간을 못 쓰는 환경 */ }
  }

  // ---------- 지문 ----------

  function sentences() {
    return VM.splitSentences($("passage").value, $("by-line").checked);
  }

  function renderSentences() {
    var list = sentences();
    $("sent-summary").textContent = "문장 나누기 확인 (" + list.length + "문장)";
    var ol = $("sentences");
    ol.textContent = "";
    list.forEach(function (s) { var li = document.createElement("li"); li.textContent = s; ol.appendChild(li); });
    $("sample-note").hidden = $("passage").value.trim() !== SAMPLE;
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
        setSel(t.key, cb.checked, num.value);
      });
      row.append(cb, name, num);
      box.appendChild(row);
    });
  }

  function setSel(key, on, count) {
    var n = Math.max(1, Math.min(5, parseInt(count, 10) || 1));
    state.selection[key] = { on: on, count: n };
    save();
  }

  function selected() {
    return VM.TYPES.filter(function (t) { return state.selection[t.key] && state.selection[t.key].on; })
      .map(function (t) { return { type: t.key, count: state.selection[t.key].count, mode: t.mode, name: t.name }; });
  }

  // ---------- 알림 ----------

  function show(el, kind, text) {
    el.hidden = !text;
    el.className = "msg " + (kind || "");
    el.textContent = text || "";
  }

  // ---------- 만들기 ----------

  function make() {
    var list = sentences();
    var picks = selected();
    if (!list.length) return show($("status"), "err", "지문을 먼저 넣어 주세요.");
    if (!picks.length) return show($("status"), "err", "만들 유형을 하나 이상 골라 주세요.");

    var rng = VM.makeRng();
    var made = 0, errors = [];
    picks.filter(function (p) { return p.mode === "auto"; }).forEach(function (p) {
      try {
        var ps = VM.AUTO_MAKERS[p.type](list, p.count, rng);
        state.problems = state.problems.concat(ps);
        made += ps.length;
      } catch (e) { errors.push(p.name + ": " + e.message); }
    });
    if (made) { save(); renderSheet(); }

    var ai = picks.filter(function (p) { return p.mode === "ai"; });
    var parts = [];
    if (made) parts.push("자동 유형 " + made + "문제를 추가했어요.");
    if (errors.length) parts.push(errors.join(" "));
    show($("status"), errors.length ? "err" : "ok", parts.join(" "));

    if (!ai.length) { $("manual").hidden = true; return; }
    pendingAi = ai;
    var passage = $("passage").value;
    $("prompt-out").value = VM.buildCombinedPrompt(passage, ai.map(function (a) { return { type: a.type, count: a.count }; }));
    $("ai-in").value = "";
    $("copy-state").textContent = "";
    if (sampleFn) {
      $("manual").hidden = true;
      runAi(ai, passage, parts);
    } else {
      $("manual").hidden = false;
      show($("status"), errors.length ? "err" : "ok", parts.concat(["AI 유형은 아래 순서대로 진행해 주세요."]).join(" "));
    }
  }

  function updateManualIntro() {
    if (sampleFn) $("manual-intro").textContent = "AI로 바로 만들기가 안 될 때는 요청문을 복사해 Claude 채팅에 붙여 넣고, 답변 전체를 아래 칸에 붙여 넣은 뒤 불러오기를 누르세요.";
  }

  // Claude 화면 안에서는 유형별로 한 번씩 Claude에게 바로 요청한다.
  async function runAi(ai, passage, prefix) {
    var done = [], failed = [];
    $("make").disabled = true;
    $("stop").hidden = false;
    for (var i = 0; i < ai.length; i++) {
      var a = ai[i];
      aborter = new AbortController();
      show($("status"), "", prefix.concat(["AI가 [" + a.name + "] " + a.count + "문제를 만드는 중이에요 (" + (i + 1) + "/" + ai.length + "). 한 유형에 30초~1분쯤 걸려요."]).join(" "));
      try {
        var data = await sampleFn.json(VM.buildPrompt(passage, a.type, a.count), { signal: aborter.signal });
        var res = VM.parseAiProblems(data, a.type);
        res.problems.forEach(function (p) { p.type = a.type; });
        state.problems = state.problems.concat(res.problems);
        save(); renderSheet();
        done.push(a.name + " " + res.problems.length + "문제");
        if (res.warnings.length) failed.push(res.warnings.join(" "));
      } catch (e) {
        if (e && e.code === "cancelled") { failed.push("멈췄어요."); break; }
        if (e && e.code === "not_granted") { failed.push("Claude 사용을 허용하지 않아 AI 유형을 만들지 못했어요. 아래 요청문으로 직접 만들 수 있어요."); $("manual").hidden = false; break; }
        if (e && e.code === "rate_limited") { failed.push("요청이 많아 잠시 막혔어요. 1~2분 뒤 다시 눌러 주세요."); break; }
        failed.push("[" + a.name + "] 만들기에 실패했어요" + (e && e.code === "invalid_json" ? " (답변 형식 오류)" : "") + ". 다시 누르거나 아래 요청문으로 직접 만들어 보세요.");
        $("manual").hidden = false;
      }
    }
    aborter = null;
    $("make").disabled = false;
    $("stop").hidden = true;
    var text = prefix.concat(done.length ? ["AI 유형 추가: " + done.join(", ") + "."] : []).concat(failed).join(" ");
    show($("status"), failed.length ? "warn" : "ok", text);
  }

  function loadAi() {
    var text = $("ai-in").value.trim();
    if (!text) return show($("status"), "err", "Claude의 답변을 먼저 붙여 넣어 주세요.");
    try {
      var fallback = pendingAi.length === 1 ? pendingAi[0].type : null;
      var res = VM.parseAiProblems(text, fallback);
      state.problems = state.problems.concat(res.problems);
      save(); renderSheet();
      $("ai-in").value = "";
      show($("status"), res.warnings.length ? "warn" : "ok", res.problems.length + "문제를 불러왔어요. " + res.warnings.join(" "));
    } catch (e) {
      show($("status"), "err", e.message);
    }
  }

  function copyPrompt() {
    var ta = $("prompt-out");
    var done = function () { $("copy-state").textContent = "복사했어요. Claude 채팅에 붙여 넣으세요."; };
    var fallback = function () { ta.focus(); ta.select(); $("copy-state").textContent = "선택된 글자를 Ctrl+C(⌘+C)로 복사하세요."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
    else fallback();
  }

  // ---------- 문제지 미리보기 ----------

  function docModel() {
    return {
      title: $("title").value.trim() || "영어 변형문제",
      subtitle: $("subtitle").value.trim(),
      problems: state.problems,
      options: { answers: $("opt-answers").checked, explanations: $("opt-expl").checked, columns: $("opt-cols").checked ? 2 : 1 }
    };
  }

  function runsToNodes(runs, parent) {
    runs.forEach(function (r) {
      var node = document.createTextNode(r.text);
      if (r.u) { var u = document.createElement("u"); u.appendChild(node); node = u; }
      if (r.b) { var b = document.createElement("b"); b.appendChild(node); node = b; }
      parent.appendChild(node);
    });
  }

  var CLASS = { title: "s-title", subtitle: "s-sub", question: "s-q", box: "s-box", para: "s-para", choice: "s-choice", answer: "s-answer" };

  function renderSheet() {
    var sheet = $("sheet");
    sheet.textContent = "";
    $("count").textContent = state.problems.length + "문제";
    var blocks = VM.buildBlocks(docModel());
    var current = sheet, qIndex = -1;
    blocks.forEach(function (bl, i) {
      if (bl.kind === "pagebreak") { current = sheet; var hr = document.createElement("hr"); hr.className = "s-break"; sheet.appendChild(hr); return; }
      if (bl.kind === "question") {
        qIndex++;
        current = document.createElement("div");
        current.className = "problem";
        current.appendChild(problemTools(qIndex));
        sheet.appendChild(current);
      }
      if (bl.kind === "title" && qIndex >= 0) current = sheet;
      var p = document.createElement(bl.kind === "title" ? "h3" : "p");
      p.className = CLASS[bl.kind];
      if (bl.kind === "box") {
        var prev = blocks[i - 1], next = blocks[i + 1];
        if (!prev || prev.kind !== "box") p.classList.add("first");
        if (!next || next.kind !== "box") p.classList.add("last");
      }
      runsToNodes(bl.runs, p);
      current.appendChild(p);
    });
    if (!state.problems.length) {
      var e = document.createElement("p");
      e.className = "empty";
      e.textContent = "아직 문제가 없어요. 왼쪽에서 유형을 고르고 ‘문제 만들기’를 누르세요.";
      sheet.appendChild(e);
    }
  }

  function problemTools(i) {
    var box = document.createElement("div");
    box.className = "tools";
    [["↑", "위로", -1], ["↓", "아래로", 1]].forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = d[0]; b.title = (i + 1) + "번 " + d[1];
      b.disabled = i + d[2] < 0 || i + d[2] >= state.problems.length;
      b.addEventListener("click", function () { move(i, d[2]); });
      box.appendChild(b);
    });
    var del = document.createElement("button");
    del.type = "button"; del.textContent = "삭제"; del.title = (i + 1) + "번 삭제";
    del.addEventListener("click", function () { state.problems.splice(i, 1); save(); renderSheet(); });
    box.appendChild(del);
    return box;
  }

  function move(i, d) {
    var j = i + d;
    var tmp = state.problems[i]; state.problems[i] = state.problems[j]; state.problems[j] = tmp;
    save(); renderSheet();
  }

  // ---------- 파일 저장 ----------

  function fileBase() {
    return ($("title").value.trim() || "영어 변형문제").replace(/[\\/:*?"<>|]+/g, " ").trim();
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
  function hangulFormat() {
    return downloadsCap ? "docx" : "hwpx";
  }

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

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.html2pdf) return resolve();
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
      await loadScript(HTML2PDF_URL);
      holder = document.createElement("div");
      holder.style.cssText = "position:fixed;left:-10000px;top:0;width:182mm";
      var clone = $("sheet").cloneNode(true);
      clone.removeAttribute("id");
      clone.classList.add("pdf-mode");
      // A4 폭(210mm)에서 좌우 여백 14mm씩을 뺀 폭에 맞춘다.
      clone.style.cssText = "width:182mm;max-width:none;padding:0;box-shadow:none";
      holder.appendChild(clone);
      document.body.appendChild(holder);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      var blob = await window.html2pdf().set({
        margin: [14, 14, 14, 14],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".problem", ".s-answer"] }
      }).from(clone).outputPdf("blob");
      var r = await offerFile(fileBase() + ".pdf", blob);
      show($("save-status"), r === "declined" ? "" : "ok", r === "declined" ? "저장을 취소했어요." : "PDF 파일을 저장했어요.");
    } catch (e) {
      show($("save-status"), "err", "PDF 저장에 실패했어요: " + (e.message || e.code || e));
    } finally {
      if (holder) holder.remove();
      btn.disabled = false;
    }
  }

  // ---------- 시작 ----------

  function init() {
    if (!load()) {
      $("passage").value = SAMPLE;
      state.selection = { order: { on: true, count: 2 }, insert: { on: true, count: 2 }, arrange: { on: true, count: 1 } };
      state.problems = VM.makeOrder(VM.splitSentences(SAMPLE), 1, VM.makeRng(3))
        .concat(VM.makeInsert(VM.splitSentences(SAMPLE), 1, VM.makeRng(5)))
        .concat(VM.makeArrange(VM.splitSentences(SAMPLE), 1, VM.makeRng(8)));
    }
    updateSaveHint();
    renderTypes();
    renderSentences();
    renderSheet();

    $("passage").addEventListener("input", function () { renderSentences(); save(); });
    $("by-line").addEventListener("change", function () { renderSentences(); save(); });
    ["title", "subtitle"].forEach(function (id) { $(id).addEventListener("input", function () { renderSheet(); save(); }); });
    ["opt-answers", "opt-expl"].forEach(function (id) { $(id).addEventListener("change", renderSheet); });
    $("make").addEventListener("click", make);
    $("stop").addEventListener("click", function () { if (aborter) aborter.abort(); });
    $("copy-prompt").addEventListener("click", copyPrompt);
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
      state.problems = []; save(); renderSheet(); $("confirm-clear").hidden = true;
    });
  }

  init();
})();
