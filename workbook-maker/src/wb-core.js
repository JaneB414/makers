// 워크북 메이커 핵심 로직 (화면과 무관한 부분).
// 문장 나누기, 번호 표시, 한글·Word 파일 만들기는 변형문제 메이커의 core.js(VM)를 함께 쓴다.
// 브라우저에서는 전역 WB로, Node 테스트에서는 require로 쓴다.
(function (root) {
  "use strict";

  var VM = root.VM || require("../../variant-maker/src/core.js");

  // 워크북에 실리는 활동 순서. 활동마다 구간을 나누고, 구간 안에 고른 지문을 모두 싣는다(변형문제 메이커의 유형별 구성).
  // needs: 이 활동에 필요한 AI 분석 항목. 기본 6가지를 앞에 두고, 나머지는 골라서 더 넣는다.
  var ACTIVITIES = [
    { key: "vocab", name: "단어 정리", mode: "ai", needs: ["vocab"], instruction: "본문에 나온 단어와 뜻을 먼저 익히시오." },
    { key: "study", name: "본문 정리", mode: "ai", needs: ["translations"], instruction: "본문과 해석을 비교하며 읽으시오." },
    { key: "translate", name: "해석 쓰기", mode: "ai", needs: ["translations"], instruction: "다음 문장을 우리말로 해석하시오." },
    { key: "lexical", name: "어휘 양자택일", mode: "ai", needs: ["lexical"], instruction: "[ ] 안에서 문맥상 알맞은 낱말을 고르시오." },
    { key: "blank", name: "빈칸 채우기", mode: "ai", needs: ["translations"], instruction: "해석을 참고하여 주어진 첫 글자로 시작하는 알맞은 단어를 빈칸에 쓰시오." },
    { key: "grammar", name: "어법 선택", mode: "ai", needs: ["grammar"], instruction: "[ ] 안에서 어법상 알맞은 것을 고르시오." },
    { key: "scramble", name: "단어 배열", mode: "auto", needs: [], instruction: "주어진 단어를 모두 한 번씩 사용하여 본문의 문장을 완성하시오." },
    { key: "order", name: "문장 순서 배열", mode: "auto", needs: [], instruction: "주어진 문장 다음에 이어질 글의 순서를 쓰시오." },
    { key: "compose", name: "영작하기", mode: "ai", needs: ["translations"], instruction: "우리말에 맞게 본문의 영어 문장을 쓰시오." }
  ];
  var DEFAULT_KEYS = ["vocab", "study", "translate", "lexical", "blank", "grammar", "scramble"];
  var BY_KEY = {};
  ACTIVITIES.forEach(function (a, i) { a.order = i; BY_KEY[a.key] = a; });

  // 문장 번호: ①~⑳, 그 뒤는 (21)
  var SENT_MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳".split("");
  function sentMark(i) { return SENT_MARKS[i] || "(" + (i + 1) + ")"; }

  // ---------- 분석 보관 ----------

  // 같은 지문(같은 문장 나누기)이면 같은 키. AI 분석 결과를 다시 쓰는 데 쓴다.
  function passageKey(sentences) {
    var s = sentences.join("\n"), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36) + "-" + sentences.length;
  }

  // 고른 활동에 필요한 분석 항목 중 아직 없는 것
  function missingNeeds(analysis, types) {
    var out = [];
    types.forEach(function (t) {
      (BY_KEY[t] ? BY_KEY[t].needs : []).forEach(function (n) {
        if (out.indexOf(n) < 0 && !(analysis && analysis[n])) out.push(n);
      });
    });
    return out;
  }

  // ---------- 낱말 다루기 ----------

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // 문장 안에서 낱말(구)이 나오는 자리들. 앞뒤가 알파벳이면 낱말 일부이므로 뺀다.
  function findAll(sentence, phrase, ignoreCase) {
    var out = [];
    if (!phrase) return out;
    var re = new RegExp("(?<![A-Za-z])" + escapeRe(phrase) + "(?![A-Za-z])", ignoreCase ? "gi" : "g");
    var m;
    while ((m = re.exec(sentence)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
    return out;
  }

  var STOPWORDS = ("about above across after again against along already also although always among another anyone anything around because become becomes been before behind being below between beyond both cannot could didn't doesn't during either enough especially even every everyone everything example first former however instead itself just later latter least less little many might more most much must myself neither never nothing often other others otherwise ourselves perhaps rather really same seems several should since something sometimes still such than that their theirs them themselves then there therefore these they thing things this those though through thus together toward towards under unless until upon very what whatever when whenever where whether which while whom whose will with within without would yourself people").split(" ");

  // 빈칸으로 만들 만한 낱말: 5글자 이상 소문자 낱말 중 기능어가 아닌 것
  function blankCandidates(sentence) {
    var out = [], re = /[A-Za-z][A-Za-z'-]*/g, m;
    while ((m = re.exec(sentence)) !== null) {
      var w = m[0];
      if (w.length < 5 || !/^[a-z]+$/.test(w) || STOPWORDS.indexOf(w) >= 0) continue;
      out.push({ word: w, start: m.index, end: m.index + w.length });
    }
    return out;
  }

  // ---------- 자동 활동 ----------

  // 빈칸 채우기: 문장마다 빈칸을 넣고 해석을 함께 준다. 분석에 어휘(지문 속 형태)가 있으면 그 낱말을 먼저 빈칸으로 만든다.
  function makeBlank(sentences, rng, analysis) {
    var wanted = Math.max(5, Math.min(14, sentences.length + 2));
    var picks = sentences.map(function () { return []; });
    var count = 0;
    function overlaps(i, pos) { return picks[i].some(function (p) { return pos.start < p.end && p.start < pos.end; }); }
    function add(i, pos, word) {
      if (count >= wanted || overlaps(i, pos) || picks[i].length >= 2) return false;
      picks[i].push({ start: pos.start, end: pos.end, word: word });
      count++;
      return true;
    }
    var vocab = (analysis && analysis.vocab) || [];
    vocab.forEach(function (v) {
      if (!v.form || /\s/.test(v.form)) return;
      for (var i = 0; i < sentences.length; i++) {
        var at = findAll(sentences[i], v.form, false)[0];
        if (at && add(i, at, v.form)) return;
      }
    });
    // 문장마다 고르게: 한 바퀴에 문장당 하나씩, 긴 낱말을 조금 더 자주 고른다.
    for (var round = 0; round < 2 && count < wanted; round++) {
      rng.shuffle(sentences.map(function (_, i) { return i; })).forEach(function (i) {
        if (count >= wanted || picks[i].length > round) return;
        var cands = blankCandidates(sentences[i]).filter(function (c) { return !overlaps(i, c); });
        if (!cands.length) return;
        cands.sort(function (a, b) { return b.word.length - a.word.length; });
        var c = cands[Math.floor(rng.next() * Math.min(3, cands.length))];
        add(i, c, c.word);
      });
    }
    if (!count) throw new Error("빈칸으로 만들 낱말을 찾지 못했어요.");
    var n = 0, answers = [];
    var lines = sentences.map(function (s, i) {
      var list = picks[i].slice().sort(function (a, b) { return a.start - b.start; });
      var out = "", last = 0;
      list.forEach(function (p) {
        n++;
        answers.push(p.word);
        out += s.slice(last, p.start) + "<b>(" + n + ")</b> " + p.word.charAt(0) + "__________";
        last = p.end;
      });
      return out + s.slice(last);
    });
    return { sentences: lines, translations: ((analysis && analysis.translations) || []).slice(), answers: answers };
  }

  // 원래 순서와 다르게 섞는다.
  function shuffleApart(arr, rng) {
    if (arr.length < 2) return arr.slice();
    for (var t = 0; t < 20; t++) {
      var s = rng.shuffle(arr);
      if (s.some(function (x, i) { return x !== arr[i]; })) return s;
    }
    return arr.slice(1).concat(arr[0]);
  }

  var ORDER_LABELS = ["(A)", "(B)", "(C)", "(D)", "(E)", "(F)", "(G)", "(H)"];

  // 문장 순서 배열: 첫 문장을 주고, 나머지를 (A)~(H) 덩어리로 섞는다.
  function makeOrder(sentences, rng) {
    if (sentences.length < 4) throw new Error("문장이 4개 이상이어야 순서 배열을 만들 수 있어요.");
    var rest = sentences.slice(1);
    var size = Math.ceil(rest.length / ORDER_LABELS.length);
    var chunks = [];
    for (var i = 0; i < rest.length; i += size) chunks.push(rest.slice(i, i + size).join(" "));
    var shuffled = shuffleApart(chunks.map(function (_, k) { return k; }), rng);
    var label = {};
    shuffled.forEach(function (k, pos) { label[k] = ORDER_LABELS[pos]; });
    return {
      given: sentences[0],
      chunks: shuffled.map(function (k, pos) { return { label: ORDER_LABELS[pos], text: chunks[k] }; }),
      answer: chunks.map(function (_, k) { return label[k]; }).join(" - ")
    };
  }

  // 단어 배열: 문장마다 낱말(긴 문장은 2~3낱말 덩어리)을 섞는다. 해석이 있으면 우리말을 함께 준다.
  function makeScramble(sentences, rng, analysis) {
    var tr = (analysis && analysis.translations) || [];
    var items = [];
    sentences.forEach(function (s, i) {
      var end = (s.match(/[.!?]+["')\]]*$/) || [""])[0];
      var words = s.slice(0, s.length - end.length).trim().split(/\s+/);
      if (words.length < 5) return;
      if (words[0] !== "I" && /^[A-Z][a-z'-]*$/.test(words[0])) words[0] = words[0].toLowerCase();
      var size = Math.ceil(words.length / 10);
      var chunks = [];
      for (var k = 0; k < words.length; k += size) chunks.push(words.slice(k, k + size).join(" "));
      items.push({ no: i, hint: tr[i] || "", chunks: shuffleApart(chunks, rng).join(" / "), answer: s });
    });
    if (!items.length) throw new Error("배열할 만한 문장(5단어 이상)이 없어요.");
    return { items: items };
  }

  // ---------- AI 활동 ----------

  // [정답 / 오답] 선택지를 지문에 넣는다. items: [{s, answer, wrong, point}] (s는 1부터)
  function makeChoice(sentences, items, rng) {
    var marks = sentences.map(function () { return []; });
    items.forEach(function (it) {
      var i = it.s - 1;
      var free = findAll(sentences[i], it.answer, false).filter(function (pos) {
        return !marks[i].some(function (m) { return pos.start < m.end && m.start < pos.end; });
      })[0];
      if (free) marks[i].push({ start: free.start, end: free.end, item: it });
    });
    var n = 0, answers = [];
    var text = sentences.map(function (s, i) {
      var out = "", last = 0;
      marks[i].sort(function (a, b) { return a.start - b.start; }).forEach(function (m) {
        n++;
        var pair = rng.next() < 0.5 ? [m.item.answer, m.item.wrong] : [m.item.wrong, m.item.answer];
        answers.push({ answer: m.item.answer, point: m.item.point || "" });
        out += s.slice(last, m.start) + "<b>(" + n + ") [" + pair[0] + " / " + pair[1] + "]</b>";
        last = m.end;
      });
      return out + s.slice(last);
    }).join(" ");
    if (!n) throw new Error("지문에서 선택지를 넣을 자리를 찾지 못했어요.");
    return { text: text, answers: answers };
  }

  // 활동 하나를 만든다. 분석이 모자라면 오류를 낸다.
  function makeActivity(type, sentences, analysis, rng) {
    var a = analysis || {};
    var lack = missingNeeds(a, [type]);
    if (lack.length) throw new Error("AI 분석(" + lack.join(", ") + ")이 아직 없어요.");
    switch (type) {
      case "vocab": return { rows: a.vocab.map(function (v) { return { word: v.word, pos: v.pos || "", meaning: v.meaning }; }) };
      case "study": return { sentences: sentences.slice(), translations: a.translations.slice() };
      case "grammar": return makeChoice(sentences, a.grammar, rng);
      case "lexical": return makeChoice(sentences, a.lexical, rng);
      case "blank": return makeBlank(sentences, rng, a);
      case "order": return makeOrder(sentences, rng);
      case "scramble": return makeScramble(sentences, rng, a);
      case "translate": return { sentences: sentences.slice(), translations: a.translations.slice() };
      case "compose": return { sentences: sentences.slice(), translations: a.translations.slice() };
    }
    throw new Error("알 수 없는 활동: " + type);
  }

  // ---------- AI 요청문 ----------

  var NEED_GUIDE = {
    translations: '"translations": 문장마다 우리말 해석 하나씩. 개수는 그 지문의 문장 수와 꼭 같게, 번호 순서대로. 영어 구조가 보이도록 직역에 가깝게 하되 자연스러운 우리말로 쓴다.',
    vocab: '"vocab": 고2~고3 학생이 꼭 알아야 할 단어·숙어 12~16개를 지문에 나온 순서대로. 각 항목은 {"word": 사전에 싣는 기본형(숙어는 원형), "form": 지문에 나온 그대로의 형태(대소문자까지 똑같이), "pos": "n." "v." "a." "ad." "prep." "conj." "phr." 중 하나, "meaning": 이 지문 문맥의 우리말 뜻(쉼표로 2개까지)}. a, the, is 같은 쉬운 낱말은 넣지 않는다.',
    grammar: '"grammar": 어법 선택 6~8개. 각 항목은 {"s": 문장 번호, "answer": 지문에 실제로 쓰인 형태(지문에서 글자 그대로 찾을 수 있는 1~3단어), "wrong": 학생이 헷갈릴 만한 틀린 형태, "point": 출제 포인트 한 줄(우리말)}. 한 문장에 2개까지, 지문 전체에 고르게 둔다. 포인트: 멀리 떨어진 주어-동사 수일치, 본동사 vs 준동사, 능동 vs 수동, 현재분사 vs 과거분사, 관계대명사 that/what/which, 관계대명사 vs 관계부사, 병렬 구조, 대명사의 수·재귀대명사, 형용사 vs 부사, to부정사 vs 동명사, 도치 등. 조동사 뒤 동사원형, 철자처럼 너무 쉬운 포인트는 쓰지 않는다.',
    lexical: '"lexical": 문맥상 알맞은 낱말 고르기 5~7개. 각 항목은 {"s": 문장 번호, "answer": 지문에 실제로 쓰인 낱말(1단어, 글자 그대로), "wrong": 문맥에 맞지 않는 낱말(반의어나 철자·뜻이 비슷한 낱말), "point": 고르는 근거 한 줄(우리말)}. 글의 흐름을 이해해야 고를 수 있는 내용어를 고른다.'
  };
  var NEED_ORDER = ["translations", "vocab", "grammar", "lexical"];

  // passages: [{key, sentences}], needs: 만들 항목
  function buildAnalysisPrompt(passages, needs) {
    needs = NEED_ORDER.filter(function (n) { return needs.indexOf(n) >= 0; });
    var lines = [
      "너는 한국 고등학교 영어 교사다. 아래 영어 지문으로 학생용 워크북 자료를 만든다.",
      "지문의 문장은 프로그램이 이미 나누고 번호를 붙였다. 문장을 합치거나 나누지 말고 이 번호를 그대로 쓴다.",
      ""
    ];
    passages.forEach(function (p) {
      lines.push("[지문 " + p.key + "] (" + p.sentences.length + "문장)");
      p.sentences.forEach(function (s, i) { lines.push((i + 1) + ". " + s); });
      lines.push("");
    });
    lines.push("지문마다 다음 항목을 만든다.");
    needs.forEach(function (n) { lines.push("- " + NEED_GUIDE[n]); });
    lines.push("");
    lines.push("지문에서 가져오는 낱말(form, answer)은 지문의 글자와 한 글자도 다르지 않게 쓴다.");
    var example = { key: passages[0] ? passages[0].key : "1" };
    needs.forEach(function (n) { example[n] = []; });
    lines.push("다른 말 없이 JSON 하나만 답한다. 형식: " + JSON.stringify({ passages: [example] }));
    return lines.join("\n");
  }

  // AI 답변을 읽는다. sentencesByKey: {key: 문장 목록}
  // 돌려주는 값: {results: {key: {translations?, vocab?, grammar?, lexical?}}, warnings}
  function parseAnalysis(text, sentencesByKey) {
    var list = [];
    VM.extractJsonAll(text).forEach(function (data) {
      if (Array.isArray(data.passages)) list = list.concat(data.passages);
      else if (data.translations || data.vocab || data.grammar || data.lexical) list.push(data);
    });
    if (!list.length) throw new Error("AI 답변에 passages 목록이 없어요.");
    var keys = Object.keys(sentencesByKey);
    var results = {}, warnings = [];
    list.forEach(function (raw, idx) {
      var key = raw.key != null && sentencesByKey[String(raw.key)] ? String(raw.key) : (keys.length === 1 ? keys[0] : keys[idx]);
      var sents = sentencesByKey[key];
      if (!sents) return;
      var label = "지문 " + key;
      var out = {};
      if (Array.isArray(raw.translations)) {
        var tr = raw.translations.map(function (t) { return String(t == null ? "" : t).trim(); });
        if (tr.length !== sents.length) warnings.push(label + ": 해석이 " + tr.length + "개예요(문장 " + sents.length + "개). 빠진 해석은 비워 두었어요.");
        out.translations = sents.map(function (_, i) { return tr[i] || ""; });
      }
      if (Array.isArray(raw.vocab)) {
        var whole = sents.join(" ");
        out.vocab = raw.vocab.filter(function (v) { return v && v.word && v.meaning; }).map(function (v) {
          var form = v.form && findAll(whole, String(v.form), false).length ? String(v.form) : "";
          return { word: String(v.word).trim(), form: form, pos: String(v.pos || "").trim(), meaning: String(v.meaning).trim() };
        });
        if (!out.vocab.length) warnings.push(label + ": 어휘 목록이 비어 있어요.");
      }
      ["grammar", "lexical"].forEach(function (field) {
        if (!Array.isArray(raw[field])) return;
        var dropped = 0;
        out[field] = raw[field].map(function (it) {
          if (!it || !it.answer || !it.wrong) return null;
          var answer = String(it.answer).trim(), wrong = String(it.wrong).trim();
          if (answer.toLowerCase() === wrong.toLowerCase()) return null;
          var s = parseInt(it.s, 10);
          // 문장 번호가 틀렸으면 그 낱말이 있는 다른 문장을 찾는다.
          if (!(s >= 1 && s <= sents.length && findAll(sents[s - 1], answer, false).length)) {
            s = 0;
            for (var i = 0; i < sents.length && !s; i++) if (findAll(sents[i], answer, false).length) s = i + 1;
          }
          return s ? { s: s, answer: answer, wrong: wrong, point: String(it.point || "").trim() } : null;
        }).filter(function (it) { if (!it) dropped++; return it; });
        if (dropped) warnings.push(label + " " + (field === "grammar" ? "어법" : "어휘") + " 선택: 지문에서 찾지 못한 " + dropped + "개는 뺐어요.");
      });
      results[key] = out;
    });
    if (!Object.keys(results).length) throw new Error("답변의 지문 번호(key)가 요청문과 맞지 않아요.");
    return { results: results, warnings: warnings };
  }

  // ---------- 워크북 구성 ----------

  // 쓰는 줄. 2단이면 짧게.
  function writeLine(columns) { return "→ " + new Array(columns === 2 ? 44 : 96).join("_"); }

  function plain(text, role) { var r = { text: text, u: false, b: false }; if (role) r.role = role; return r; }
  function bold(text) { return { text: text, u: false, b: true }; }

  // 지문 출처: 교재 이름 + 지문 번호 (예: 올림포스2 독해의 기본 11강 Practice 3)
  function sourceText(src) {
    if (!src) return "";
    return (src.exam ? src.exam + " " : "") + VM.noLabel(src.no);
  }

  // 활동 하나의 본문 블록
  function activityBlocks(item, columns) {
    var d = item.data, out = [];
    var line = writeLine(columns);
    function sentenceBlock(i, text) { return { kind: "choice", runs: [plain(sentMark(i) + " ")].concat(VM.parseRuns(text)) }; }
    function translationBlock(t) { return { kind: "answerLine", runs: [plain(t || "", "explain")] }; }
    switch (item.type) {
      case "vocab":
        out.push({ kind: "answerTable", runs: [], span: 1, widths: [7, 33, 10, 50], header: ["번호", "단어", "품사", "뜻"],
          rows: d.rows.map(function (v, i) { return [String(i + 1), v.word, v.pos, v.meaning]; }) });
        break;
      case "study":
        d.sentences.forEach(function (s, i) {
          out.push(sentenceBlock(i, s));
          out.push(translationBlock(d.translations[i]));
        });
        break;
      case "blank":
        d.sentences.forEach(function (s, i) {
          out.push(sentenceBlock(i, s));
          out.push(translationBlock(d.translations[i]));
        });
        break;
      case "grammar":
      case "lexical":
        out.push({ kind: "para", runs: VM.parseRuns(d.text) });
        break;
      case "order":
        out.push({ kind: "box", runs: [plain(d.given)] });
        d.chunks.forEach(function (c) { out.push({ kind: "choice", runs: [bold(c.label + " "), plain(c.text)] }); });
        out.push({ kind: "answerLine", runs: [plain("답: " + d.chunks.map(function () { return "(    )"; }).join(" → "))] });
        break;
      case "scramble":
        d.items.forEach(function (it, k) {
          out.push({ kind: "choice", runs: [plain(sentMark(k) + " ")].concat(it.hint ? [plain(it.hint)] : [plain("(본문 " + sentMark(it.no) + " 문장)", "explain")]) });
          out.push({ kind: "box", runs: [plain(it.chunks)] });
          out.push({ kind: "answerLine", runs: [plain(line)] });
        });
        break;
      case "translate":
        d.sentences.forEach(function (s, i) {
          out.push(sentenceBlock(i, s));
          out.push({ kind: "answerLine", runs: [plain(line)] });
          if (s.split(/\s+/).length > 18) out.push({ kind: "answerLine", runs: [plain(line)] });
        });
        break;
      case "compose":
        d.translations.forEach(function (t, i) {
          out.push(sentenceBlock(i, t || "(해석 없음)"));
          out.push({ kind: "answerLine", runs: [plain(line)] });
          if (d.sentences[i].split(/\s+/).length > 14) out.push({ kind: "answerLine", runs: [plain(line)] });
        });
        break;
    }
    return out;
  }

  // 정답지에 싣는 줄들(없으면 빈 목록)
  function answerLines(item) {
    var d = item.data;
    switch (item.type) {
      case "grammar":
      case "lexical":
        return d.answers.map(function (a, i) { return "(" + (i + 1) + ") <b>" + a.answer + "</b>" + (a.point ? "  " + a.point : ""); });
      case "blank":
        return [d.answers.map(function (w, i) { return "(" + (i + 1) + ") " + w; }).join("   ")];
      case "order":
        return [d.answer];
      case "scramble":
        return d.items.map(function (it, k) { return sentMark(k) + " " + it.answer; });
      case "translate":
        return d.translations.map(function (t, i) { return sentMark(i) + " " + (t || "-"); });
      case "compose":
        return d.sentences.map(function (s, i) { return sentMark(i) + " " + s; });
    }
    return [];
  }

  // 워크북 항목 정렬: 활동 순서 → 지문 순서
  function sortItems(items, passageRank) {
    function rank(it) { var r = passageRank(it.source || {}); return r === null || r === undefined ? 1e9 : r; }
    return items.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
      return BY_KEY[a.it.type].order - BY_KEY[b.it.type].order || rank(a.it) - rank(b.it) || a.i - b.i;
    }).map(function (x) { return x.it; });
  }

  // 워크북을 서식 블록 목록으로 바꾼다(블록 모양은 변형문제 메이커와 같다).
  // 활동마다 구간 제목(활동 이름 + 지시문)을 달고, 그 아래에 지문마다 번호와 출처를 붙여 싣는다.
  // doc: {title, layout, options: {columns, answers, newPage}, items}
  function buildBlocks(doc) {
    var blocks = [];
    var opts = doc.options || {}, layout = doc.layout || {};
    var columns = opts.columns === 2 ? 2 : 1;
    var items = doc.items || [];

    if (layout.eyebrow) blocks.push({ kind: "eyebrow", full: true, runs: [plain(layout.eyebrow)] });
    blocks.push({ kind: "title", full: true, runs: [plain(doc.title || "영어 워크북")] });
    blocks.push({ kind: "nameLine", full: true, runs: [plain(layout.showName === false ? "" : "반 ________   번호 ________   이름 ________________")] });

    // 활동마다 번호를 1부터 센다.
    var nums = [], heads = [], last = null, n = 0;
    items.forEach(function (it, i) {
      heads.push(it.type !== last);
      if (it.type !== last) { n = 0; last = it.type; }
      nums.push(++n);
    });
    var section = 0;
    items.forEach(function (it, i) {
      var a = BY_KEY[it.type];
      if (heads[i]) {
        if (i > 0 && opts.newPage) blocks.push({ kind: "pagebreak", runs: [] });
        section++;
        blocks.push({ kind: "typeHead", runs: [plain(section + ". " + a.name, "typeHead"), plain("   " + a.instruction, "typeRange")] });
      }
      blocks.push({ kind: "ask", first: !heads[i], item: it.id, runs: [plain(String(nums[i]), "num"), { text: "", u: false, b: false, tab: true }, plain(sourceText(it.source) || "지문")] });
      blocks.push.apply(blocks, activityBlocks(it, columns));
    });

    var withAnswers = items.filter(function (it) { return answerLines(it).length; });
    if (opts.answers !== false && withAnswers.length) {
      blocks.push({ kind: "pagebreak", runs: [] });
      blocks.push({ kind: "ansTitle", full: true, runs: [plain("정답")] });
      last = null;
      items.forEach(function (it, i) {
        var lines = answerLines(it);
        if (!lines.length) return;
        if (it.type !== last) {
          last = it.type;
          blocks.push({ kind: "gridCaption", runs: [plain("[" + BY_KEY[it.type].name + "]", "ansNum")] });
        }
        var head = [plain(nums[i] + ")", "ansNum"), plain(" " + (sourceText(it.source) || "지문"))];
        // 한 줄짜리 정답은 출처 옆에, 여러 줄이면 출처 아래에 줄마다 싣는다.
        if (lines.length === 1) blocks.push({ kind: "ans", runs: head.concat(plain("  "), VM.parseRuns(lines[0])) });
        else {
          blocks.push({ kind: "ans", runs: head });
          lines.forEach(function (l) { blocks.push({ kind: "ans", runs: [plain("    ")].concat(VM.parseRuns(l)) }); });
        }
      });
    }
    return blocks;
  }

  var WB = {
    ACTIVITIES: ACTIVITIES,
    DEFAULT_KEYS: DEFAULT_KEYS,
    BY_KEY: BY_KEY,
    sentMark: sentMark,
    passageKey: passageKey,
    missingNeeds: missingNeeds,
    findAll: findAll,
    makeBlank: makeBlank,
    makeOrder: makeOrder,
    makeScramble: makeScramble,
    makeChoice: makeChoice,
    makeActivity: makeActivity,
    buildAnalysisPrompt: buildAnalysisPrompt,
    parseAnalysis: parseAnalysis,
    activityBlocks: activityBlocks,
    answerLines: answerLines,
    sortItems: sortItems,
    buildBlocks: buildBlocks
  };

  if (typeof module !== "undefined" && module.exports) module.exports = WB;
  else root.WB = WB;
})(this);
