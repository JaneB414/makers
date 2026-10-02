// 변형문제 메이커 핵심 로직 (화면과 무관한 부분).
// 브라우저에서는 전역 VM으로, Node 테스트에서는 require로 쓴다.
(function (root) {
  "use strict";

  var CIRCLED = ["①", "②", "③", "④", "⑤"];

  // 문제지에 실리는 유형 순서
  var TYPES = [
    { key: "claim", name: "주장", mode: "ai", instruction: "다음 글에서 필자가 주장하는 바로 가장 적절한 것은?" },
    { key: "gist", name: "요지", mode: "ai", instruction: "다음 글의 요지로 가장 적절한 것은?" },
    { key: "topic", name: "주제", mode: "ai", instruction: "다음 글의 주제로 가장 적절한 것은?" },
    { key: "title", name: "제목", mode: "ai", instruction: "다음 글의 제목으로 가장 적절한 것은?" },
    { key: "implied", name: "함축적 의미", mode: "ai", instruction: "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" },
    { key: "grammar", name: "어법", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?" },
    { key: "vocab", name: "어휘", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?" },
    { key: "blank", name: "빈칸", mode: "ai", instruction: "다음 빈칸에 들어갈 말로 가장 적절한 것을 고르시오." },
    { key: "order", name: "순서", mode: "auto", instruction: "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오." },
    { key: "insert", name: "문장삽입", mode: "auto", instruction: "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오." },
    { key: "summary", name: "요약", mode: "ai", instruction: "다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?" },
    { key: "fix", name: "어법 오류 고치기", mode: "ai", instruction: "다음 글의 밑줄 친 부분 중 어법상 틀린 것을 모두 찾아 기호를 쓰고 바르게 고치시오." },
    { key: "arrange", name: "서술형 문장배열", mode: "auto", instruction: "다음 글의 빈칸 (A)에 들어갈 말을 <보기>의 단어를 모두 한 번씩 사용하여 바르게 배열하시오." },
    { key: "compose", name: "한글 문장 영작", mode: "ai", instruction: "다음 글의 밑줄 친 우리말 (A)를 <조건>에 맞게 영작하시오." }
  ];

  var TYPE_BY_KEY = {};
  TYPES.forEach(function (t, i) { t.order = i; TYPE_BY_KEY[t.key] = t; });

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

  // 정답 번호 뽑개: ①~⑤를 섞어 한 바퀴씩 돌려준다. 여러 지문에 같은 뽑개를 쓰면 전체에서 정답이 골고루 나온다.
  function answerDeck(rng) {
    var bag = [];
    return function () {
      if (!bag.length) bag = rng.shuffle(range(5));
      return bag.pop();
    };
  }

  function makeOrder(sentences, count, rng, deck) {
    var n = sentences.length;
    if (n < 4) throw new Error("순서 문제는 문장이 4개 이상 필요합니다. (지금 " + n + "개)");
    var configs = rng.shuffle(orderConfigs(n));
    var answers = deck ? range(count).map(function () { return deck(); }) : spreadAnswers(count, 5, rng);
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

  function makeInsert(sentences, count, rng, deck) {
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
    // 자리 번호 p(1..slots)는 남은 문장 p번째 바로 뒤. 정답 자리는 removed.
    function slotRange(removed) { return { lo: Math.max(1, removed - markers + 1), hi: Math.min(removed, slots - markers + 1) }; }
    var used = [];
    for (var k = 0; k < count; k++) {
      var removed, startSlot;
      if (deck) {
        // 뽑개가 정한 정답 번호를 만들 수 있는 문장을 앞에서부터 고른다(없으면 가장 가까운 번호).
        var want = deck();
        var fresh = order.filter(function (i) { return used.indexOf(i) < 0; });
        if (!fresh.length) { used = []; fresh = order; }
        removed = fresh.filter(function (i) { var w = slotRange(i); return i - want >= w.lo && i - want <= w.hi; })[0];
        if (removed === undefined) removed = fresh[0];
        var w = slotRange(removed);
        startSlot = Math.max(w.lo, Math.min(w.hi, removed - want));
      } else {
        removed = order[k % order.length];
        var w2 = slotRange(removed);
        startSlot = rng.int(w2.lo, w2.hi);
      }
      used.push(removed);
      var remaining = sentences.filter(function (_, i) { return i !== removed; });
      problems.push({
        type: "insert",
        instruction: TYPE_BY_KEY.insert.instruction,
        box: sentences[removed],
        boxFirst: true,
        passage: insertPassage(remaining, startSlot, markers),
        choices: null,
        answer: CIRCLED[removed - startSlot],
        explanation: "주어진 문장은 \"" + shorten(sentences[removed - 1], 60) + "\" 다음에 온다.",
        meta: { remaining: remaining, removed: removed, markers: markers } // 정답 번호를 나중에 옮길 때 쓴다
      });
    }
    return problems;
  }

  // 남은 문장 사이에 ( ① )~( ⑤ ) 자리 표시를 넣는다. 자리 p(1..)는 p번째 문장 바로 뒤.
  function insertPassage(remaining, startSlot, markers) {
    var parts = [];
    for (var i = 0; i < remaining.length; i++) {
      parts.push(remaining[i]);
      var p = i + 1;
      if (p >= startSlot && p < startSlot + markers) parts.push("( " + CIRCLED[p - startSlot] + " )");
    }
    return parts.join(" ");
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

  // 여러 지문과 여러 유형을 한 번에 요청하는 요청문 (Claude 채팅에 붙여 넣는 용도)
  function buildCombinedPrompt(passages, requests) {
    var parts = requests.map(function (r) {
      var t = TYPE_BY_KEY[r.type];
      return "### " + t.name + " (지문마다 " + r.count + "문제, type 값: \"" + r.type + "\")\n- 기본 발문: " + t.instruction + "\n- " + AI_SPECS[r.type];
    });
    var texts = passages.map(function (p, i) {
      var id = p.no || String(i + 1);
      return "### 지문 [" + id + "]\n" + normalizeText(p.text).trim();
    });
    return [
      "당신은 한국 고등학교 영어 교사로, 수능·모의고사 형식의 영어 변형문제를 만듭니다.",
      "아래 " + passages.length + "개 지문 각각으로 다음 유형의 문제를 만드세요.",
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
      "설명 없이 JSON만 출력합니다. 각 문제에 type 값과, 어느 지문으로 만들었는지 src 값(지문 [ ] 안의 번호)을 반드시 넣습니다.",
      '{"problems":[{"src":"' + (passages[0].no || "1") + '","type":"topic","instruction":"발문","box":null,"boxFirst":true,"passage":"지문","choices":["…","…","…","…","…"],"answer":"③","explanation":"해설"}]}',
      "",
      "## 지문",
      texts.join("\n\n")
    ].join("\n");
  }

  // ---------- 지문 여러 개 한꺼번에 등록 ----------

  // 번호 줄: "[18]", "[41-42]", "[3강 1번]", "18번"
  var PASSAGE_MARK = /^\s*(?:\[\s*([^\]\n]{1,20}?)\s*\]|(\d{1,3}(?:\s*[-~]\s*\d{1,3})?)\s*번)\s*[.:)]?\s*$/;
  var NUMERIC_NO = /^\d+(?:-\d+)?$/;

  // "41 ~ 42번" → "41-42", "3강  1번" → "3강 1번"
  function normalizeNo(no) {
    var s = String(no == null ? "" : no).trim().replace(/\s+/g, " ").replace(/\s*[-~]\s*/g, "-");
    var m = s.match(/^(\d+(?:-\d+)?)\s*번$/);
    return m ? m[1] : s;
  }

  // 화면과 문제지에 쓰는 지문 번호: 숫자면 "29번", 아니면 그대로
  function noLabel(no) {
    return NUMERIC_NO.test(no) ? no + "번" : String(no || "");
  }

  // "[18]" 또는 "18번" 줄로 시작하는 지문들을 나눈다.
  function parseBulkPassages(text) {
    var out = [], current = null;
    normalizeText(text).split("\n").forEach(function (line) {
      var m = line.match(PASSAGE_MARK);
      if (m) {
        current = { no: normalizeNo(m[1] || m[2]), lines: [] };
        out.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    });
    return out.map(function (p) { return { no: p.no, text: p.lines.join("\n").trim() }; })
      .filter(function (p) { return p.text; });
  }

  // ---------- AI 답변 읽기 ----------

  // 글 속에 들어 있는 JSON 값들을 모두 꺼낸다. 답변 여러 개를 이어 붙여도 읽을 수 있다.
  function extractJsonAll(text) {
    if (text && typeof text === "object") return [text];
    var s = String(text || "").replace(/```(?:json)?/g, "");
    var found = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] !== "{") continue;
      var depth = 0, inStr = false, esc = false, j = i;
      for (; j < s.length; j++) {
        var c = s[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === "\"") inStr = false;
        } else if (c === "\"") inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) break;
      try { found.push(JSON.parse(s.slice(i, j + 1))); i = j; } catch (e) { /* 다음 { 부터 다시 */ }
    }
    if (!found.length) throw new Error("AI 답변에서 JSON을 찾지 못했습니다. 답변 전체를 그대로 붙여 넣었는지 확인하세요.");
    return found;
  }

  function normalizeAnswer(ans) {
    var s = String(ans == null ? "" : ans).trim();
    if (/^[1-5]$/.test(s)) return CIRCLED[Number(s) - 1];
    return s;
  }

  // AI 답변을 문제 목록으로 바꾼다.
  // ctx: {type: 기본 유형, exam: 시험 이름, no: 기본 지문 번호}
  function parseAiProblems(text, ctx) {
    if (typeof ctx === "string" || ctx == null) ctx = { type: ctx };
    var list = [];
    extractJsonAll(text).forEach(function (data) {
      var items = Array.isArray(data) ? data : data.problems;
      if (Array.isArray(items)) list = list.concat(items);
    });
    if (!list.length) throw new Error("AI 답변에 problems 목록이 없습니다.");
    var warnings = [];
    var problems = list.map(function (p, i) {
      var type = TYPE_BY_KEY[p.type] ? p.type : ctx.type;
      if (!TYPE_BY_KEY[type]) throw new Error((i + 1) + "번째 문제의 유형(type)을 알 수 없습니다.");
      var choices = Array.isArray(p.choices) && p.choices.length ? p.choices.map(String) : null;
      var label = TYPE_BY_KEY[type].name + " " + (i + 1) + "번째 문제";
      if (choices && choices.length !== 5) warnings.push(label + ": 선지가 " + choices.length + "개입니다.");
      if (!p.answer) warnings.push(label + ": 정답이 비어 있습니다.");
      if (!p.passage) warnings.push(label + ": 지문이 비어 있습니다.");
      var no = normalizeNo(p.src != null ? p.src : ctx.no);
      return {
        type: type,
        instruction: p.instruction ? String(p.instruction) : TYPE_BY_KEY[type].instruction,
        box: p.box ? String(p.box) : null,
        boxFirst: p.boxFirst !== false,
        passage: String(p.passage || ""),
        choices: choices,
        answer: normalizeAnswer(p.answer),
        explanation: p.explanation ? String(p.explanation) : "",
        source: no ? { exam: ctx.exam || "", no: no } : null
      };
    });
    return { problems: problems, warnings: warnings };
  }

  // ---------- 문제 정렬 ----------

  // 문제를 정렬하고 각 문제에 회차(round, 0부터)를 매긴다.
  // 회차: 같은 지문·같은 유형에서 몇 번째로 만든 문제인가.
  // 기본: 유형 → 회차 → 지문 순서. 즉 유형 안에서 지문들이 1회차, 2회차… 로 번갈아 나온다.
  // roundsFirst: 회차 → 유형 → 지문 순서. 1회차 시험지 전체, 2회차 시험지 전체로 나뉜다.
  // passageRank(source)는 지문의 순서 번호를 돌려준다. 같으면 원래 순서를 지킨다.
  function sortProblems(problems, passageRank, roundsFirst) {
    var seen = {};
    function typeRank(p) { return TYPE_BY_KEY[p.type] ? TYPE_BY_KEY[p.type].order : TYPES.length; }
    function srcRank(p) {
      var r = p.source && passageRank ? passageRank(p.source) : null;
      return r == null ? Infinity : r;
    }
    function cmp(a, b) { return a === b ? 0 : a < b ? -1 : 1; }
    return problems.map(function (p, i) {
      var key = p.type + "\u0001" + (p.source ? (p.source.exam || "") + "\u0001" + p.source.no : "#" + i);
      var r = seen[key] || 0;
      seen[key] = r + 1;
      p.round = r;
      return { p: p, i: i, t: typeRank(p), s: srcRank(p), r: r };
    }).sort(function (a, b) {
      return (roundsFirst ? a.r - b.r || a.t - b.t : a.t - b.t || a.r - b.r) || cmp(a.s, b.s) || a.i - b.i;
    }).map(function (x) { return x.p; });
  }

  // ---------- 정답 번호 고르게 ----------

  // 이 문제의 정답을 옮길 수 있는 번호(0~4) 목록. 옮길 수 없으면 빈 목록.
  // - 선지가 5개인 객관식: 선지 순서를 바꿔 어느 번호로든 옮긴다.
  // - 순서: (A)(B)(C) 이름표를 바꿔 어느 번호로든 옮긴다.
  // - 문장삽입: 자리 표시 ①~⑤의 시작 위치를 옮길 수 있는 만큼.
  // - 어법·어휘처럼 지문 속에 번호가 박힌 문제와 서술형은 옮기지 않는다.
  function answerOptions(p) {
    var cur = CIRCLED.indexOf(p.answer);
    if (cur < 0) return [];
    if (p.type === "order") return /^\(A\) /m.test(p.passage || "") ? range(5) : [];
    if (p.type === "insert") {
      var m = p.meta;
      if (!m || !m.remaining) return [];
      var slots = m.remaining.length;
      return range(m.markers).filter(function (t) {
        var start = m.removed - t;
        return start >= Math.max(1, m.removed - m.markers + 1) && start <= Math.min(m.removed, slots - m.markers + 1);
      });
    }
    if (p.choices && p.choices.length === 5 && (p.type !== "grammar" && p.type !== "vocab")) return range(5);
    return [];
  }

  // 정답을 t번(0~4)으로 옮긴다. 해설 속 원문자 번호도 함께 바꾼다.
  function moveAnswer(p, t) {
    var cur = CIRCLED.indexOf(p.answer);
    if (cur < 0 || cur === t) return p;
    if (p.type === "order") {
      var byLabel = {};
      String(p.passage).split("\n").forEach(function (line) { byLabel[line.slice(0, 3)] = line.slice(4); });
      var oldPerm = ORDER_PERMS[cur], newPerm = ORDER_PERMS[t];
      var chunks = oldPerm.map(function (li) { return byLabel[LABELS[li]]; }); // 실제 순서대로의 덩어리
      var relabeled = [];
      for (var pos = 0; pos < 3; pos++) relabeled[newPerm[pos]] = chunks[pos];
      p.passage = relabeled.map(function (text, li) { return LABELS[li] + " " + text; }).join("\n");
      p.explanation = "주어진 글 → " + newPerm.map(function (x) { return LABELS[x]; }).join(" → ");
    } else if (p.type === "insert") {
      p.passage = insertPassage(p.meta.remaining, p.meta.removed - t, p.meta.markers);
    } else {
      var tmp = p.choices[cur];
      p.choices[cur] = p.choices[t];
      p.choices[t] = tmp;
      if (p.explanation) {
        p.explanation = p.explanation.replace(/[①-⑤]/g, function (c) {
          var i = CIRCLED.indexOf(c);
          return i === cur ? CIRCLED[t] : i === t ? CIRCLED[cur] : c;
        });
      }
    }
    p.answer = CIRCLED[t];
    return p;
  }

  function sourceKey(p) {
    return p.source ? (p.source.exam || "") + "\u0001" + p.source.no + "\u0001" + (p.round || 0) : null;
  }

  // 문제지 전체에서 정답 번호가 ①~⑤ 골고루 나오도록 맞춘다. problems는 문제지 순서대로.
  // shouldMove(p)가 참인 문제만 옮기고, 나머지는 있는 그대로 개수에 넣는다.
  // 고르는 기준(작을수록 좋음): 같은 지문(같은 회차)에 이미 있는 번호는 크게 피하고, 그다음 지금까지 덜 나온 번호, 앞뒤 문제와 다른 번호를 고른다.
  function balanceAnswers(problems, shouldMove, rng) {
    rng = rng || makeRng();
    var counts = [0, 0, 0, 0, 0];
    var bySource = {};
    function note(p) {
      var a = CIRCLED.indexOf(p.answer);
      if (a < 0) return;
      counts[a]++;
      var k = sourceKey(p);
      if (k) (bySource[k] = bySource[k] || {})[a] = true;
    }
    var movable = [];
    problems.forEach(function (p) {
      if (shouldMove && !shouldMove(p)) note(p);
      else if (answerOptions(p).length > 1) movable.push(p);
      else note(p);
    });
    problems.forEach(function (p, i) {
      if (movable.indexOf(p) < 0) return;
      var prev = i > 0 ? CIRCLED.indexOf(problems[i - 1].answer) : -1;
      var next = i < problems.length - 1 && movable.indexOf(problems[i + 1]) < 0 ? CIRCLED.indexOf(problems[i + 1].answer) : -1;
      var same = bySource[sourceKey(p)] || {};
      var best = null, bestScore = Infinity;
      answerOptions(p).forEach(function (t) {
        var score = counts[t] * 100 + (same[t] ? 150 : 0) + (t === prev || t === next ? 5 : 0) + rng.next();
        if (score < bestScore) { bestScore = score; best = t; }
      });
      moveAnswer(p, best);
      note(p);
    });
    return counts;
  }

  // 정답 번호별 개수 [①, ②, ③, ④, ⑤]
  function answerCounts(problems) {
    var c = [0, 0, 0, 0, 0];
    problems.forEach(function (p) { var a = CIRCLED.indexOf(p.answer); if (a >= 0) c[a]++; });
    return c;
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

  // 원문 번호 표시. 문제지에 여러 시험의 지문이 섞여 있으면 시험 이름도 붙인다.
  function sourceLabels(problems) {
    var exams = {};
    problems.forEach(function (p) { if (p.source && p.source.no) exams[p.source.exam || ""] = true; });
    var mixed = Object.keys(exams).length > 1;
    return problems.map(function (p) {
      if (!p.source || !p.source.no) return "";
      return (mixed && p.source.exam ? p.source.exam + " · " : "") + noLabel(p.source.no);
    });
  }

  var WRITE_TYPES = { arrange: true, compose: true, fix: true };

  // 문제지를 서식 블록 목록으로 바꾼다. 화면 미리보기·PDF·HWPX·DOCX가 모두 같은 블록을 쓴다.
  // 블록: {kind, runs, first?}. run: {text, u, b, role?, tab?}
  // kind: eyebrow title nameLine | src ask box para choice answerLine | pagebreak ansTitle ans
  function buildBlocks(doc) {
    var blocks = [];
    var opts = doc.options || {};
    var layout = doc.layout || {};
    function plain(text, role) { var r = { text: text, u: false, b: false }; if (role) r.role = role; return r; }

    if (layout.eyebrow) blocks.push({ kind: "eyebrow", runs: [plain(layout.eyebrow)] });
    blocks.push({ kind: "title", runs: [plain(doc.title || "영어 변형문제")] });
    blocks.push({ kind: "nameLine", runs: [plain(layout.showName === false ? "" : "반 ________   번호 ________   이름 ________________")] });

    var labels = sourceLabels(doc.problems);
    // 회차 나누기: 회차마다 제목을 달고(2회차부터 새 쪽), 문항 번호를 1부터 다시 센다.
    var byRound = !!opts.rounds && doc.problems.some(function (p) { return p.round > 0; });
    var nums = [], lastRound = null, n = 0;
    doc.problems.forEach(function (p) {
      var r = p.round || 0;
      if (byRound && r !== lastRound) { n = 0; lastRound = r; }
      nums.push(++n);
    });
    lastRound = null;
    doc.problems.forEach(function (p, i) {
      if (byRound && (p.round || 0) !== lastRound) {
        if (lastRound !== null) blocks.push({ kind: "pagebreak", runs: [] });
        lastRound = p.round || 0;
        blocks.push({ kind: "roundTitle", runs: [plain((lastRound + 1) + "회차")] });
      }
      if (labels[i]) blocks.push({ kind: "src", runs: [plain(labels[i])] });
      blocks.push({
        kind: "ask",
        first: !labels[i],
        runs: [plain(String(nums[i]), "num"), { text: "", u: false, b: false, tab: true }].concat(parseRuns(p.instruction))
      });
      var boxBlocks = p.box ? String(p.box).split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "box", runs: parseRuns(l) }; }) : [];
      var paraBlocks = String(p.passage || "").split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "para", runs: parseRuns(l) }; });
      if (p.boxFirst) blocks.push.apply(blocks, boxBlocks.concat(paraBlocks));
      else blocks.push.apply(blocks, paraBlocks.concat(boxBlocks));
      if (p.choices) {
        p.choices.forEach(function (c, ci) {
          blocks.push({ kind: "choice", runs: [plain(CIRCLED[ci] + " ")].concat(parseRuns(c)) });
        });
      }
      if (WRITE_TYPES[p.type]) blocks.push({ kind: "answerLine", runs: [plain("답: ______________________________________")] });
    });

    if (opts.answers !== false && doc.problems.length) {
      blocks.push({ kind: "pagebreak", runs: [] });
      blocks.push({ kind: "ansTitle", runs: [plain("정답" + (opts.explanations ? " 및 해설" : ""))] });
      lastRound = null;
      doc.problems.forEach(function (p, i) {
        if (byRound && (p.round || 0) !== lastRound) {
          lastRound = p.round || 0;
          blocks.push({ kind: "ans", round: true, runs: [plain("[" + (lastRound + 1) + "회차]", "ansNum")] });
        }
        var runs = [plain(nums[i] + ")", "ansNum"), plain(" ")].concat(parseRuns(p.answer || "-"));
        if (opts.explanations && p.explanation) {
          runs.push(plain("  "));
          runs = runs.concat(parseRuns(p.explanation).map(function (r) { r.role = "explain"; return r; }));
        }
        blocks.push({ kind: "ans", runs: runs });
      });
    }
    return blocks;
  }

  // ---------- HWPX ----------

  function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var KIND_CHAR = {
    eyebrow: "eyebrow", title: "title", nameLine: "name", src: "src", ask: "ask",
    box: "body", para: "body", choice: "body", answerLine: "body", ansTitle: "ansTitle", ans: "ans", roundTitle: "ansTitle"
  };
  var KIND_PARA = {
    eyebrow: "eyebrow", title: "title", nameLine: "nameLine", src: "src", ask: "ask",
    box: "box", para: "body", choice: "choice", answerLine: "answerLine", ansTitle: "ansTitle", ans: "ans", roundTitle: "ansTitle"
  };

  // 굵게·밑줄 조합이 있는 글자 모양이면 그것을, 없으면 가장 가까운 것을 쓴다.
  function styleName(table, base, run) {
    var tries = [base + (run.b ? "B" : "") + (run.u ? "U" : ""), base + (run.u ? "U" : ""), base + (run.b ? "B" : ""), base];
    for (var i = 0; i < tries.length; i++) if (table[tries[i]] !== undefined) return tries[i];
    return base;
  }

  function hwpxRuns(style, runs, kind) {
    return runs.map(function (r) {
      var id = style.char[styleName(style.char, r.role || KIND_CHAR[kind], r)];
      if (r.tab) return '<hp:run charPrIDRef="' + id + '"><hp:t><hp:tab/></hp:t></hp:run>';
      if (r.pageNum) return '<hp:run charPrIDRef="' + id + '"><hp:ctrl><hp:autoNum num="1" numType="PAGE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl></hp:run>';
      return '<hp:run charPrIDRef="' + id + '"><hp:t>' + xmlEscape(r.text) + "</hp:t></hp:run>";
    }).join("");
  }

  function colPrXml(count, rule) {
    if (count === 2) {
      return '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="2" sameSz="1" sameGap="1984"><hp:colLine type="SOLID" width="0.12 mm" color="' + rule + '"/></hp:colPr></hp:ctrl>';
    }
    return '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
  }

  // 머리말·꼬리말 한 줄: 왼쪽 글 [가운데 탭] 가운데 [오른쪽 탭] 오른쪽 글
  function hfRuns(left, center, right) {
    var tab = { text: "", tab: true, role: "hf" };
    return [{ text: left || "", role: "hf" }, tab].concat(center, [tab, { text: right || "", role: "hf" }]);
  }

  function buildSectionXml(template, blocks, doc) {
    var style = template.__style;
    var layout = (doc && doc.layout) || {};
    var columns = doc && doc.options && doc.options.columns === 1 ? 1 : 2;
    var pid = 1;
    function p(kind, runsXml, extra) {
      var para = kind === "ask" && extra && extra.first ? "askFirst" : KIND_PARA[kind] || kind;
      return '<hp:p id="' + (pid++) + '" paraPrIDRef="' + style.para[para] + '" styleIDRef="0" pageBreak="' + (extra && extra.pageBreak ? 1 : 0) + '" columnBreak="0" merged="0">' + runsXml + "</hp:p>";
    }
    function story(tag, vert, kind, runs) {
      return '<hp:ctrl><hp:' + tag + ' id="' + (pid++) + '" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="' + vert + '" linkListIDRef="0" linkListNextIDRef="0" textWidth="' + template.__bodyWidth + '" textHeight="2835" hasTextRef="0" hasNumRef="0">' +
        p(kind, hwpxRuns(style, runs, kind)) + "</hp:subList></hp:" + tag + "></hp:ctrl>";
    }

    var header = layout.header || {}, footer = layout.footer || {};
    var controls = colPrXml(1, template.__colRule);
    if (header.left || header.right) controls += story("header", "TOP", "header", hfRuns(header.left, [], header.right));
    controls += story("footer", "BOTTOM", "footer", hfRuns(footer.left, [{ text: "- ", role: "hf" }, { text: "", pageNum: true, role: "hf" }, { text: " -", role: "hf" }], footer.right));

    // 첫 블록은 쪽 설정이 들어 있는 첫 문단에 함께 넣는다.
    var first = blocks[0];
    var firstPara = template.__firstPara.replace('paraPrIDRef="0"', 'paraPrIDRef="' + style.para[KIND_PARA[first.kind]] + '"');
    var xml = [template.__secHead, firstPara + controls + "</hp:run>" + hwpxRuns(style, first.runs, first.kind) + "</hp:p>"];

    var pendingBreak = false, columnsStarted = columns === 1;
    blocks.slice(1).forEach(function (bl) {
      if (bl.kind === "pagebreak") { pendingBreak = true; return; }
      var runsXml = hwpxRuns(style, bl.runs, bl.kind);
      // 머리 부분(제목) 다음부터 2단으로 나눈다.
      if (!columnsStarted && bl.kind !== "eyebrow" && bl.kind !== "title" && bl.kind !== "nameLine") {
        runsXml = '<hp:run charPrIDRef="0">' + colPrXml(2, template.__colRule) + "</hp:run>" + runsXml;
        columnsStarted = true;
      }
      xml.push(p(bl.kind, runsXml, { pageBreak: pendingBreak, first: bl.first }));
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
    var section = buildSectionXml(template, blocks, doc);
    var preview = blocks.map(function (b) { return b.runs.map(function (r) { return r.text || ""; }).join(""); }).join("\n").slice(0, 1000);
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

  // ---------- DOCX (한글에서도 바로 열리는 Word 문서) ----------

  var NAVY = "1D3A6B";
  var DOTUM = "함초롬돋움", BATANG = "함초롬바탕", EN = "Times New Roman";

  // 글자 모양: [한글 글꼴, 크기(pt), 굵게, 색]
  var DOCX_CHAR = {
    body: [BATANG, 10], ask: [DOTUM, 10, true], num: [BATANG, 13, true, NAVY], src: [DOTUM, 8, true, "6B7688"],
    title: [BATANG, 18, true], eyebrow: [DOTUM, 8.5, true, NAVY], name: [DOTUM, 9], hf: [DOTUM, 8, false, "555555"],
    ansTitle: [BATANG, 14, true], ansNum: [BATANG, 9.5, true, NAVY], ans: [BATANG, 9.5], explain: [BATANG, 8.5, false, "444444"]
  };

  // 문단 모양 (단위: twip, 1mm ≈ 56.7)
  var ASK_TWIP = 400;
  var DOCX_PARA = {
    eyebrow: '<w:spacing w:after="0" w:line="264" w:lineRule="auto"/>',
    title: '<w:spacing w:after="40" w:line="264" w:lineRule="auto"/>',
    nameLine: '<w:pBdr><w:bottom w:val="single" w:sz="16" w:space="4" w:color="' + NAVY + '"/></w:pBdr><w:spacing w:after="240"/><w:jc w:val="right"/>',
    src: '<w:keepNext/><w:spacing w:before="220" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="' + ASK_TWIP + '"/>',
    ask: '<w:keepNext/><w:tabs><w:tab w:val="left" w:pos="' + ASK_TWIP + '"/></w:tabs><w:spacing w:after="60" w:line="300" w:lineRule="auto"/><w:ind w:left="' + ASK_TWIP + '" w:hanging="' + ASK_TWIP + '"/>',
    askFirst: '<w:keepNext/><w:tabs><w:tab w:val="left" w:pos="' + ASK_TWIP + '"/></w:tabs><w:spacing w:before="220" w:after="60" w:line="300" w:lineRule="auto"/><w:ind w:left="' + ASK_TWIP + '" w:hanging="' + ASK_TWIP + '"/>',
    box: '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F8"/><w:spacing w:before="30" w:after="30"/><w:ind w:left="70" w:right="70"/><w:jc w:val="both"/>',
    para: '<w:jc w:val="both"/>',
    choice: '<w:ind w:left="220" w:hanging="220"/>',
    answerLine: '<w:spacing w:before="40"/><w:ind w:left="' + ASK_TWIP + '"/>',
    ansTitle: '<w:spacing w:after="100"/><w:jc w:val="center"/>',
    roundTitle: '<w:keepNext/><w:spacing w:after="100"/><w:jc w:val="center"/>',
    ans: '<w:spacing w:after="20" w:line="290" w:lineRule="auto"/><w:ind w:left="260" w:hanging="260"/>'
  };

  function docxRun(run, kind) {
    if (run.tab) return "<w:r><w:tab/></w:r>";
    var c = DOCX_CHAR[run.role || KIND_CHAR[kind]] || DOCX_CHAR.body;
    var props = '<w:rFonts w:ascii="' + EN + '" w:hAnsi="' + EN + '" w:eastAsia="' + c[0] + '" w:cs="' + EN + '"/>';
    if (run.b || c[2]) props += "<w:b/>";
    if (c[3]) props += '<w:color w:val="' + c[3] + '"/>';
    props += '<w:sz w:val="' + Math.round(c[1] * 2) + '"/><w:szCs w:val="' + Math.round(c[1] * 2) + '"/>';
    if (run.u) props += '<w:u w:val="single"/>';
    if (run.pageNum) return '<w:fldSimple w:instr="PAGE"><w:r><w:rPr>' + props + "</w:rPr><w:t>1</w:t></w:r></w:fldSimple>";
    return "<w:r><w:rPr>" + props + '</w:rPr><w:t xml:space="preserve">' + xmlEscape(run.text) + "</w:t></w:r>";
  }

  var BODY_TWIP = 10206; // A4 폭 - 좌우 15mm
  function docxSectPr(cols) {
    return '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850" w:header="567" w:footer="567" w:gutter="0"/>' +
      (cols === 2 ? '<w:cols w:num="2" w:space="567" w:sep="1"/>' : '<w:cols w:space="425"/>') + "</w:sectPr>";
  }

  function buildDocxBody(blocks, doc) {
    var columns = doc.options && doc.options.columns === 1 ? 1 : 2;
    var out = [];
    var pendingBreak = false;
    blocks.forEach(function (bl, i) {
      if (bl.kind === "pagebreak") { pendingBreak = true; return; }
      var key = bl.kind === "ask" && bl.first ? "askFirst" : bl.kind;
      var ppr = (pendingBreak ? "<w:pageBreakBefore/>" : "") + DOCX_PARA[key];
      // 제목 부분은 1단 구역, 그 뒤는 2단 구역
      if (bl.kind === "nameLine" && columns === 2) ppr += docxSectPr(1);
      pendingBreak = false;
      out.push("<w:p><w:pPr>" + ppr + "</w:pPr>" + bl.runs.map(function (r) { return docxRun(r, bl.kind); }).join("") + "</w:p>");
    });
    out.push(docxSectPr(columns));
    return out.join("");
  }

  function docxStory(tag, kind, runs, border) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:' + tag + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:p><w:pPr><w:pBdr>" + border + '</w:pBdr><w:tabs><w:tab w:val="center" w:pos="' + BODY_TWIP / 2 + '"/><w:tab w:val="right" w:pos="' + BODY_TWIP + '"/></w:tabs></w:pPr>' +
      runs.map(function (r) { return docxRun(r, kind); }).join("") + "</w:p></w:" + tag + ">";
  }

  var DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="함초롬바탕" w:cs="Times New Roman"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="384" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';

  function buildDocx(doc) {
    var blocks = buildBlocks(doc);
    var layout = doc.layout || {};
    var header = layout.header || {}, footer = layout.footer || {};
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
      buildDocxBody(blocks, doc) + "</w:body></w:document>";
    var headerXml = docxStory("hdr", "header", hfRuns(header.left, [], header.right),
      header.left || header.right ? '<w:bottom w:val="single" w:sz="4" w:space="4" w:color="999999"/>' : "");
    var footerXml = docxStory("ftr", "footer", hfRuns(footer.left, [{ text: "- ", role: "hf" }, { text: "", pageNum: true, role: "hf" }, { text: " -", role: "hf" }], footer.right),
      '<w:top w:val="single" w:sz="4" w:space="4" w:color="' + NAVY + '"/>');
    return makeZip([
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: "docProps/core.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xmlEscape(doc.title || "") + "</dc:title></cp:coreProperties>" },
      { name: "word/_rels/document.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>' },
      { name: "word/document.xml", data: documentXml },
      { name: "word/styles.xml", data: DOCX_STYLES },
      { name: "word/header1.xml", data: headerXml },
      { name: "word/footer1.xml", data: footerXml }
    ]);
  }

  var VM = {
    CIRCLED: CIRCLED,
    TYPES: TYPES,
    TYPE_BY_KEY: TYPE_BY_KEY,
    makeRng: makeRng,
    answerDeck: answerDeck,
    answerOptions: answerOptions,
    moveAnswer: moveAnswer,
    balanceAnswers: balanceAnswers,
    answerCounts: answerCounts,
    splitSentences: splitSentences,
    makeOrder: makeOrder,
    makeInsert: makeInsert,
    makeArrange: makeArrange,
    AUTO_MAKERS: AUTO_MAKERS,
    buildPrompt: buildPrompt,
    buildCombinedPrompt: buildCombinedPrompt,
    parseBulkPassages: parseBulkPassages,
    normalizeNo: normalizeNo,
    noLabel: noLabel,
    parseAiProblems: parseAiProblems,
    parseRuns: parseRuns,
    sortProblems: sortProblems,
    sourceLabels: sourceLabels,
    buildBlocks: buildBlocks,
    buildSectionXml: buildSectionXml,
    makeZip: makeZip,
    crc32: crc32,
    buildHwpx: buildHwpx,
    buildDocx: buildDocx
  };

  if (typeof module !== "undefined" && module.exports) module.exports = VM;
  else root.VM = VM;
})(this);
