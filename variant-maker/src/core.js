// 변형문제 메이커 핵심 로직 (화면과 무관한 부분).
// 브라우저에서는 전역 VM으로, Node 테스트에서는 require로 쓴다.
(function (root) {
  "use strict";

  var CIRCLED = ["①", "②", "③", "④", "⑤"];

  var TYPES = [
    { key: "claim", name: "주장", mode: "ai", instruction: "다음 글에서 필자가 주장하는 바로 가장 적절한 것은?" },
    { key: "gist", name: "요지", mode: "ai", instruction: "다음 글의 요지로 가장 적절한 것은?" },
    { key: "topic", name: "주제", mode: "ai", instruction: "다음 글의 주제로 가장 적절한 것은?" },
    { key: "title", name: "제목", mode: "ai", instruction: "다음 글의 제목으로 가장 적절한 것은?" },
    { key: "grammar", name: "어법", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?" },
    { key: "vocab", name: "어휘", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?" },
    { key: "implied", name: "함축적 의미", mode: "ai", instruction: "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" },
    { key: "blank", name: "빈칸", mode: "ai", instruction: "다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오." },
    { key: "order", name: "순서", mode: "auto", instruction: "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오." },
    { key: "insert", name: "문장삽입", mode: "auto", instruction: "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오." },
    { key: "summary", name: "요약", mode: "ai", instruction: "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?" },
    { key: "arrange", name: "서술형 문장배열", mode: "auto", instruction: "다음 글의 빈칸 (A)에 들어갈 말을 <보기>의 단어를 모두 한 번씩 사용하여 바르게 배열하시오." },
    { key: "compose", name: "한글 문장 영작", mode: "ai", instruction: "다음 글의 밑줄 친 우리말 (A)를 <조건>에 맞게 영작하시오." },
    { key: "fix", name: "어법 오류 고치기", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중 어법상 틀린 것을 모두 찾아 기호를 쓰고 바르게 고치시오." }
  ];

  var TYPE_BY_KEY = {};
  TYPES.forEach(function (t) { TYPE_BY_KEY[t.key] = t; });

  // ---------- 난수 ----------

  function makeRng(seed) {
    var a = (seed === undefined || seed === null) ? Math.floor(Math.random() * 4294967296) : seed >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var a2 = arr.slice();
        for (var i = a2.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = a2[i]; a2[i] = a2[j]; a2[j] = tmp;
        }
        return a2;
      }
    };
  }

  // 정답 번호가 한쪽으로 몰리지 않도록 0~(n-1)을 골고루 섞어 돌려준다.
  function spreadAnswers(count, n, rng) {
    var out = [];
    while (out.length < count) out = out.concat(rng.shuffle(range(n)));
    return out.slice(0, count);
  }

  function range(n) {
    var r = [];
    for (var i = 0; i < n; i++) r.push(i);
    return r;
  }

  // ---------- 문장 나누기 ----------

  var ABBREVIATIONS = [
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k",
    "a.m", "p.m", "no", "fig", "cf", "inc", "ltd", "co", "mt", "approx", "dept", "est"
  ];

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/ /g, " ");
  }

  // byLine이 true면 줄바꿈 하나를 문장 하나로 본다.
  function splitSentences(text, byLine) {
    text = normalizeText(text).trim();
    if (!text) return [];
    if (byLine) {
      return text.split(/\n+/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    }
    var flat = text.replace(/\s+/g, " ");
    var out = [];
    var start = 0;
    var re = /[.!?]+["')\]]*(?=\s+["'(\[]?[A-Z0-9])/g;
    var m;
    while ((m = re.exec(flat)) !== null) {
      var end = m.index + m[0].length;
      var before = flat.slice(start, m.index);
      var lastWord = (before.match(/([A-Za-z.]+)$/) || ["", ""])[1].toLowerCase();
      if (m[0].charAt(0) === "." && (ABBREVIATIONS.indexOf(lastWord) >= 0 || /^[a-z]$/.test(lastWord))) {
        continue;
      }
      out.push(flat.slice(start, end).trim());
      start = end;
    }
    var rest = flat.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }

  // ---------- 자동 생성: 순서 ----------

  var ORDER_PERMS = [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  var LABELS = ["(A)", "(B)", "(C)"];

  function orderConfigs(n) {
    var configs = [];
    for (var g = 1; g <= Math.min(2, n - 3); g++) {
      var m = n - g;
      var ideal = m / 3;
      for (var i = 1; i < m - 1; i++) {
        for (var j = i + 1; j < m; j++) {
          var sizes = [i, j - i, m - j];
          var spread = Math.max.apply(null, sizes) - Math.min.apply(null, sizes);
          if (spread <= Math.max(1, Math.ceil(ideal / 2))) configs.push({ given: g, cuts: [i, j] });
        }
      }
    }
    return configs;
  }

  function makeOrder(sentences, count, rng) {
    var n = sentences.length;
    if (n < 4) throw new Error("순서 문제는 문장이 4개 이상 필요합니다. (지금 " + n + "개)");
    var configs = rng.shuffle(orderConfigs(n));
    var answers = spreadAnswers(count, 5, rng);
    var problems = [];
    for (var k = 0; k < count; k++) {
      var c = configs[k % configs.length];
      var given = sentences.slice(0, c.given);
      var rest = sentences.slice(c.given);
      var chunks = [rest.slice(0, c.cuts[0]), rest.slice(c.cuts[0], c.cuts[1]), rest.slice(c.cuts[1])];
      var perm = ORDER_PERMS[answers[k]]; // perm[위치] = 그 위치에 오는 덩어리의 라벨 번호
      var byLabel = [];
      for (var pos = 0; pos < 3; pos++) byLabel[perm[pos]] = chunks[pos];
      problems.push({
        type: "order",
        instruction: TYPE_BY_KEY.order.instruction,
        box: given.join(" "),
        boxFirst: true,
        passage: byLabel.map(function (ch, li) { return LABELS[li] + " " + ch.join(" "); }).join("\n"),
        choices: ORDER_PERMS.map(function (p) { return p.map(function (x) { return LABELS[x]; }).join(" - "); }),
        answer: CIRCLED[answers[k]],
        explanation: "주어진 글 → " + perm.map(function (x) { return LABELS[x]; }).join(" → ")
      });
    }
    return problems;
  }

  // ---------- 자동 생성: 문장삽입 ----------

  var LINKERS = /^(however|but|yet|still|thus|therefore|hence|consequently|as a result|for example|for instance|in addition|moreover|furthermore|besides|also|similarly|likewise|in contrast|on the other hand|instead|otherwise|nevertheless|nonetheless|meanwhile|then|this|these|that|those|such|it|they|he|she|its|their|his|her|in other words|in fact|indeed|after all|unfortunately|fortunately)\b/i;

  function makeInsert(sentences, count, rng) {
    var n = sentences.length;
    if (n < 4) throw new Error("문장삽입 문제는 문장이 4개 이상 필요합니다. (지금 " + n + "개)");
    // 빼낼 문장 후보: 첫 문장 제외. 연결어·지시어로 시작하는 문장을 먼저 쓴다.
    var cands = range(n).slice(1);
    var strong = rng.shuffle(cands.filter(function (i) { return LINKERS.test(sentences[i]); }));
    var weak = rng.shuffle(cands.filter(function (i) { return !LINKERS.test(sentences[i]); }));
    var order = strong.concat(weak);
    var slots = n - 1; // 남은 문장 뒤의 자리 수
    var markers = Math.min(5, slots);
    var problems = [];
    for (var k = 0; k < count; k++) {
      var removed = order[k % order.length];
      var remaining = sentences.filter(function (_, i) { return i !== removed; });
      // 자리 번호 p(1..slots)는 remaining[p-1] 바로 뒤. 정답 자리는 removed.
      var lo = Math.max(1, removed - markers + 1);
      var hi = Math.min(removed, slots - markers + 1);
      var startSlot = rng.int(lo, hi);
      var parts = [];
      for (var i = 0; i < remaining.length; i++) {
        parts.push(remaining[i]);
        var p = i + 1;
        if (p >= startSlot && p < startSlot + markers) parts.push("( " + CIRCLED[p - startSlot] + " )");
      }
      problems.push({
        type: "insert",
        instruction: TYPE_BY_KEY.insert.instruction,
        box: sentences[removed],
        boxFirst: true,
        passage: parts.join(" "),
        choices: null,
        answer: CIRCLED[removed - startSlot],
        explanation: "주어진 문장은 \"" + shorten(sentences[removed - 1], 60) + "\" 다음에 온다."
      });
    }
    return problems;
  }

  function shorten(s, max) {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  // ---------- 자동 생성: 서술형 문장배열 ----------

  function cleanWord(w) {
    return w.replace(/^["'(\[]+/, "").replace(/[.,;:!?"')\]]+$/, "");
  }

  // 배열할 구간을 고른다. 문장이 짧으면 문장 전체, 길면 쉼표나 문장 끝에서 끝나는 7~12단어.
  function pickSpan(words, rng) {
    var n = words.length;
    if (n <= 13) return { start: 0, len: n };
    var good = [], ok = [];
    for (var st = 0; st < n; st++) {
      var startsClean = st === 0 || /[,;:]$/.test(words[st - 1]);
      for (var len = 7; len <= 12 && st + len <= n; len++) {
        var e = st + len - 1;
        var endsClean = e === n - 1 || /[,;:]$/.test(words[e]);
        if (!endsClean) continue;
        (startsClean ? good : ok).push({ start: st, len: len });
      }
    }
    var pool = good.length ? good : ok;
    return pool.length ? rng.pick(pool) : { start: n - 10, len: 10 };
  }

  function makeArrange(sentences, count, rng) {
    var cands = [];
    sentences.forEach(function (s, i) {
      var words = s.split(" ");
      if (words.length >= 6) cands.push(i);
    });
    if (!cands.length) throw new Error("문장배열 문제를 만들 만큼 긴 문장(6단어 이상)이 없습니다.");
    cands = rng.shuffle(cands);
    var problems = [];
    for (var k = 0; k < count; k++) {
      var si = cands[k % cands.length];
      var words = sentences[si].split(" ");
      var span = pickSpan(words, rng);
      var start = span.start, len = span.len;
      span = words.slice(start, start + len);
      var answerText = span.join(" ").replace(/[.,;:!?]+$/, "");
      var tokens = span.map(cleanWord).filter(Boolean);
      var shuffled = tokens;
      for (var tries = 0; tries < 20 && shuffled.join(" ") === tokens.join(" "); tries++) shuffled = rng.shuffle(tokens);
      var trailing = (span[span.length - 1].match(/[.,;:!?]+$/) || [""])[0];
      var blanked = words.slice(0, start).concat(["(A) ________________" + trailing]).concat(words.slice(start + len)).join(" ");
      var passage = sentences.map(function (s, i) { return i === si ? blanked : s; }).join(" ");
      problems.push({
        type: "arrange",
        instruction: TYPE_BY_KEY.arrange.instruction,
        box: "<보기>  " + shuffled.join(" / "),
        boxFirst: false,
        passage: passage,
        choices: null,
        answer: answerText,
        explanation: ""
      });
    }
    return problems;
  }

  var AUTO_MAKERS = { order: makeOrder, insert: makeInsert, arrange: makeArrange };

  // ---------- AI 요청문 ----------

  var AI_SPECS = {
    claim: "필자의 주장을 묻는 문제. choices는 한국어 5개, 모두 '~해야 한다'로 끝나는 문장. 오답은 글의 일부만 반영하거나, 과장하거나, 글과 반대되거나, 상식적이지만 글에 없는 내용으로 만든다. passage는 원문 그대로.",
    gist: "글의 요지를 묻는 문제. choices는 한국어 평서문 5개. 오답은 부분 정보, 과도한 일반화, 반대 내용, 글에 없는 내용으로 만든다. passage는 원문 그대로.",
    topic: "글의 주제를 묻는 문제. choices는 영어 명사구 5개(소문자로 시작, 마침표 없음, 예: 'effects of social media on self-esteem'). 오답은 너무 넓거나 좁거나, 글의 세부 사항이거나, 반대 방향인 것. passage는 원문 그대로.",
    title: "글의 제목을 묻는 문제. choices는 영어 제목 5개(주요 단어 첫 글자 대문자, 의문문·감탄문·콜론 형식도 가능). 정답은 요지를 비유적으로 표현해도 좋다. passage는 원문 그대로.",
    grammar: "어법상 틀린 것을 고르는 문제. passage에서 서로 다른 어법 포인트(수일치, 시제, 분사, 관계사, 동명사/to부정사, 병렬, 대명사, 태, 형용사/부사 등) 5곳에 <u>①단어</u>, <u>②단어</u> … <u>⑤단어</u> 형식으로 번호와 밑줄을 넣는다. 그중 정확히 1곳만 어법상 틀리게 바꾸고, 나머지 4곳과 나머지 지문은 원문 그대로 둔다. choices는 null. explanation에 틀린 곳과 올바른 형태, 이유를 쓴다.",
    vocab: "문맥상 낱말 쓰임이 적절하지 않은 것을 고르는 문제. passage에서 내용어 5곳에 <u>①단어</u> … <u>⑤단어</u> 형식으로 번호와 밑줄을 넣는다. 그중 정확히 1곳만 문맥과 반대되거나 어울리지 않는 낱말(주로 반의어)로 바꾸고 나머지는 원문 그대로 둔다. choices는 null. explanation에 원래 낱말을 쓴다.",
    implied: "밑줄 친 함축적 의미를 묻는 문제. passage에서 비유적이거나 함축적인 표현 하나에 <u>…</u> 밑줄을 넣는다(나머지는 원문 그대로). instruction은 '밑줄 친 <표현>이 다음 글에서 의미하는 바로 가장 적절한 것은?'처럼 그 표현을 넣어 쓴다. choices는 영어 5개(문장 또는 구).",
    blank: "빈칸 추론 문제. passage에서 글의 핵심을 담은 단어·구·절 하나를 ________________ 로 바꾼다(나머지는 원문 그대로). choices는 영어 5개이며 정답은 원문 표현이나 같은 뜻의 바꿔 쓴 표현. 오답은 그럴듯하지만 글의 논리와 맞지 않게 만든다.",
    summary: "요약문 완성 문제. passage는 원문 그대로. box에 글 전체를 요약한 영어 한 문장을 쓰고, 핵심어 두 곳을 (A) ________ 와 (B) ________ 로 비운다. boxFirst는 false. choices는 5개이며 각 항목은 '(A)에 들어갈 말 …… (B)에 들어갈 말' 형식(예: 'flexible …… reduced'). 정답 단어는 본문에 그대로 나오지 않는 바꿔 쓴 말이 좋다.",
    compose: "우리말 영작 문제. passage에서 한 문장(또는 절)을 골라 그 자리를 '(A) <u>그 문장의 자연스러운 한국어 번역</u>'으로 바꾼다. box에는 '<조건>'으로 시작하는 조건 2~3줄(예: 주어진 단어 사용, 단어 수, 필수 어법)을 줄바꿈(\\n)으로 나눠 쓴다. boxFirst는 false. choices는 null. answer는 원문 영어 문장.",
    fix: "어법 오류를 찾아 고치는 서술형 문제. passage에서 8곳에 <u>(a)단어</u> … <u>(h)단어</u> 형식으로 기호와 밑줄을 넣고, 그중 3곳만 어법상 틀리게 바꾼다(나머지는 원문 그대로). choices는 null. answer는 '(b) is → are, (e) using → used, (g) which → where' 형식."
  };

  function buildPrompt(passage, typeKey, count) {
    var t = TYPE_BY_KEY[typeKey];
    if (!t || t.mode !== "ai") throw new Error("AI 유형이 아닙니다: " + typeKey);
    return [
      "당신은 한국 고등학교 영어 교사로, 수능·모의고사 형식의 영어 변형문제를 만듭니다.",
      "아래 지문으로 [" + t.name + "] 유형 문제를 " + count + "개 만드세요.",
      "",
      "## 유형 설명",
      AI_SPECS[typeKey],
      "",
      "## 공통 규칙",
      "- 기본 발문: " + t.instruction,
      "- 여러 문제를 만들 때는 문제마다 선지·밑줄 위치·정답 번호가 서로 달라야 합니다.",
      "- 객관식 정답은 ①~⑤ 중 하나로 쓰고, 여러 문제의 정답 번호가 한쪽으로 몰리지 않게 합니다.",
      "- 밑줄은 <u>…</u>, 굵은 글씨는 <b>…</b> 태그만 씁니다. 다른 태그나 마크다운은 쓰지 않습니다.",
      "- 문단을 나눌 때는 \\n 을 씁니다.",
      "- explanation은 한국어 1~2문장으로 씁니다.",
      "",
      "## 출력 형식",
      "설명 없이 JSON만 출력합니다.",
      '{"problems":[{"instruction":"발문","box":"상자에 넣을 글 또는 null","boxFirst":true,"passage":"지문","choices":["…","…","…","…","…"] 또는 null,"answer":"③","explanation":"해설"}]}',
      "",
      "## 지문",
      normalizeText(passage).trim()
    ].join("\n");
  }

  function buildCombinedPrompt(passage, requests) {
    var parts = requests.map(function (r) {
      var t = TYPE_BY_KEY[r.type];
      return "### " + t.name + " (" + r.count + "문제, type 값: \"" + r.type + "\")\n- 기본 발문: " + t.instruction + "\n- " + AI_SPECS[r.type];
    });
    return [
      "당신은 한국 고등학교 영어 교사로, 수능·모의고사 형식의 영어 변형문제를 만듭니다.",
      "아래 지문으로 다음 유형의 문제를 만드세요.",
      "",
      parts.join("\n\n"),
      "",
      "## 공통 규칙",
      "- 같은 유형의 문제끼리는 선지·밑줄 위치·정답 번호가 서로 달라야 합니다.",
      "- 객관식 정답은 ①~⑤ 중 하나로 쓰고, 정답 번호가 한쪽으로 몰리지 않게 합니다.",
      "- 밑줄은 <u>…</u>, 굵은 글씨는 <b>…</b> 태그만 씁니다. 다른 태그나 마크다운은 쓰지 않습니다.",
      "- 문단을 나눌 때는 \\n 을 씁니다. explanation은 한국어 1~2문장.",
      "",
      "## 출력 형식",
      "설명 없이 JSON만 출력합니다. 각 문제에 type 값을 반드시 넣습니다.",
      '{"problems":[{"type":"topic","instruction":"발문","box":null,"boxFirst":true,"passage":"지문","choices":["…","…","…","…","…"],"answer":"③","explanation":"해설"}]}',
      "",
      "## 지문",
      normalizeText(passage).trim()
    ].join("\n");
  }

  // ---------- AI 답변 읽기 ----------

  function extractJson(text) {
    if (text && typeof text === "object") return text;
    var s = String(text || "").trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* 아래에서 다시 시도 */ }
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { /* 실패 */ }
    }
    throw new Error("AI 답변에서 JSON을 찾지 못했습니다. 답변 전체를 그대로 붙여 넣었는지 확인하세요.");
  }

  function normalizeAnswer(ans) {
    var s = String(ans == null ? "" : ans).trim();
    if (/^[1-5]$/.test(s)) return CIRCLED[Number(s) - 1];
    return s;
  }

  // AI 답변을 문제 목록으로 바꾼다. fallbackType은 type이 빠진 경우에 쓴다.
  function parseAiProblems(text, fallbackType) {
    var data = extractJson(text);
    var list = Array.isArray(data) ? data : data.problems;
    if (!Array.isArray(list)) throw new Error("AI 답변에 problems 목록이 없습니다.");
    var warnings = [];
    var problems = list.map(function (p, i) {
      var type = TYPE_BY_KEY[p.type] ? p.type : fallbackType;
      if (!TYPE_BY_KEY[type]) throw new Error((i + 1) + "번째 문제의 유형(type)을 알 수 없습니다.");
      var choices = Array.isArray(p.choices) && p.choices.length ? p.choices.map(String) : null;
      var label = TYPE_BY_KEY[type].name + " " + (i + 1) + "번째 문제";
      if (choices && choices.length !== 5) warnings.push(label + ": 선지가 " + choices.length + "개입니다.");
      if (!p.answer) warnings.push(label + ": 정답이 비어 있습니다.");
      if (!p.passage) warnings.push(label + ": 지문이 비어 있습니다.");
      return {
        type: type,
        instruction: p.instruction ? String(p.instruction) : TYPE_BY_KEY[type].instruction,
        box: p.box ? String(p.box) : null,
        boxFirst: p.boxFirst !== false,
        passage: String(p.passage || ""),
        choices: choices,
        answer: normalizeAnswer(p.answer),
        explanation: p.explanation ? String(p.explanation) : ""
      };
    });
    return { problems: problems, warnings: warnings };
  }

  // ---------- 서식 문자열 (<u>, <b>) ----------

  // "a <u>b</u> <b>c</b>" → [{text, u, b}, ...]. 다른 태그는 글자 그대로 둔다.
  function parseRuns(str) {
    var runs = [];
    var u = 0, b = 0;
    var re = /<(\/?)([ub])>/gi;
    var last = 0, m;
    str = String(str || "");
    function push(text) {
      if (!text) return;
      var prev = runs[runs.length - 1];
      if (prev && prev.u === (u > 0) && prev.b === (b > 0)) prev.text += text;
      else runs.push({ text: text, u: u > 0, b: b > 0 });
    }
    while ((m = re.exec(str)) !== null) {
      push(str.slice(last, m.index));
      var d = m[1] ? -1 : 1;
      if (m[2].toLowerCase() === "u") u = Math.max(0, u + d); else b = Math.max(0, b + d);
      last = m.index + m[0].length;
    }
    push(str.slice(last));
    return runs;
  }

  // ---------- 문서 구성 ----------

  // 문제지를 서식 블록 목록으로 바꾼다. HTML 미리보기와 HWPX가 같은 블록을 쓴다.
  // 블록: {kind: "title"|"question"|"box"|"para"|"choice"|"answer"|"pagebreak", runs}
  function buildBlocks(doc) {
    var blocks = [];
    var opts = doc.options || {};
    blocks.push({ kind: "title", runs: [{ text: doc.title || "영어 변형문제", u: false, b: true }] });
    if (doc.subtitle) blocks.push({ kind: "subtitle", runs: [{ text: doc.subtitle, u: false, b: false }] });
    doc.problems.forEach(function (p, i) {
      blocks.push({ kind: "question", runs: [{ text: (i + 1) + ". ", u: false, b: true }].concat(parseRuns(p.instruction).map(function (r) { return { text: r.text, u: r.u, b: true }; })) });
      var boxBlocks = p.box ? String(p.box).split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "box", runs: parseRuns(l) }; }) : [];
      var paraBlocks = String(p.passage || "").split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "para", runs: parseRuns(l) }; });
      if (p.boxFirst) blocks.push.apply(blocks, boxBlocks.concat(paraBlocks));
      else blocks.push.apply(blocks, paraBlocks.concat(boxBlocks));
      if (p.choices) {
        p.choices.forEach(function (c, ci) {
          blocks.push({ kind: "choice", runs: [{ text: CIRCLED[ci] + " ", u: false, b: false }].concat(parseRuns(c)) });
        });
      }
      if (p.type === "arrange" || p.type === "compose" || p.type === "fix") {
        blocks.push({ kind: "para", runs: [{ text: "답: ______________________________________________", u: false, b: false }] });
      }
    });
    if (opts.answers !== false) {
      blocks.push({ kind: "pagebreak", runs: [] });
      blocks.push({ kind: "title", runs: [{ text: "정답" + (opts.explanations ? " 및 해설" : ""), u: false, b: true }] });
      doc.problems.forEach(function (p, i) {
        var runs = [{ text: (i + 1) + ". ", u: false, b: true }, { text: p.answer || "-", u: false, b: true }];
        if (opts.explanations && p.explanation) runs = runs.concat([{ text: "  " }]).concat(parseRuns(p.explanation));
        blocks.push({ kind: "answer", runs: runs.map(function (r) { return { text: r.text, u: !!r.u, b: !!r.b }; }) });
      });
    }
    return blocks;
  }

  // ---------- HWPX ----------

  function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 글자 모양 번호 (hwpx-template.js의 header.xml 참고)
  function charId(run, kind) {
    if (kind === "title") return 10;
    if (kind === "subtitle") return 11;
    if (run.b && run.u) return 9;
    if (run.u) return 8;
    if (run.b) return 7;
    return 0;
  }

  var PARA_ID = { title: 22, subtitle: 22, question: 23, box: 20, para: 0, choice: 21, answer: 0, pagebreak: 0 };

  function buildSectionXml(template, blocks, opts) {
    opts = opts || {};
    var secPr = template.__secPr;
    if (opts.columns === 2) secPr = secPr.replace('colCount="1" sameSz="1" sameGap="0"', 'colCount="2" sameSz="1" sameGap="2268"');
    var xml = [template.__secHead];
    var pid = 1;
    var pendingBreak = false;
    xml.push(secPr + "</hp:p>"); // secPr 조각은 첫 문단의 여는 태그부터 들어 있다
    blocks.forEach(function (bl) {
      if (bl.kind === "pagebreak") { pendingBreak = true; return; }
      var runs = bl.runs.length ? bl.runs : [{ text: "" }];
      var body = runs.map(function (r) {
        return '<hp:run charPrIDRef="' + charId(r, bl.kind) + '"><hp:t>' + xmlEscape(r.text) + "</hp:t></hp:run>";
      }).join("");
      xml.push('<hp:p id="' + (pid++) + '" paraPrIDRef="' + PARA_ID[bl.kind] + '" styleIDRef="0" pageBreak="' + (pendingBreak ? 1 : 0) + '" columnBreak="0" merged="0">' + body + "</hp:p>");
      pendingBreak = false;
    });
    xml.push("</hs:sec>");
    return xml.join("");
  }

  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, "utf8"));
  }

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // 압축하지 않은(STORE) zip 파일을 만든다. HWPX는 mimetype이 맨 앞, 무압축이어야 한다.
  function makeZip(files) {
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    var DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = typeof f.data === "string" ? utf8(f.data) : f.data;
      var crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      chunks.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  function buildHwpx(template, doc) {
    var blocks = buildBlocks(doc);
    var section = buildSectionXml(template, blocks, doc.options);
    var preview = blocks.map(function (b) { return b.runs.map(function (r) { return r.text; }).join(""); }).join("\n").slice(0, 1000);
    var hpf = template["Contents/content.hpf"].replace("<opf:title/>", "<opf:title>" + xmlEscape(doc.title || "") + "</opf:title>");
    var order = ["mimetype", "version.xml", "Contents/header.xml", "Contents/section0.xml", "settings.xml", "Preview/PrvText.txt", "META-INF/container.rdf", "Contents/content.hpf", "META-INF/container.xml", "META-INF/manifest.xml"];
    var contents = {
      "Contents/section0.xml": section,
      "Preview/PrvText.txt": preview,
      "Contents/content.hpf": hpf
    };
    return makeZip(order.map(function (name) {
      return { name: name, data: contents[name] !== undefined ? contents[name] : template[name] };
    }));
  }

  var VM = {
    CIRCLED: CIRCLED,
    TYPES: TYPES,
    TYPE_BY_KEY: TYPE_BY_KEY,
    makeRng: makeRng,
    splitSentences: splitSentences,
    makeOrder: makeOrder,
    makeInsert: makeInsert,
    makeArrange: makeArrange,
    AUTO_MAKERS: AUTO_MAKERS,
    buildPrompt: buildPrompt,
    buildCombinedPrompt: buildCombinedPrompt,
    parseAiProblems: parseAiProblems,
    parseRuns: parseRuns,
    buildBlocks: buildBlocks,
    buildSectionXml: buildSectionXml,
    makeZip: makeZip,
    crc32: crc32,
    buildHwpx: buildHwpx
  };

  if (typeof module !== "undefined" && module.exports) module.exports = VM;
  else root.VM = VM;
})(this);
