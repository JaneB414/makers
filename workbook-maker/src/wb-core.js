// 워크북 메이커 핵심 로직 (화면과 무관한 부분).
// 문장 나누기, 번호 표시, 한글·Word 파일 만들기는 변형문제 메이커의 core.js(VM)를 함께 쓴다.
// 브라우저에서는 전역 WB로, Node 테스트에서는 require로 쓴다.
(function (root) {
  "use strict";

  var VM = root.VM || require("../../variant-maker/src/core.js");

  // 워크북에 실리는 활동 순서.
  // 지문 정리는 지문마다 한 쪽(내용 정리 → 본문|해석 → 단어 정리)씩 싣고, 나머지는 활동마다 구간을 나눠 고른 지문을 모두 싣는다.
  // needs: 이 활동에 필요한 AI 분석 항목. 해석 쓰기는 기본으로 넣지 않고 골라서 더 넣는다.
  var ACTIVITIES = [
    { key: "study", name: "지문 정리", mode: "ai", needs: ["summary", "translations", "vocab"], instruction: "내용을 정리하고 본문과 해석을 비교하며 단어를 익히시오." },
    { key: "syntax", name: "구문 분석", mode: "ai", needs: ["syntax"], instruction: "왼쪽 본문의 번호를 오른쪽 설명과 맞춰 보며 문장 구조를 익히시오." },
    { key: "lexical", name: "어휘 양자택일", mode: "ai", needs: ["lexical"], instruction: "[ ] 안에서 문맥상 알맞은 낱말을 고르시오." },
    { key: "blank", name: "빈칸 채우기", mode: "ai", needs: ["translations"], instruction: "해석을 참고하여 주어진 첫 글자로 시작하는 알맞은 단어를 빈칸에 쓰시오." },
    { key: "grammar", name: "어법 양자택일", mode: "ai", needs: ["grammar"], instruction: "[ ] 안에서 어법상 알맞은 것을 고르시오." },
    { key: "scramble", name: "단어 순서 배열", mode: "auto", needs: [], instruction: "우리말에 맞게 주어진 단어를 모두 한 번씩 사용하여 문장을 완성하시오." },
    { key: "order", name: "문장 순서 배열", mode: "auto", needs: [], instruction: "주어진 문장 다음에 이어질 글의 순서를 쓰시오." },
    { key: "compose", name: "영작하기", mode: "ai", needs: ["translations"], instruction: "우리말에 맞게 본문의 영어 문장을 쓰시오. ( ) 안은 단어 수입니다." },
    { key: "translate", name: "해석 쓰기", mode: "ai", needs: ["translations"], instruction: "다음 문장을 우리말로 해석하시오." }
  ];
  var DEFAULT_KEYS = ["study", "syntax", "lexical", "blank", "grammar", "scramble", "order", "compose"];
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
    // 빈칸은 촘촘하게: 문장마다 2개 정도, 지문 전체에서 6~24개
    var wanted = Math.max(6, Math.min(24, Math.round(sentences.length * 2.2)));
    var picks = sentences.map(function () { return []; });
    var count = 0;
    function overlaps(i, pos) { return picks[i].some(function (p) { return pos.start < p.end && p.start < pos.end; }); }
    function add(i, pos, word) {
      if (count >= wanted || overlaps(i, pos) || picks[i].length >= 3) return false;
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
    for (var round = 0; round < 3 && count < wanted; round++) {
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

  // 단어 순서 배열: 문장마다 낱말을 하나씩 잘라 섞는다. 해석이 있으면 우리말을 함께 준다.
  function makeScramble(sentences, rng, analysis) {
    var tr = (analysis && analysis.translations) || [];
    var items = [];
    sentences.forEach(function (s, i) {
      var end = (s.match(/[.!?]+["')\]]*$/) || [""])[0];
      var words = s.slice(0, s.length - end.length).trim().split(/\s+/);
      if (words.length < 3) return;
      if (words[0] !== "I" && /^[A-Z][a-z'-]*$/.test(words[0])) words[0] = words[0].toLowerCase();
      items.push({ no: i, hint: tr[i] || "", chunks: shuffleApart(words, rng).join(" / "), answer: s });
    });
    if (!items.length) throw new Error("배열할 만한 문장(3단어 이상)이 없어요.");
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
      case "study": return {
        summary: a.summary, sentences: sentences.slice(), translations: a.translations.slice(),
        rows: a.vocab.map(function (v) { return { word: v.word, pos: v.pos || "", meaning: v.meaning }; })
      };
      case "syntax": return { sentences: sentences.slice(), marks: a.syntax.marks, points: a.syntax.points };
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
    summary: '"summary": 지문 내용 정리. {"gist": 요지(우리말 한 문장), "topic": 주제(영어 명사구), "topicKo": 주제의 우리말, "title": 제목(영어, 각 단어 첫 글자 대문자), "titleKo": 제목의 우리말, "flow": 글의 흐름 3~6단계 [{"part": 단계 이름(예: 통념, 반박, 예시, 원리, 결론, 문제 제기, 해결책), "from": 시작 문장 번호, "to": 끝 문장 번호}]}. flow는 1번 문장부터 마지막 문장까지 빠짐없이 이어지게 나눈다.',
    translations: '"translations": 문장마다 우리말 해석 하나씩. 개수는 그 지문의 문장 수와 꼭 같게, 번호 순서대로. 영어 구조가 보이도록 직역에 가깝게 하되 자연스러운 우리말로 쓴다.',
    vocab: '"vocab": 고2~고3 학생이 꼭 알아야 할 단어·숙어 14~18개를 지문에 나온 순서대로. 각 항목은 {"word": 사전에 싣는 기본형(숙어는 원형), "form": 지문에 나온 그대로의 형태(대소문자까지 똑같이), "pos": "n." "v." "a." "ad." "prep." "conj." "phr." 중 하나, "meaning": 이 지문 문맥의 우리말 뜻(쉼표로 2개까지)}. a, the, is 같은 쉬운 낱말은 넣지 않는다.',
    syntax: '"syntax": 구문 분석. {"marks": 문장마다 {"s": 문장 번호, "subjects": 주어(수식어 포함, 지문 글자 그대로) 목록, "verbs": 본동사(조동사·부정어 포함, 지문 글자 그대로) 목록}, "points": 핵심 구문 [{"s": 문장 번호, "phrase": 형광펜을 칠할 부분(지문 글자 그대로 1~8단어), "note": 설명 한 줄}]}. marks는 모든 문장에 하나씩, 대등절이면 주어·동사를 여러 개 쓴다. points는 문장마다 1~3개, 문장 안에서 나오는 순서대로, 서로 겹치지 않게 고른다. note는 짧게, 무엇을 꾸미는지는 화살표로 쓴다(예: "과거분사구 → a rare gift 수식", "that절(명사절) → believe의 목적어", "주어 a designer에 수일치 → 단수 동사", "tend to + 동사원형: ~하는 경향이 있다").',
    grammar: '"grammar": 어법 양자택일 10~14개(문장마다 1~2개). 각 항목은 {"s": 문장 번호, "answer": 지문에 실제로 쓰인 형태(지문에서 글자 그대로 찾을 수 있는 1~3단어), "wrong": 학생이 헷갈릴 만한 틀린 형태, "point": 출제 포인트 한 줄(우리말)}. 한 문장에 2개까지, 지문 전체에 고르게 둔다. 포인트: 멀리 떨어진 주어-동사 수일치, 본동사 vs 준동사, 능동 vs 수동, 현재분사 vs 과거분사, 관계대명사 that/what/which, 관계대명사 vs 관계부사, 병렬 구조, 대명사의 수·재귀대명사, 형용사 vs 부사, to부정사 vs 동명사, 도치 등. 조동사 뒤 동사원형, 철자처럼 너무 쉬운 포인트는 쓰지 않는다.',
    lexical: '"lexical": 어휘 양자택일(문맥상 알맞은 낱말 고르기) 10~14개(문장마다 1~2개). 각 항목은 {"s": 문장 번호, "answer": 지문에 실제로 쓰인 낱말(1단어, 글자 그대로), "wrong": 문맥에 맞지 않는 낱말(반의어나 철자·뜻이 비슷한 낱말), "point": 고르는 근거 한 줄(우리말)}. 글의 흐름을 이해해야 고를 수 있는 내용어를 고른다.'
  };
  var NEED_ORDER = ["summary", "translations", "vocab", "syntax", "grammar", "lexical"];

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
      else if (NEED_ORDER.some(function (n) { return data[n]; })) list.push(data);
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
      if (raw.summary && typeof raw.summary === "object") {
        var sm = raw.summary;
        var str = function (v) { return String(v == null ? "" : v).trim(); };
        out.summary = {
          gist: str(sm.gist), topic: str(sm.topic), topicKo: str(sm.topicKo), title: str(sm.title), titleKo: str(sm.titleKo),
          flow: (Array.isArray(sm.flow) ? sm.flow : []).map(function (f) {
            var from = parseInt(f && f.from, 10), to = parseInt(f && f.to, 10);
            if (!f || !f.part || !(from >= 1 && from <= sents.length)) return null;
            return { part: str(f.part), from: from, to: to >= from && to <= sents.length ? to : from };
          }).filter(Boolean)
        };
        if (!out.summary.gist || !out.summary.title) warnings.push(label + ": 내용 정리(요지·제목)가 비어 있어요.");
      }
      if (raw.syntax && typeof raw.syntax === "object") {
        var syn = raw.syntax, lost = 0;
        // 주어·동사 표시: 문장마다 지문에서 찾은 것만 남긴다.
        var marks = sents.map(function () { return { subjects: [], verbs: [] }; });
        (Array.isArray(syn.marks) ? syn.marks : []).forEach(function (m) {
          var i = parseInt(m && m.s, 10) - 1;
          if (!(i >= 0 && i < sents.length)) return;
          ["subjects", "verbs"].forEach(function (f) {
            (Array.isArray(m[f]) ? m[f] : []).forEach(function (t) {
              t = String(t).trim();
              if (t && findAll(sents[i], t, false).length) marks[i][f].push(t);
              else if (t) lost++;
            });
          });
        });
        var points = (Array.isArray(syn.points) ? syn.points : []).map(function (pt) {
          var i = parseInt(pt && pt.s, 10) - 1, phrase = String((pt && pt.phrase) || "").trim();
          if (!(i >= 0 && i < sents.length) || !phrase || !pt.note || !findAll(sents[i], phrase, false).length) { lost++; return null; }
          return { s: i + 1, phrase: phrase, note: String(pt.note).trim() };
        }).filter(Boolean);
        out.syntax = { marks: marks, points: points };
        if (lost) warnings.push(label + " 구문 분석: 지문에서 찾지 못한 표시 " + lost + "개는 뺐어요.");
        if (!points.length) warnings.push(label + ": 구문 분석의 핵심 구문이 비어 있어요.");
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
        if (dropped) warnings.push(label + " " + (field === "grammar" ? "어법" : "어휘") + " 양자택일: 지문에서 찾지 못한 " + dropped + "개는 뺐어요.");
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

  // 구문 분석 번호: 지문 하나 안에서 ❶부터 이어서 센다.
  var POINT_MARKS = "❶❷❸❹❺❻❼❽❾❿⓫⓬⓭⓮⓯⓰⓱⓲⓳⓴".split("");
  function pointMark(i) { return POINT_MARKS[i] || "(" + (i + 1) + ")"; }

  // 글의 흐름: "통념 ① → 반박 ②~③ → …"
  function flowText(flow) {
    return flow.map(function (f) { return f.part + " " + sentMark(f.from - 1) + (f.to > f.from ? "~" + sentMark(f.to - 1) : ""); }).join(" → ");
  }

  // 지문 정리 한 쪽: 지문 제목 → 내용 정리 → 본문|해석 → 단어 정리
  function studyBlocks(item, no) {
    var d = item.data, sm = d.summary || {}, out = [];
    out.push({ kind: "typeHead", item: item.id, runs: [plain("지문 " + no + "   ", "typeHead"), plain(sourceText(item.source) || "지문", "typeHead")] });
    out.push({ kind: "src", runs: [plain("내용 정리")] });
    out.push({ kind: "box", runs: [plain("요지   ", "lbl"), plain(sm.gist || "")] });
    out.push({ kind: "box", runs: [plain("주제   ", "lbl"), plain(sm.topic || "")].concat(sm.topicKo ? [plain("  " + sm.topicKo, "explain")] : []) });
    out.push({ kind: "box", runs: [plain("제목   ", "lbl"), bold(sm.title || "")].concat(sm.titleKo ? [plain("  " + sm.titleKo, "explain")] : []) });
    if (sm.flow && sm.flow.length) out.push({ kind: "box", runs: [plain("글의 흐름   ", "lbl"), plain(flowText(sm.flow), "explain")] });
    out.push({ kind: "richTable", runs: [], span: 1, widths: [1, 1], header: ["본문", "해석"],
      rows: d.sentences.map(function (s, i) {
        return [[[plain(sentMark(i) + " ", "cell"), plain(s, "cell")]], [[plain(sentMark(i) + " ", "cellKo"), plain(d.translations[i] || "", "cellKo")]]];
      }) });
    if (d.rows.length) {
      // 단어 정리는 두 칸으로 나눠 한 쪽에 들어가게 한다.
      var half = Math.ceil(d.rows.length / 2);
      var rows = [];
      for (var k = 0; k < half; k++) {
        var a = d.rows[k], b = d.rows[k + half];
        rows.push([String(k + 1), a.word, a.pos, a.meaning].concat(b ? [String(k + half + 1), b.word, b.pos, b.meaning] : ["", "", "", ""]));
      }
      out.push({ kind: "src", runs: [plain("단어 정리")] });
      out.push({ kind: "answerTable", runs: [], span: 1, widths: [6, 16, 6, 22, 6, 16, 6, 22], header: ["번호", "단어", "품사", "뜻", "번호", "단어", "품사", "뜻"], rows: rows });
    }
    return out;
  }

  // 구문 분석 왼쪽 칸: 주어 밑줄, 동사 굵게, 핵심 구문 형광펜 + 번호. 오른쪽 칸: 번호별 설명.
  function syntaxRows(d) {
    var n = 0;
    return d.sentences.map(function (s, i) {
      var L = s.length, u = [], b = [], hl = [];
      for (var x = 0; x < L; x++) { u.push(false); b.push(false); hl.push(-1); }
      var m = d.marks[i] || { subjects: [], verbs: [] };
      function paint(arr, phrase, value) {
        var at = findAll(s, phrase, false)[0];
        if (at) for (var y = at.start; y < at.end; y++) arr[y] = value;
      }
      m.subjects.forEach(function (t) { paint(u, t, true); });
      m.verbs.forEach(function (t) { paint(b, t, true); });
      var notes = [];
      d.points.filter(function (pt) { return pt.s === i + 1; }).forEach(function (pt) {
        // 이미 칠한 곳과 겹치지 않는 첫 자리에 칠한다.
        var at = findAll(s, pt.phrase, false).filter(function (pos) {
          for (var y = pos.start; y < pos.end; y++) if (hl[y] >= 0) return false;
          return true;
        })[0];
        if (!at) return;
        for (var y = at.start; y < at.end; y++) hl[y] = n;
        notes.push([plain(pointMark(n) + " ", "pn"), plain(pt.note, "cell")]);
        n++;
      });
      var runs = [plain(sentMark(i) + " ", "cell")], x0 = 0;
      while (x0 < L) {
        var x1 = x0;
        while (x1 < L && u[x1] === u[x0] && b[x1] === b[x0] && hl[x1] === hl[x0]) x1++;
        runs.push({ text: s.slice(x0, x1), u: u[x0], b: b[x0], role: hl[x0] >= 0 ? "hl" : "cell" });
        if (hl[x0] >= 0 && (x1 === L || hl[x1] !== hl[x0])) runs.push(plain(pointMark(hl[x0]), "pn"));
        x0 = x1;
      }
      return [[runs], notes];
    });
  }

  // 활동 하나의 본문 블록 (지문 정리는 studyBlocks)
  function activityBlocks(item, columns) {
    var d = item.data, out = [];
    var line = writeLine(columns);
    function sentenceBlock(i, text) { return { kind: "choice", runs: [plain(sentMark(i) + " ")].concat(VM.parseRuns(text)) }; }
    function translationBlock(t) { return { kind: "answerLine", runs: [plain(t || "", "explain")] }; }
    switch (item.type) {
      case "syntax":
        out.push({ kind: "richTable", runs: [], span: 1, widths: [54, 46], header: ["본문", "구문 설명"], rows: syntaxRows(d) });
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
          out.push({ kind: "choice", runs: [plain(sentMark(it.no) + " ")].concat(it.hint ? [plain(it.hint)] : [plain("(본문 " + sentMark(it.no) + " 문장)", "explain")]) });
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
          var words = d.sentences[i].split(/\s+/).length;
          out.push({ kind: "choice", runs: [plain(sentMark(i) + " " + (t || "(해석 없음)")), plain("  (" + words + "단어)", "typeRange")] });
          out.push({ kind: "answerLine", runs: [plain(line)] });
          if (words > 13) out.push({ kind: "answerLine", runs: [plain(line)] });
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
        return [d.answers.map(function (a, i) { return "(" + (i + 1) + ") <b>" + a.answer + "</b>" + (a.point ? " " + a.point : ""); }).join("   ")];
      case "blank":
        return [d.answers.map(function (w, i) { return "(" + (i + 1) + ") " + w; }).join("   ")];
      case "order":
        return [d.answer];
      case "scramble":
        return d.items.map(function (it) { return sentMark(it.no) + " " + it.answer; });
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
  // 지문 정리는 지문마다 한 쪽씩, 나머지는 활동마다 구간 제목(번호. 활동 이름 + 지시문)을 달고 그 아래에 지문마다 번호와 출처를 붙여 싣는다.
  // doc: {title, layout, options: {columns, answers, newPage}, items}
  function buildBlocks(doc) {
    var blocks = [];
    var opts = doc.options || {}, layout = doc.layout || {};
    var columns = opts.columns === 2 ? 2 : 1;
    var items = doc.items || [];

    if (layout.eyebrow) blocks.push({ kind: "eyebrow", full: true, runs: [plain(layout.eyebrow)] });
    blocks.push({ kind: "title", full: true, runs: [plain(doc.title || "영어 워크북")] });
    blocks.push({ kind: "nameLine", full: true, runs: [plain(layout.showName === false ? "" : "반 ________   번호 ________   이름 ________________")] });

    // 활동마다 번호를 1부터 센다. 구간 번호는 실린 활동 순서대로.
    var nums = [], heads = [], types = [], last = null, n = 0;
    items.forEach(function (it) {
      heads.push(it.type !== last);
      if (it.type !== last) { n = 0; last = it.type; types.push(it.type); }
      nums.push(++n);
    });
    items.forEach(function (it, i) {
      var a = BY_KEY[it.type];
      var prev = i ? items[i - 1].type : null;
      if (it.type === "study") {
        // 지문 하나 = 한 쪽
        if (i) blocks.push({ kind: "pagebreak", runs: [] });
        blocks.push.apply(blocks, studyBlocks(it, nums[i]));
        return;
      }
      if (heads[i]) {
        if (i && (opts.newPage || prev === "study")) blocks.push({ kind: "pagebreak", runs: [] });
        blocks.push({ kind: "typeHead", runs: [plain((types.indexOf(it.type) + 1) + ". " + a.name, "typeHead"), plain("   " + a.instruction, "typeRange")] });
        if (it.type === "syntax") {
          blocks.push({ kind: "para", runs: [{ text: "주어", u: true, b: false }, plain(" 밑줄 · "), bold("동사"), plain(" 굵게 · "), plain("핵심 구문", "hl"), plain(pointMark(0), "pn"), plain(" → 오른쪽 같은 번호 설명")] });
        }
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
    pointMark: pointMark,
    flowText: flowText,
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
