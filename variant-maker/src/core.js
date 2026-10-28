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
    { key: "summaryWrite", name: "요약 서술형", mode: "ai", instruction: "다음 글의 내용을 요약했을 때, 빈칸 (A)~(C)에 들어갈 가장 적절한 단어를 본문에서 각각 한 단어씩 찾아 그대로 쓰시오." },
    { key: "fix", name: "어법 오류 고치기", mode: "ai", instruction: "위 글의 밑줄 친 (A)~(E) 중 어법상 틀린 부분이 있는 것을 2개 골라 <조건>에 맞게 쓰시오." },
    { key: "arrange", name: "서술형 문장배열", mode: "auto", instruction: "다음 글의 빈칸 (A)에 들어갈 말을 <보기>의 단어를 모두 한 번씩 사용하여 바르게 배열하시오." },
    { key: "compose", name: "한글 문장 영작", mode: "ai", instruction: "다음 글의 밑줄 친 우리말 (A)를 <조건>에 맞게 영작하시오." }
  ];

  // 유형 묶음 아이콘: ◆ 대의 파악, ■ 어법·어휘, ● 빈칸·요약, ▲ 글의 흐름, ★ 서술형 (한글 기본 글꼴에 있는 기호)
  var TYPE_ICON = {
    claim: "◆", gist: "◆", topic: "◆", title: "◆", implied: "◆",
    grammar: "■", vocab: "■", blank: "●", summary: "●", order: "▲", insert: "▲",
    summaryWrite: "★", fix: "★", arrange: "★", compose: "★"
  };

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

  // ---------- 회차끼리 겹치지 않게 ----------

  function norm(s) { return String(s || "").replace(/<\/?[ub]>/gi, "").replace(/\s+/g, " ").trim().toLowerCase(); }

  function orderSignature(given, chunks) {
    return "o:" + norm(given) + "|" + chunks.map(norm).sort().join("|");
  }

  // 문제의 '알맹이'를 나타내는 문자열. 같으면 같은 문제로 본다.
  function problemSignature(p) {
    var correct = p.choices && CIRCLED.indexOf(p.answer) >= 0 ? p.choices[CIRCLED.indexOf(p.answer)] : p.answer;
    var underlines = (String(p.passage || "").match(/<u>([^]*?)<\/u>/gi) || [])
      .map(function (u) { return norm(u.replace(/<\/?u>/gi, "").replace(/^\s*(?:[①-⑤]|\([a-hA-H]\))\s*/, "")); }).sort().join("|");
    switch (p.type) {
      case "order": return orderSignature(p.box, String(p.passage || "").split("\n").map(function (l) { return l.replace(/^\([ABC]\)\s*/, ""); }));
      case "insert": return "i:" + norm(p.box);
      case "arrange": return "a:" + norm(p.answer);
      case "grammar": case "vocab": case "fix": return p.type + ":" + underlines;
      case "implied": return "m:" + underlines;
      case "compose": return "c:" + norm(p.answer);
      case "summaryWrite": return "w:" + norm(p.answer);
      default: return p.type + ":" + norm(correct);
    }
  }

  function signatureSet(list) {
    var set = {};
    (list || []).forEach(function (p) { set[problemSignature(p)] = true; });
    return set;
  }

  // 겹치지 않는 후보를 앞에, 겹치는 후보를 뒤에 둔다(모자라면 뒤의 것도 쓴다).
  function preferFresh(items, sig, taken) {
    return items.filter(function (x) { return !taken[sig(x)]; }).concat(items.filter(function (x) { return taken[sig(x)]; }));
  }

  // 같은 지문·같은 유형에서 알맹이가 같은 문제 쌍을 찾는다. 돌려주는 값: [[i, j], ...] (문제지 순서 번호)
  function findDuplicates(problems) {
    var seen = {}, pairs = [];
    problems.forEach(function (p, i) {
      if (!p.source) return;
      var k = p.type + "\u0001" + (p.source.exam || "") + "\u0001" + p.source.no + "\u0001" + problemSignature(p);
      if (seen[k] !== undefined) pairs.push([seen[k], i]);
      else seen[k] = i;
    });
    return pairs;
  }

  // AI에게 "이미 만든 문제와 겹치지 않게" 알려 줄 한 줄 요약
  function avoidNote(p) {
    var correct = p.choices && CIRCLED.indexOf(p.answer) >= 0 ? norm(p.choices[CIRCLED.indexOf(p.answer)]) : "";
    var underlines = (String(p.passage || "").match(/<u>([^]*?)<\/u>/gi) || []).map(function (u) { return u.replace(/<\/?u>/gi, "").replace(/^\s*(?:[①-⑤]|\([a-hA-H]\))\s*/, "").trim(); });
    if (p.type === "grammar" || p.type === "vocab" || p.type === "fix") return "밑줄 친 곳: " + underlines.join(", ");
    if (p.type === "implied") return "밑줄 친 표현: " + underlines.join(", ") + (correct ? " / 정답 선지: " + correct : "");
    if (p.type === "compose") return "영작한 문장: " + plainText(p.answer);
    if (p.type === "summaryWrite") return "빈칸 정답: " + plainText(p.answer);
    if (p.type === "blank") return "빈칸 정답: " + correct;
    return "정답 선지: " + correct;
  }

  // avoid: 같은 지문·같은 유형으로 이미 만든 문제들. 겹치지 않는 것을 먼저 쓴다.
  function makeOrder(sentences, count, rng, deck, avoid) {
    var n = sentences.length;
    if (n < 4) throw new Error("순서 문제는 문장이 4개 이상 필요합니다. (지금 " + n + "개)");
    var taken = signatureSet(avoid);
    var configs = preferFresh(rng.shuffle(orderConfigs(n)), function (c) {
      var rest = sentences.slice(c.given);
      return orderSignature(sentences.slice(0, c.given).join(" "), [rest.slice(0, c.cuts[0]), rest.slice(c.cuts[0], c.cuts[1]), rest.slice(c.cuts[1])].map(function (ch) { return ch.join(" "); }));
    }, taken);
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

  function makeInsert(sentences, count, rng, deck, avoid) {
    var n = sentences.length;
    if (n < 4) throw new Error("문장삽입 문제는 문장이 4개 이상 필요합니다. (지금 " + n + "개)");
    // 빼낼 문장 후보: 첫 문장 제외. 연결어·지시어로 시작하는 문장을 먼저 쓴다.
    var cands = range(n).slice(1);
    var strong = rng.shuffle(cands.filter(function (i) { return LINKERS.test(sentences[i]); }));
    var weak = rng.shuffle(cands.filter(function (i) { return !LINKERS.test(sentences[i]); }));
    var takenIns = signatureSet(avoid);
    function isTaken(i) { return takenIns["i:" + norm(sentences[i])]; }
    var order = preferFresh(strong.concat(weak), function (i) { return "i:" + norm(sentences[i]); }, takenIns);
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
        // 이미 만든 문제와 겹치지 않는 문장을 먼저, 그다음 원하는 정답 번호를 만들 수 있는 문장을 고른다.
        var fits = function (i) { var w = slotRange(i); return i - want >= w.lo && i - want <= w.hi; };
        removed = fresh.filter(function (i) { return !isTaken(i) && fits(i); })[0];
        if (removed === undefined) removed = fresh.filter(function (i) { return !isTaken(i); })[0];
        if (removed === undefined) removed = fresh.filter(fits)[0];
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

  function makeArrange(sentences, count, rng, deck, avoid) {
    var cands = [];
    sentences.forEach(function (s, i) {
      var words = s.split(" ");
      if (words.length >= 6) cands.push(i);
    });
    if (!cands.length) throw new Error("문장배열 문제를 만들 만큼 긴 문장(6단어 이상)이 없습니다.");
    // 이미 배열 문제로 쓴 문장은 뒤로 미룬다.
    var usedAnswers = (avoid || []).filter(function (p) { return p.type === "arrange"; }).map(function (p) { return norm(p.answer); });
    cands = rng.shuffle(cands);
    cands = cands.filter(function (i) { return !usedAnswers.some(function (a) { return a && norm(sentences[i]).indexOf(a) >= 0; }); })
      .concat(cands.filter(function (i) { return usedAnswers.some(function (a) { return a && norm(sentences[i]).indexOf(a) >= 0; }); }));
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
    grammar: "어법상 틀린 것을 고르는 문제. passage에서 서로 다른 고난도 어법 포인트 5곳에 <u>①단어 또는 짧은 구</u>, <u>②…</u> … <u>⑤…</u> 형식으로 번호와 밑줄을 넣는다(아래 '어법 출제 수준'을 따른다). 그중 정확히 1곳만 어법상 틀리게 바꾸고, 나머지 4곳과 나머지 지문은 원문 그대로 둔다. choices는 null. explanation에 다섯 밑줄 각각의 출제 포인트를 짧게 쓰고, 틀린 곳은 올바른 형태와 그 이유를 문장 구조로 설명한다.",    vocab: "문맥상 낱말 쓰임이 적절하지 않은 것을 고르는 문제. passage에서 내용어 5곳에 <u>①단어</u> … <u>⑤단어</u> 형식으로 번호와 밑줄을 넣는다. 그중 정확히 1곳만 문맥과 반대되거나 어울리지 않는 낱말(주로 반의어)로 바꾸고 나머지는 원문 그대로 둔다. choices는 null. explanation에 원래 낱말을 쓴다.",
    implied: "밑줄 친 함축적 의미를 묻는 문제. passage에서 비유적이거나 함축적인 표현 하나에 <u>…</u> 밑줄을 넣는다(나머지는 원문 그대로). instruction은 '밑줄 친 <표현>이 다음 글에서 의미하는 바로 가장 적절한 것은?'처럼 그 표현을 넣어 쓴다. choices는 영어 5개(문장 또는 구).",
    blank: "빈칸 추론 문제. passage에서 글의 핵심을 담은 단어·구·절 하나를 ________________ 로 바꾼다(나머지는 원문 그대로). choices는 영어 5개이며 정답은 원문 표현이나 같은 뜻의 바꿔 쓴 표현. 오답은 그럴듯하지만 글의 논리와 맞지 않게 만든다.",
    summary: "요약문 완성 문제. passage는 원문 그대로. box에 글 전체를 요약한 영어 한 문장을 쓰고, 핵심어 두 곳을 (A) ________ 와 (B) ________ 로 비운다. boxFirst는 false. choices는 5개이며 각 항목은 '(A)에 들어갈 말 …… (B)에 들어갈 말' 형식(예: 'flexible …… reduced'). 정답 단어는 본문에 그대로 나오지 않는 바꿔 쓴 말이 좋다.",
    compose: "우리말 영작 문제. passage에서 한 문장(또는 절)을 골라 그 자리를 '(A) <u>그 문장의 자연스러운 한국어 번역</u>'으로 바꾼다. box에는 '<조건>'으로 시작하는 조건 2~3줄(예: 주어진 단어 사용, 단어 수, 필수 어법)을 줄바꿈(\\n)으로 나눠 쓴다. boxFirst는 false. choices는 null. answer는 원문 영어 문장.",
    summaryWrite: "요약문 빈칸 서술형 문제. passage는 원문 그대로. box에 글 전체 내용을 요약한 영어 한 문장(또는 두 문장)을 쓰고, 핵심 단어 세 곳을 (A) ________, (B) ________, (C) ________ 로 비운다. 세 빈칸의 정답은 모두 본문(passage)에 그대로 나오는 한 단어여야 하며(형태를 바꾸지 않음), 각 빈칸에 들어갈 수 있는 본문 단어는 하나뿐이어야 한다. boxFirst는 false. choices는 null. answer는 '(A) practice (B) quality (C) effort' 형식.",
    fix: "어법 오류를 찾아 고치는 서술형 문제. passage에는 지문 전체를 빠짐없이 원문 순서대로 싣는다(문장을 빼거나 줄이지 않음). 그중 서로 다른 다섯 문장을 골라 각 문장 전체에 <u>(A) 문장 전체</u>, <u>(B) 문장 전체</u> … <u>(E) 문장 전체</u> 형식으로 기호와 밑줄을 넣는다(한 기호 = 한 문장, 문장 일부만 밑줄 긋지 않음). 다섯 문장 중 정확히 2문장에만 어법상 틀린 단어를 한 개씩 넣고, 나머지 3문장과 밑줄 없는 문장은 원문 그대로 둔다. 틀린 곳과 옳은 문장 모두 아래 '어법 출제 수준'의 고난도 포인트를 담은 문장으로 고른다. explanation에는 틀린 두 곳의 출제 포인트와 이유를 문장 구조로 설명한다. 틀린 부분과 고친 형태는 각각 한 단어여야 한다. box는 null(조건은 프로그램이 넣음). choices는 null. answer는 '(B) is → are, (D) using → used' 형식(알파벳 순서대로).",
  };

  // 어법·어휘처럼 번호가 지문 속에 박히는 유형은 나중에 정답을 옮길 수 없어, 만들 때 정답 번호를 정해 준다.
  var FIXED_ANSWER_TYPES = { grammar: true, vocab: true };

  // targets: 문제마다 원하는 정답 번호(0~4) 목록. 어법·어휘에만 쓴다.
  // 어법(객관식)·어법 오류 고치기에 붙이는 출제 수준 지침. 뻔한 포인트를 막고 구조 분석이 필요한 문제를 내게 한다.
  var GRAMMAR_TYPES = { grammar: true, fix: true };
  var GRAMMAR_GUIDE = [
    "## 어법 출제 수준 (고2~고3 내신 상위권)",
    "- 밑줄마다 출제 의도가 분명한 어법 포인트 하나를 묻는다. 학생이 문장 구조를 분석해야 판단할 수 있는 것을 고른다.",
    "- 아래 포인트를 지문에 맞게 골고루 섞어 쓴다(한 문제 안의 밑줄은 서로 다른 포인트).",
    "  1. 수일치: 주어와 동사 사이에 전치사구·관계절·분사구·삽입절이 길게 끼어 있는 경우, 주어 찾기가 어려운 경우(동명사구·명사절 주어, the number of / a number of, 부분 표현 + of + 명사, 상관접속사, 선행사와 관계절 동사)",
    "  2. 주어에서 멀리 떨어진 본동사 찾기: 동사 자리인가 준동사 자리인가, 본동사가 없거나 겹치는 문장",
    "  3. 문장 형식: 4형식 직접목적어 자리의 that절·what절·의문사절, 5형식 목적격보어 형태(to부정사/원형부정사/현재분사/과거분사) — 사역동사 have·make·let, 지각동사, help, get, keep, find. 특히 have/get + 목적어 + 과거분사",
    "  4. 가목적어 it + 진목적어(to부정사구·that절), 가주어 it + 진주어",
    "  5. 동명사만 목적어로 취하는 동사(avoid, deny, mind, finish, consider, postpone, admit, quit, suggest 등), to부정사·동명사에 따라 뜻이 달라지는 동사(remember, forget, stop, regret, try)",
    "  6. 관계대명사 that vs what: 선행사가 있는가, 뒤 절이 불완전한가",
    "  7. 관계대명사 vs 관계부사 vs 전치사 + 관계대명사: 뒤 절이 완전한가 불완전한가(which / where / in which / whom / whose)",
    "  8. 분사구문: 의미상 주어와의 능동·수동(현재분사/과거분사), 완료 분사구문, 접속사 + 분사, 독립 분사구문",
    "  9. 도치: 부정어(never, rarely, little, hardly, not only, no sooner, only + 부사구) 문두 도치의 어순, 장소·방향 부사구 도치, so/neither 도치, 도치 구문 안의 주어-동사 수일치",
    "  10. 그 밖의 고난도: 멀리 떨어진 병렬 구조, 대명사 수일치(it/they, that/those), 재귀대명사, 2형식 보어 자리의 형용사 vs 부사, 접속사 vs 전치사(although/despite, because/because of), 자동사의 수동태 불가, 수동태 뒤 목적어",
    "- 쓰지 말 것(너무 쉬운 포인트): 조동사 뒤 동사원형(will being, can goes 같은 것), 명백한 철자 오류, 주어 바로 뒤 동사의 단순 수일치, 누구나 아는 불규칙 동사 형태, 관사 하나 바꾸기, 뜻이 통하지 않을 만큼 엉뚱한 단어.",
    "- 틀린 곳은 그럴듯한 함정이어야 한다: 바로 앞 단어만 보면 맞아 보이지만 문장 구조를 분석해야 틀렸음을 알 수 있게 만든다.",
    "- 옳은 밑줄도 학생이 헷갈릴 만한 고난도 포인트로 고른다(뻔히 옳아 보이는 곳 X).",
    "- 지문에 해당 구조가 없으면 의미를 바꾸지 않는 범위에서 그 구조가 드러나도록 표현을 조금 바꿔도 된다(어법 오류 고치기에서는 밑줄 문장 안에서만).",
    "- 목표 수준 예시(이 정도의 난이도와 해설을 기준으로 삼는다):",
    "  · research on how artists develop their skills ①suggests that … → 옳음. 주어 research와 동사 사이 전치사구 때문에 복수 skills에 속기 쉬운 멀리 떨어진 수일치",
    "  · our brains form connections ③where did not exist before → 틀림(that/which). 뒤 절에 주어가 없는 불완전한 절이므로 관계부사가 아니라 주격 관계대명사",
    "  · the habit makes it ④easier to let quantity lead to quality → 옳음. 가목적어 it + 형용사 목적격보어 + 진목적어",
    "  · Rarely ⑤do such surprises appear … → 옳음. 부정어 문두 도치와 복수 주어 수일치",
    "  · a designer … soon finds what unusual solutions come more easily → 틀림(that). 뒤 절이 완전하므로 명사절 접속사 that",
    "  · Such surprises rarely appear …, emerging instead in the middle of steady effort → 옳음. 자동사 emerge의 능동 분사구문(emerged로 바꾸면 함정)"
  ].join("\n");

  // avoidNotes: 같은 지문·같은 유형으로 이미 만든 문제 요약(avoidNote). 이것들과 겹치지 않게 만들게 한다.
  function buildPrompt(passage, typeKey, count, targets, avoidNotes) {
    var t = TYPE_BY_KEY[typeKey];
    if (!t || t.mode !== "ai") throw new Error("AI 유형이 아닙니다: " + typeKey);
    return [
      "당신은 한국 고등학교 영어 교사로, 수능·모의고사 형식의 영어 변형문제를 만듭니다.",
      "아래 지문으로 [" + t.name + "] 유형 문제를 " + count + "개 만드세요.",
      "",
      "## 유형 설명",
      AI_SPECS[typeKey],
      GRAMMAR_TYPES[typeKey] ? "\n" + GRAMMAR_GUIDE : "",
      "",
      "## 공통 규칙",
      "- 기본 발문: " + t.instruction,
      targets && targets.length ? "- 정답 번호는 문제 순서대로 " + targets.map(function (x) { return CIRCLED[x]; }).join(", ") + "가 되게 만드세요." : "",
      "- 여러 문제를 만들 때는 문제마다 선지·밑줄 위치·정답 번호가 서로 달라야 합니다.",
      "- 정답은 반드시 하나뿐이어야 합니다. 출력 전에 오답 선지가 지문 내용상 정답이 될 여지가 없는지, 선지끼리 같은 뜻이 아닌지, 표시한 정답과 해설이 맞는지 스스로 다시 확인하세요.",
      "- 객관식 정답은 ①~⑤ 중 하나로 쓰고, 여러 문제의 정답 번호가 한쪽으로 몰리지 않게 합니다.",
      "- 밑줄은 <u>…</u>, 굵은 글씨는 <b>…</b> 태그만 씁니다. 다른 태그나 마크다운은 쓰지 않습니다.",
      "- 문단을 나눌 때는 \\n 을 씁니다.",
      GRAMMAR_TYPES[typeKey] ? "- explanation은 한국어로, 출제 포인트와 이유가 드러나게 3~5문장으로 씁니다." : "- explanation은 한국어 1~2문장으로 씁니다.",
      "",
      avoidNotes && avoidNotes.length ? "\n## 이미 만든 문제 (이번 문제는 이것들과 밑줄 위치·빈칸·정답 선지·출제 포인트가 겹치지 않게 새로 만드세요)\n" + avoidNotes.map(function (a) { return "- " + a; }).join("\n") + "\n" : "",
      "## 출력 형식",
      "설명 없이 JSON만 출력합니다.",
      '{"problems":[{"instruction":"발문","box":"상자에 넣을 글 또는 null","boxFirst":true,"passage":"지문","choices":["…","…","…","…","…"] 또는 null,"answer":"③","explanation":"해설"}]}',
      "",
      "## 지문",
      normalizeText(passage).trim()
    ].join("\n");
  }

  // 여러 지문과 여러 유형을 한 번에 요청하는 요청문 (Claude 채팅에 붙여 넣는 용도)
  // plan: {유형: {지문 번호: [정답 번호(0~4)…]}} — 어법·어휘의 정답 번호 지정
  function buildCombinedPrompt(passages, requests, plan) {
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
      requests.some(function (r) { return GRAMMAR_TYPES[r.type]; }) ? "\n" + GRAMMAR_GUIDE : "",
      "",
      "## 공통 규칙",
      "- 같은 유형의 문제끼리는 선지·밑줄 위치·정답 번호가 서로 달라야 합니다.",
      "- 정답은 반드시 하나뿐이어야 합니다. 출력 전에 오답 선지가 지문 내용상 정답이 될 여지가 없는지, 선지끼리 같은 뜻이 아닌지, 표시한 정답과 해설이 맞는지 스스로 다시 확인하세요.",
      "- 객관식 정답은 ①~⑤ 중 하나로 쓰고, 정답 번호가 한쪽으로 몰리지 않게 합니다.",
      "- 밑줄은 <u>…</u>, 굵은 글씨는 <b>…</b> 태그만 씁니다. 다른 태그나 마크다운은 쓰지 않습니다.",
      "- 문단을 나눌 때는 \\n 을 씁니다. explanation은 한국어 1~2문장(어법·어법 오류 고치기는 출제 포인트가 드러나게 3~5문장).",
      planLines(passages, requests, plan),
      "",
      "## 출력 형식",
      "설명 없이 JSON만 출력합니다. 각 문제에 type 값과, 어느 지문으로 만들었는지 src 값(지문 [ ] 안의 번호)을 반드시 넣습니다.",
      '{"problems":[{"src":"' + (passages[0].no || "1") + '","type":"topic","instruction":"발문","box":null,"boxFirst":true,"passage":"지문","choices":["…","…","…","…","…"],"answer":"③","explanation":"해설"}]}',
      "",
      "## 지문",
      texts.join("\n\n")
    ].join("\n");
  }

  function planLines(passages, requests, plan) {
    if (!plan) return "";
    var lines = [];
    var avoid = plan.__avoid || {};
    passages.forEach(function (p, i) {
      var id = p.no || String(i + 1);
      requests.forEach(function (r) {
        var notes = avoid[r.type] && avoid[r.type][id];
        if (notes && notes.length) lines.push("- 지문 [" + id + "] " + TYPE_BY_KEY[r.type].name + "는 이미 만든 문제와 겹치지 않게 (" + notes.join(" / ") + ")");
      });
    });
    requests.forEach(function (r) {
      if (!plan[r.type]) return;
      passages.forEach(function (p, i) {
        var id = p.no || String(i + 1);
        var want = plan[r.type][id];
        if (want && want.length) lines.push("- 지문 [" + id + "] " + TYPE_BY_KEY[r.type].name + ": 정답 번호를 문제 순서대로 " + want.map(function (x) { return CIRCLED[x]; }).join(", ") + "로 만드세요.");
      });
    });
    return lines.length ? "- 아래 내용을 지켜 주세요.\n" + lines.join("\n") : "";
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

  // ---------- 검수 ----------

  // AI가 만든 유형(자동 유형은 원문에서 바로 만들어 검수할 필요가 없다)
  function needsReview(p) {
    return TYPE_BY_KEY[p.type] && TYPE_BY_KEY[p.type].mode === "ai";
  }

  function plainText(s) { return String(s || "").replace(/<\/?[ub]>/gi, "").replace(/\s+/g, " ").trim(); }

  // 프로그램이 직접 하는 형식 검사. 문제마다 고칠 점 목록을 돌려준다.
  // original: 원문(있으면 지문이 빠짐없이 실렸는지도 본다)
  function checkProblem(p, original) {
    var issues = [];
    var mcTypes = { claim: 1, gist: 1, topic: 1, title: 1, implied: 1, blank: 1, summary: 1, order: 1 };
    var ans = CIRCLED.indexOf(p.answer);
    if (mcTypes[p.type]) {
      if (!p.choices || p.choices.length !== 5) issues.push("선지가 5개가 아니에요");
      else {
        var seen = {};
        p.choices.forEach(function (c, i) {
          var k = plainText(c).toLowerCase().replace(/[.!?]$/, "");
          if (seen[k] !== undefined) issues.push(CIRCLED[seen[k]] + "와 " + CIRCLED[i] + " 선지가 같아요");
          seen[k] = i;
          if (!k) issues.push(CIRCLED[i] + " 선지가 비어 있어요");
        });
      }
      if (ans < 0) issues.push("정답이 ①~⑤ 중 하나가 아니에요");
    }
    if (p.type === "grammar" || p.type === "vocab") {
      var marks = (String(p.passage).match(/<u>\s*[①-⑤]/g) || []).map(function (m) { return m.replace(/<u>\s*/, ""); });
      var uniq = marks.filter(function (m, i) { return marks.indexOf(m) === i; });
      if (uniq.length !== 5) issues.push("밑줄 번호(①~⑤)가 " + uniq.length + "개예요");
      if (ans < 0) issues.push("정답이 ①~⑤ 중 하나가 아니에요");
      else if (uniq.length && uniq.indexOf(p.answer) < 0) issues.push("정답 " + p.answer + "가 지문의 밑줄 번호에 없어요");
    }
    if (p.type === "insert") {
      var m2 = (String(p.passage).match(/\( [①-⑤] \)/g) || []).length;
      if (m2 < 3) issues.push("자리 표시가 " + m2 + "개뿐이에요");
    }
    if (WRITE_TYPES[p.type] && !plainText(p.answer)) issues.push("모범 답안이 비어 있어요");
    issues = issues.concat(trivialGrammar(p));
    if (p.type === "summaryWrite") {
      var words = parseLetteredAnswer(p.answer, ["A", "B", "C"]);
      var body = " " + plainText(p.passage).toLowerCase().replace(/[^a-z'\-]+/g, " ") + " ";
      ["A", "B", "C"].forEach(function (L) {
        var w = (words[L] || "").toLowerCase();
        if (!w) issues.push("(" + L + ") 정답이 없어요");
        else if (/\s/.test(w)) issues.push("(" + L + ") 정답이 한 단어가 아니에요");
        else if (body.indexOf(" " + w + " ") < 0) issues.push("(" + L + ") 정답 '" + w + "'가 본문에 없어요");
      });
      if ((String(p.box || "").match(/\([ABC]\)/g) || []).length < 3) issues.push("요약문에 빈칸 (A)~(C)가 모두 있지 않아요");
    }
    if (p.type === "fix") {
      var spans = {}, rawSpans = {};
      (String(p.passage).match(/<u>\s*\(([A-E])\)([^]*?)<\/u>/g) || []).forEach(function (u) {
        var m = u.match(/<u>\s*\(([A-E])\)([^]*?)<\/u>/);
        rawSpans[m[1]] = plainText(m[2]);
        spans[m[1]] = rawSpans[m[1]].toLowerCase();
      });
      if (Object.keys(spans).length !== 5) issues.push("밑줄 기호 (A)~(E)가 " + Object.keys(spans).length + "개예요");
      // 한 문장 전체: 대문자(또는 따옴표·숫자)로 시작해 마침표·물음표·느낌표로 끝나야 한다.
      var partial = Object.keys(rawSpans).filter(function (L) { return !/^["'(]?[A-Z0-9]/.test(rawSpans[L]) || !/[.!?]["')]?$/.test(rawSpans[L]); });
      if (partial.length) issues.push("(" + partial.join("), (") + ")가 문장 전체에 밑줄이 그어지지 않았어요");
      if (original) {
        var countWords = function (t) { return plainText(t).replace(/\(([A-E])\)/g, " ").split(/\s+/).filter(Boolean).length; };
        var have = countWords(p.passage), want = countWords(original);
        if (want && have < want * 0.9) issues.push("지문이 원문보다 짧아요 (원문 " + want + "단어, 지문 " + have + "단어)");
      }
      var fixes = String(p.answer || "").match(/\(([A-E])\)\s*([^\s,→\-]+)\s*(?:→|->|-)\s*([^\s,/]+)/g) || [];
      if (fixes.length !== 2) issues.push("고친 곳이 2개가 아니에요 (" + fixes.length + "개)");
      fixes.forEach(function (f) {
        var m = f.match(/\(([A-E])\)\s*([^\s,→\-]+)\s*(?:→|->|-)\s*([^\s,/]+)/);
        var span = spans[m[1]];
        if (span !== undefined && (" " + span.replace(/[^a-z'\-]+/g, " ") + " ").indexOf(" " + m[2].toLowerCase() + " ") < 0) issues.push("(" + m[1] + ")의 틀린 부분 '" + m[2] + "'가 밑줄 안에 없어요");
      });
    }
    if (!plainText(p.passage)) issues.push("지문이 비어 있어요");
    return issues;
  }

  // 너무 쉬운 어법 포인트: 틀린 단어 바로 앞이 조동사인 경우(will being, can goes 같은 것)
  var MODALS = /\b(?:will|would|can|could|shall|should|may|might|must)\s+(?:not\s+)?$/i;
  function trivialGrammar(p) {
    var hits = [];
    if (p.type === "grammar") {
      var m = String(p.passage || "").match(new RegExp("([^<>]{0,40})<u>\\s*" + p.answer + "\\s*([^<]*)</u>"));
      if (m && MODALS.test(plainText(m[1]) + " ")) hits.push("정답 " + p.answer + "가 조동사 바로 뒤 동사 형태예요. 너무 쉬운 포인트예요");
    }
    if (p.type === "fix") {
      var rx = /\(([A-E])\)\s*([^\s,→\-]+)\s*(?:→|->|-)\s*([^\s,/]+)/g, f;
      var text = plainText(p.passage);
      while ((f = rx.exec(String(p.answer || ""))) !== null) {
        var idx = text.indexOf(" " + f[2] + " ");
        if (idx < 0) idx = text.indexOf(" " + f[2]);
        if (idx >= 0 && MODALS.test(text.slice(Math.max(0, idx - 30), idx + 1))) hits.push("(" + f[1] + ") '" + f[2] + "'는 조동사 바로 뒤 동사 형태예요. 너무 쉬운 포인트예요");
      }
    }
    return hits;
  }

  // "(A) word (B) word (C) word" → {A: "word", ...}
  function parseLetteredAnswer(text, letters) {
    var out = {};
    var s2 = plainText(text);
    letters.forEach(function (L, i) {
      var next = letters[i + 1];
      var re = new RegExp("\\(" + L + "\\)\\s*(.*?)\\s*(?=" + (next ? "\\(" + next + "\\)" : "$") + ")");
      var m = s2.match(re);
      if (m) out[L] = m[1].replace(/[,;/]+$/, "").trim();
    });
    return out;
  }

  // AI 검수 요청문. items: [{id, problem, original(원문, 없어도 됨)}]
  function buildReviewPrompt(items) {
    var body = items.map(function (it) {
      var p = it.problem;
      var lines = ["### 문제 " + it.id + " [" + (TYPE_BY_KEY[p.type] ? TYPE_BY_KEY[p.type].name : p.type) + "]", "발문: " + plainText(p.instruction)];
      if (it.original) lines.push("원문: " + normalizeText(it.original).trim());
      if (p.box) lines.push("상자: " + p.box);
      lines.push("지문: " + p.passage);
      if (p.choices) lines.push("선지:\n" + p.choices.map(function (c, i) { return CIRCLED[i] + " " + c; }).join("\n"));
      lines.push("표시된 정답: " + p.answer);
      if (p.explanation) lines.push("해설: " + p.explanation);
      return lines.join("\n");
    });
    return [
      "당신은 한국 고등학교 영어 시험 출제 검수자입니다. 아래 변형문제를 하나씩 꼼꼼히 검수하세요.",
      "",
      "## 확인할 것",
      "1. 정답이 하나뿐인가? 오답 선지 중 지문 내용상 정답으로 볼 수 있는 것(복수 정답)이 없는가?",
      "2. 표시된 정답이 실제로 맞는가?",
      "3. 선지끼리 같은 내용이거나 지나치게 비슷하지 않은가?",
      "4. 어법·어휘 문제는 틀린 곳이 정확히 하나이고, 그것이 표시된 정답 번호인가? 어법 오류 고치기는 지문 전체가 빠짐없이 실렸고, (A)~(E)가 각각 한 문장 전체에 밑줄이 그어졌으며, 그중 틀린 문장이 정확히 2개이고 틀린 부분과 고친 형태가 각각 한 단어인가? 요약 서술형은 (A)~(C)의 정답이 모두 본문에 그대로 나오는 한 단어이고, 다른 본문 단어로는 답이 될 수 없는가?",
      "5. 해설이 정답과 맞는가?",
      "6. 어법·어법 오류 고치기 문제가 너무 쉬운 포인트(조동사 뒤 동사원형, 철자, 주어 바로 뒤 동사 수일치 등)를 묻고 있지 않은가? 출제 의도가 분명하고 문장 구조를 분석해야 풀 수 있는가? 아니면 같은 정답 번호(알파벳)를 유지한 채 더 높은 수준의 포인트(멀리 떨어진 수일치, 문장 형식, 가목적어, 관계사, 분사구문, 도치 등)로 고친다.",
      "",
      "## 고칠 때 규칙",
      "- 문제가 없으면 ok만 true로 둡니다.",
      "- 문제가 있으면 ok를 false로 하고 issue에 한국어 한 문장으로 이유를 쓴 뒤, fix에 고친 내용을 넣습니다.",
      "- 정답 번호는 되도록 바꾸지 말고, 문제가 되는 선지나 밑줄 내용을 고치세요. (정답 번호 배치를 유지하기 위해)",
      "- fix에는 바꾼 항목만 넣습니다: choices(5개 전부), answer, explanation, passage, box 중 필요한 것.",
      "- 밑줄은 <u>…</u>, 굵은 글씨는 <b>…</b> 태그만 씁니다.",
      "",
      "## 출력 형식",
      "설명 없이 JSON만 출력합니다.",
      '{"reviews":[{"id":"' + items[0].id + '","ok":true},{"id":"…","ok":false,"issue":"②도 정답이 될 수 있음","fix":{"choices":["…","…","…","…","…"],"explanation":"…"}}]}',
      "",
      "## 검수할 문제",
      body.join("\n\n")
    ].join("\n");
  }

  // 검수 결과를 문제에 반영한다. byId: {id: problem}. 돌려주는 값: {checked, fixed, notes}
  function applyReview(text, byId) {
    var reviews = [];
    extractJsonAll(text).forEach(function (d) {
      var list = Array.isArray(d) ? d : d.reviews;
      if (Array.isArray(list)) reviews = reviews.concat(list);
    });
    var result = { checked: 0, fixed: 0, notes: [] };
    reviews.forEach(function (r) {
      var p = r && byId[String(r.id)];
      if (!p) return;
      result.checked++;
      p.reviewed = true;
      if (r.ok === false && r.fix && typeof r.fix === "object") {
        var f = r.fix, changed = false;
        // 선지는 원래 선지가 있는 객관식 문제에만 바꾼다(어법·어휘처럼 지문 속 번호 문제는 선지가 없다).
        if (Array.isArray(p.choices) && Array.isArray(f.choices) && f.choices.length === 5) { p.choices = f.choices.map(String); changed = true; }
        if (f.answer) { p.answer = normalizeAnswer(f.answer); changed = true; }
        ["explanation", "passage", "box", "instruction"].forEach(function (k) { if (typeof f[k] === "string" && f[k].trim()) { p[k] = f[k]; changed = true; } });
        if (changed) {
          result.fixed++;
          p.reviewNote = String(r.issue || "검수에서 고침");
          result.notes.push(p.reviewNote);
        }
      } else if (r.ok === false) {
        p.reviewNote = String(r.issue || "확인 필요");
        result.notes.push(p.reviewNote + " (고친 내용 없음)");
      }
    });
    return result;
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
  // shouldMove(p)가 참인 문제만 옮기고(없으면 옮길 수 있는 문제 전부), 나머지는 있는 그대로 둔다.
  //
  // 1) 옮기지 않는 문제의 정답 개수를 세고, 전체가 고르게 되려면 옮길 문제에 번호별로 몇 개씩 줘야 하는지 정한다.
  // 2) 그 몫을 문제지 처음부터 끝까지 고르게 나눠 쓴다(부족한 번호를 앞쪽에 몰아 쓰지 않는다).
  // 3) 바로 앞·뒤 문제와 같은 번호는 다른 번호를 고를 수 없을 때만 쓰고,
  //    두 문제 앞과 같은 번호(①⑤①⑤ 같은 되풀이)도 피하며, 나머지는 무작위로 섞어 주기적인 되풀이가 생기지 않게 한다.
  function balanceAnswers(problems, shouldMove, rng) {
    rng = rng || makeRng();
    var n = problems.length;
    var options = problems.map(function (p) {
      var o = answerOptions(p);
      return o.length > 1 && (!shouldMove || shouldMove(p)) ? o : null;
    });
    var fixedCount = [0, 0, 0, 0, 0], movableTotal = 0;
    problems.forEach(function (p, i) {
      if (options[i]) { movableTotal++; return; }
      var a = CIRCLED.indexOf(p.answer);
      if (a >= 0) fixedCount[a]++;
    });
    // 옮길 문제의 번호별 몫: 개수가 가장 적은 번호부터 하나씩 채운다.
    var need = [0, 0, 0, 0, 0];
    for (var k = 0; k < movableTotal; k++) {
      var low = 0;
      for (var t0 = 1; t0 < 5; t0++) if (fixedCount[t0] + need[t0] < fixedCount[low] + need[low]) low = t0;
      need[low]++;
    }
    var got = [0, 0, 0, 0, 0], answers = [], done = 0;
    problems.forEach(function (p, i) {
      var a = CIRCLED.indexOf(p.answer);
      if (options[i]) {
        var prev = i > 0 ? answers[i - 1] : -1;
        var prev2 = i > 1 ? answers[i - 2] : -1;
        var prev3 = i > 2 ? answers[i - 3] : -1;
        var prev4 = i > 3 ? answers[i - 4] : -1;
        var next = i < n - 1 && !options[i + 1] ? CIRCLED.indexOf(problems[i + 1].answer) : -1;
        var best = a, bestScore = Infinity;
        options[i].forEach(function (t) {
          var ahead = got[t] - need[t] * (done + 1) / movableTotal; // 계획보다 많이 썼으면 +
          // 가중치는 모의 실험으로 정했다: 전체 개수 차이 1 이내, 두 칸 앞과 같은 비율 약 2%, 서너 칸 주기 되풀이 없음
          var score = (t === prev || t === next ? 10000 : 0) + (got[t] >= need[t] ? 150 : 0) + ahead * 40 +
            (t === prev2 ? 40 : 0) + (t === prev3 ? 5 : 0) + (t === prev4 ? 10 : 0) + rng.next() * 80;
          if (score < bestScore) { bestScore = score; best = t; }
        });
        moveAnswer(p, best);
        a = best;
        got[a]++;
        done++;
      }
      answers.push(a);
    });
    return answerCounts(problems);
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

  var WRITE_TYPES = { arrange: true, compose: true, fix: true, summaryWrite: true };
  var FIX_CONDITIONS = [
    "<조건>",
    "1. 어법상 틀린 부분을 포함하고 있는 것의 알파벳 (A)~(E)과 어법상 틀린 부분(1단어)을 쓰고, 어법에 맞게 고쳐 쓸 것(1단어).",
    "2. 아래 주어진 표대로 작성할 것."
  ];
  var FIX_TABLE_HEADER = ["알파벳", "어법상 틀린 부분 (1단어)", "어법상 맞는 형태 (1단어)"];
  var BOLD_UNDERLINE_TYPES = { grammar: true, vocab: true, fix: true };
  var GRID_PER_ROW = 10; // 정답표 한 줄에 놓는 (번호, 정답) 쌍 수

  // 문제지를 서식 블록 목록으로 바꾼다. 화면 미리보기·PDF·HWPX·DOCX가 모두 같은 블록을 쓴다.
  // 블록: {kind, runs, first?}. run: {text, u, b, role?, tab?}
  // kind: eyebrow title nameLine | src ask box para choice answerLine | pagebreak ansTitle ans
  function buildBlocks(doc) {
    var blocks = [];
    var opts = doc.options || {};
    var layout = doc.layout || {};
    function plain(text, role) { var r = { text: text, u: false, b: false }; if (role) r.role = role; return r; }

    // full: 2단 편집이어도 쪽 전체 너비로 놓는 블록(제목 부분, 정답표)
    if (layout.eyebrow) blocks.push({ kind: "eyebrow", full: true, runs: [plain(layout.eyebrow)] });
    blocks.push({ kind: "title", full: true, runs: [plain(doc.title || "영어 변형문제")] });
    blocks.push({ kind: "nameLine", full: true, runs: [plain(layout.showName === false ? "" : "반 ________   번호 ________   이름 ________________")] });

    var labels = sourceLabels(doc.problems);
    // 회차 나누기: 회차마다 제목을 달고(2회차부터 새 쪽), 문항 번호를 1부터 다시 센다.
    var byRound = !!opts.rounds && doc.problems.some(function (p) { return p.round > 0; });
    var nums = [], lastRound = null, n = 0;
    doc.problems.forEach(function (p) {
      var r = p.round || 0;
      if (byRound && r !== lastRound) { n = 0; lastRound = r; }
      nums.push(++n);
    });
    // 유형 표시: "tag"(발문 끝 꼬리표), "section"(유형이 바뀌는 곳에 구간 제목), "both", "none"
    var mark = opts.typeMark || "tag";
    var showTag = mark === "tag" || mark === "both";
    var showSection = mark === "section" || mark === "both";
    lastRound = null;
    var lastType = null;
    doc.problems.forEach(function (p, i) {
      var t = TYPE_BY_KEY[p.type];
      if (byRound && (p.round || 0) !== lastRound) {
        if (lastRound !== null) blocks.push({ kind: "pagebreak", runs: [] });
        lastRound = p.round || 0;
        lastType = null;
        blocks.push({ kind: "roundTitle", runs: [plain((lastRound + 1) + "회차")] });
      }
      if (showSection && t && p.type !== lastType) {
        var end = i;
        while (end + 1 < doc.problems.length && doc.problems[end + 1].type === p.type && (!byRound || (doc.problems[end + 1].round || 0) === (p.round || 0))) end++;
        blocks.push({ kind: "typeHead", runs: [
          plain(TYPE_ICON[p.type] + " " + t.name, "typeHead"),
          plain("   " + (end > i ? nums[i] + "–" + nums[end] + "번" : nums[i] + "번"), "typeRange")
        ] });
      }
      lastType = p.type;
      if (labels[i]) blocks.push({ kind: "src", runs: [plain(labels[i])] });
      var askRuns = [plain(String(nums[i]), "num"), { text: "", u: false, b: false, tab: true }].concat(parseRuns(p.instruction));
      if (showTag && t) askRuns.push(plain(" "), plain("\u00a0" + TYPE_ICON[p.type] + " " + t.name + "\u00a0", "tag"));
      blocks.push({ kind: "ask", first: !labels[i] && !(showSection && blocks[blocks.length - 1].kind === "typeHead"), runs: askRuns });
      // 어법·어휘·어법 고치기 문제는 밑줄 친 부분을 굵게 해서 잘 보이게 한다.
      var runsOf = BOLD_UNDERLINE_TYPES[p.type]
        ? function (l) { return parseRuns(l).map(function (r) { if (r.u) r.b = true; return r; }); }
        : parseRuns;
      var boxBlocks = p.box ? String(p.box).split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "box", runs: runsOf(l) }; }) : [];
      var paraBlocks = String(p.passage || "").split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return { kind: "para", runs: runsOf(l) }; });
      if (p.boxFirst) blocks.push.apply(blocks, boxBlocks.concat(paraBlocks));
      else blocks.push.apply(blocks, paraBlocks.concat(boxBlocks));
      if (p.choices) {
        p.choices.forEach(function (c, ci) {
          blocks.push({ kind: "choice", runs: [plain(CIRCLED[ci] + " ")].concat(parseRuns(c)) });
        });
      }
      if (p.type === "fix") {
        FIX_CONDITIONS.forEach(function (line, k) {
          blocks.push({ kind: "box", runs: [plain(line)], first: k === 0 });
        });
        blocks.push({ kind: "answerTable", runs: [], header: FIX_TABLE_HEADER, rows: 2 });
      } else if (p.type === "summaryWrite") {
        blocks.push({ kind: "answerLine", runs: [plain("(A) ___________  (B) ___________  (C) ___________")] });
      } else if (WRITE_TYPES[p.type]) {
        blocks.push({ kind: "answerLine", runs: [plain("답: ______________________________________")] });
      }
    });

    if (opts.answers !== false && doc.problems.length) {
      blocks.push({ kind: "pagebreak", runs: [] });
      blocks.push({ kind: "ansTitle", full: true, runs: [plain("정답" + (opts.explanations ? " 및 해설" : ""))] });
      // 한눈에 보는 정답표: 객관식(①~⑤) 정답만, 쪽 전체 너비로. 회차를 나누면 회차마다 하나씩.
      var gridGroups = [];
      doc.problems.forEach(function (p, i) {
        if (CIRCLED.indexOf(p.answer) < 0) return;
        var r = byRound ? (p.round || 0) : 0;
        var g = gridGroups[gridGroups.length - 1];
        if (!g || g.round !== r) { g = { round: r, cells: [] }; gridGroups.push(g); }
        g.cells.push([String(nums[i]), p.answer]);
      });
      gridGroups.forEach(function (g) {
        if (byRound) blocks.push({ kind: "gridCaption", full: true, runs: [plain("[" + (g.round + 1) + "회차]", "ansNum")] });
        blocks.push({ kind: "answerGrid", full: true, runs: [], cells: g.cells, perRow: GRID_PER_ROW });
      });
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
    box: "body", para: "body", choice: "body", answerLine: "body", ansTitle: "ansTitle", ans: "ans", roundTitle: "ansTitle", typeHead: "typeHead", gridCaption: "ans", answerTable: "body"
  };
  var KIND_PARA = {
    eyebrow: "eyebrow", title: "title", nameLine: "nameLine", src: "src", ask: "ask",
    box: "box", para: "body", choice: "choice", answerLine: "answerLine", ansTitle: "ansTitle", ans: "ans", roundTitle: "ansTitle", typeHead: "typeHead", gridCaption: "gridCaption", answerTable: "body"
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
    controls += story("footer", "BOTTOM", "footer", hfRuns(footer.left, [{ text: "", pageNum: true, role: "hf" }], footer.right));

    // 첫 블록은 쪽 설정이 들어 있는 첫 문단에 함께 넣는다(첫 블록은 늘 쪽 전체 너비인 제목 부분).
    var first = blocks[0];
    var firstPara = template.__firstPara.replace('paraPrIDRef="0"', 'paraPrIDRef="' + style.para[KIND_PARA[first.kind]] + '"');
    var xml = [template.__secHead, firstPara + controls + "</hp:run>" + hwpxRuns(style, first.runs, first.kind) + "</hp:p>"];

    // 쪽 전체 너비 블록(full)과 단 블록이 바뀌는 문단 맨 앞에 단 설정을 새로 넣는다.
    var pendingBreak = false, currentCols = 1;
    blocks.slice(1).forEach(function (bl) {
      if (bl.kind === "pagebreak") { pendingBreak = true; return; }
      var nextId = function () { return pid++; };
      var runsXml = bl.kind === "answerGrid" ? '<hp:run charPrIDRef="0">' + gridTableXml(template, bl, nextId) + "</hp:run>"
        : bl.kind === "answerTable" ? '<hp:run charPrIDRef="0">' + answerTableXml(template, bl, nextId, bl.full ? 1 : columns) + "</hp:run>"
        : hwpxRuns(style, bl.runs, bl.kind);
      var want = bl.full ? 1 : columns;
      if (want !== currentCols) {
        runsXml = '<hp:run charPrIDRef="0">' + colPrXml(want, template.__colRule) + "</hp:run>" + runsXml;
        currentCols = want;
      }
      var kind = bl.kind === "answerGrid" ? "gridCaption" : bl.kind;
      xml.push(p(kind, runsXml, { pageBreak: pendingBreak, first: bl.first }));
      pendingBreak = false;
    });
    xml.push("</hs:sec>");
    return xml.join("");
  }

  // 정답표(번호 칸 + 정답 칸 쌍을 한 줄에 perRow개)를 HWPX 표로 만든다.
  function gridTableXml(template, bl, nextId) {
    var style = template.__style;
    var per = bl.perRow, rows = Math.ceil(bl.cells.length / per), cols = per * 2;
    var numW = 2302, ansW = 2800, rowH = 1150;
    function cell(text, isNum, r, c) {
      return '<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + style.borderFill[isNum ? "gridNum" : "gridAns"] + '">' +
        '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
        '<hp:p paraPrIDRef="' + style.para.gridCell + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" id="' + nextId() + '"><hp:run charPrIDRef="' + style.char[isNum ? "gridNum" : "gridAns"] + '">' +
        (text ? "<hp:t>" + xmlEscape(text) + "</hp:t>" : "<hp:t/>") + "</hp:run></hp:p></hp:subList>" +
        '<hp:cellAddr colAddr="' + c + '" rowAddr="' + r + '"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="' + (isNum ? numW : ansW) + '" height="' + rowH + '"/>' +
        '<hp:cellMargin left="100" right="100" top="60" bottom="60"/></hp:tc>';
    }
    var trs = [];
    for (var r = 0; r < rows; r++) {
      var tds = [];
      for (var k = 0; k < per; k++) {
        var item = bl.cells[r * per + k] || ["", ""];
        tds.push(cell(item[0], true, r, k * 2), cell(item[1], false, r, k * 2 + 1));
      }
      trs.push("<hp:tr>" + tds.join("") + "</hp:tr>");
    }
    return '<hp:tbl id="' + nextId() + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="' + rows + '" colCnt="' + cols + '" cellSpacing="0" borderFillIDRef="' + style.borderFill.gridAns + '" noAdjust="0">' +
      '<hp:sz width="' + (numW + ansW) * per + '" widthRelTo="ABSOLUTE" height="' + rowH * rows + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="100" right="100" top="60" bottom="60"/>' +
      trs.join("") + "</hp:tbl>";
  }

  // 표 블록의 행: 머리 행 + (rows가 숫자면 빈 행 그만큼, 배열이면 그 내용)
  function tableRows(bl) {
    var body = Array.isArray(bl.rows) ? bl.rows : range(bl.rows).map(function () { return bl.header.map(function () { return ""; }); });
    return [bl.header].concat(body);
  }

  // 표 블록(서술형 답안 표, 워크북 단어 표). 기본은 한 단 너비 안에 들어가는 3칸 답안 표.
  // bl.widths: 칸 너비 비율, bl.span: 본문 너비에 대한 표 너비 비율
  function tableWidths(bl, total) {
    var w = bl.widths || [5000, 8500, 8500];
    if (!bl.span) return w;
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    return w.map(function (x) { return Math.floor(total * bl.span * x / sum); });
  }

  function answerTableXml(template, bl, nextId, columns) {
    var style = template.__style;
    var colWidth = columns === 2 ? Math.floor((template.__bodyWidth - 1984) / 2) : template.__bodyWidth;
    var widths = tableWidths(bl, colWidth), headH = 1300, rowH = Array.isArray(bl.rows) ? 1300 : 1900;
    var rows = tableRows(bl);
    var bodyRows = rows.length - 1;
    var trs = rows.map(function (row, r) {
      return "<hp:tr>" + row.map(function (text, c) {
        var head = r === 0;
        return '<hp:tc name="" header="' + (head ? 1 : 0) + '" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + style.borderFill[head ? "gridNum" : "gridAns"] + '">' +
          '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
          '<hp:p paraPrIDRef="' + style.para.gridCell + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0" id="' + nextId() + '"><hp:run charPrIDRef="' + style.char[head ? "gridNum" : "gridAns"] + '">' +
          (text ? "<hp:t>" + xmlEscape(text) + "</hp:t>" : "<hp:t/>") + "</hp:run></hp:p></hp:subList>" +
          '<hp:cellAddr colAddr="' + c + '" rowAddr="' + r + '"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="' + widths[c] + '" height="' + (head ? headH : rowH) + '"/>' +
          '<hp:cellMargin left="100" right="100" top="60" bottom="60"/></hp:tc>';
      }).join("") + "</hp:tr>";
    });
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    return '<hp:tbl id="' + nextId() + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="' + (bodyRows > 8 ? 1 : 0) + '" rowCnt="' + rows.length + '" colCnt="' + widths.length + '" cellSpacing="0" borderFillIDRef="' + style.borderFill.gridAns + '" noAdjust="0">' +
      '<hp:sz width="' + total + '" widthRelTo="ABSOLUTE" height="' + (headH + rowH * bodyRows) + '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="100" right="100" top="60" bottom="60"/>' + trs.join("") + "</hp:tbl>";
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

  // blocks: 미리 만든 서식 블록(워크북 메이커처럼 다른 문서 구성을 쓸 때). 없으면 문제지 블록을 만든다.
  function buildHwpx(template, doc, blocks) {
    blocks = blocks || buildBlocks(doc);
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
    ansTitle: [BATANG, 14, true], ansNum: [BATANG, 9.5, true, NAVY], ans: [BATANG, 9.5], explain: [BATANG, 8.5, false, "444444"],
    tag: [DOTUM, 8, true, NAVY, "E3EAF5"], typeHead: [DOTUM, 10.5, true, NAVY], typeRange: [DOTUM, 8, false, "6B7688"],
    gridNum: [DOTUM, 8.5, false, "333333"], gridAns: [BATANG, 9.5]
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
    gridCaption: '<w:keepNext/><w:spacing w:before="120" w:after="60"/>',
    roundTitle: '<w:keepNext/><w:spacing w:after="100"/><w:jc w:val="center"/>',
    typeHead: '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="' + NAVY + '"/></w:pBdr><w:spacing w:before="280" w:after="60"/>',
    ans: '<w:spacing w:after="20" w:line="290" w:lineRule="auto"/><w:ind w:left="260" w:hanging="260"/>'
  };

  function docxRun(run, kind) {
    if (run.tab) return "<w:r><w:tab/></w:r>";
    var c = DOCX_CHAR[run.role || KIND_CHAR[kind]] || DOCX_CHAR.body;
    var props = '<w:rFonts w:ascii="' + EN + '" w:hAnsi="' + EN + '" w:eastAsia="' + c[0] + '" w:cs="' + EN + '"/>';
    if (run.b || c[2]) props += "<w:b/>";
    if (c[3]) props += '<w:color w:val="' + c[3] + '"/>';
    props += '<w:sz w:val="' + Math.round(c[1] * 2) + '"/><w:szCs w:val="' + Math.round(c[1] * 2) + '"/>';
    if (c[4]) props += '<w:shd w:val="clear" w:color="auto" w:fill="' + c[4] + '"/>';
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

  // 정답표를 Word 표로 만든다.
  function docxGridTable(bl) {
    var per = bl.perRow, rows = Math.ceil(bl.cells.length / per);
    var numW = 460, ansW = Math.floor(BODY_TWIP / per) - 460;
    var border = '<w:top w:val="single" w:sz="4" w:color="AEB6C4"/><w:left w:val="single" w:sz="4" w:color="AEB6C4"/><w:bottom w:val="single" w:sz="4" w:color="AEB6C4"/><w:right w:val="single" w:sz="4" w:color="AEB6C4"/><w:insideH w:val="single" w:sz="4" w:color="AEB6C4"/><w:insideV w:val="single" w:sz="4" w:color="AEB6C4"/>';
    var grid = "";
    for (var k = 0; k < per; k++) grid += '<w:gridCol w:w="' + numW + '"/><w:gridCol w:w="' + ansW + '"/>';
    function cell(text, isNum) {
      var run = text ? docxRun({ text: text, role: isNum ? "gridNum" : "gridAns" }, "ans") : "";
      return '<w:tc><w:tcPr><w:tcW w:w="' + (isNum ? numW : ansW) + '" w:type="dxa"/>' + (isNum ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F6"/>' : "") +
        '<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>' + run + "</w:p></w:tc>";
    }
    var trs = "";
    for (var r = 0; r < rows; r++) {
      var tds = "";
      for (var c = 0; c < per; c++) {
        var item = bl.cells[r * per + c] || ["", ""];
        tds += cell(item[0], true) + cell(item[1], false);
      }
      trs += "<w:tr>" + tds + "</w:tr>";
    }
    return '<w:tbl><w:tblPr><w:tblW w:w="' + BODY_TWIP + '" w:type="dxa"/><w:tblBorders>' + border + '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + grid + "</w:tblGrid>" + trs + "</w:tbl>";
  }

  function docxAnswerTable(bl, columns) {
    var widths = bl.span ? tableWidths(bl, columns === 2 ? Math.floor((BODY_TWIP - 567) / 2) : BODY_TWIP) : [1000, 1700, 1700];
    var border = '<w:top w:val="single" w:sz="4" w:color="AEB6C4"/><w:left w:val="single" w:sz="4" w:color="AEB6C4"/><w:bottom w:val="single" w:sz="4" w:color="AEB6C4"/><w:right w:val="single" w:sz="4" w:color="AEB6C4"/><w:insideH w:val="single" w:sz="4" w:color="AEB6C4"/><w:insideV w:val="single" w:sz="4" w:color="AEB6C4"/>';
    var filled = Array.isArray(bl.rows);
    var trs = tableRows(bl).map(function (row, r) {
      return '<w:tr><w:trPr>' + (r === 0 && filled ? "<w:tblHeader/>" : "") + '<w:trHeight w:val="' + (r && !filled ? 380 : 260) + '"/></w:trPr>' + row.map(function (text, c) {
        return '<w:tc><w:tcPr><w:tcW w:w="' + widths[c] + '" w:type="dxa"/>' + (r === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F6"/>' : "") +
          '<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>' +
          (text ? docxRun({ text: text, role: r ? "gridAns" : "gridNum" }, "ans") : "") + "</w:p></w:tc>";
      }).join("") + "</w:tr>";
    }).join("");
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    return '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:tblBorders>' + border + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" + trs + "</w:tbl>";
  }

  function buildDocxBody(blocks, doc) {
    var columns = doc.options && doc.options.columns === 1 ? 1 : 2;
    var items = []; // {ppr, body} 문단 또는 {table}
    var pendingBreak = false, currentFull = true;
    blocks.forEach(function (bl) {
      if (bl.kind === "pagebreak") { pendingBreak = true; return; }
      var full = !!bl.full;
      // 쪽 전체 너비 ↔ 단이 바뀌면 바로 앞 문단에서 구역을 끝낸다(앞 문단이 표면 빈 문단을 하나 넣는다).
      if (columns === 2 && full !== currentFull && items.length) {
        var last = items[items.length - 1];
        if (last.table) { last = { ppr: '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>', body: "" }; items.push(last); }
        last.ppr += docxSectPr(currentFull ? 1 : 2);
      }
      currentFull = full;
      if (bl.kind === "answerGrid") {
        items.push({ table: docxGridTable(bl) });
        return;
      }
      if (bl.kind === "answerTable") {
        items.push({ table: docxAnswerTable(bl, full ? 1 : columns) });
        return;
      }
      var key = bl.kind === "ask" && bl.first ? "askFirst" : bl.kind;
      items.push({ ppr: (pendingBreak ? "<w:pageBreakBefore/>" : "") + DOCX_PARA[key], body: bl.runs.map(function (r) { return docxRun(r, bl.kind); }).join("") });
      pendingBreak = false;
    });
    var out = items.map(function (it) { return it.table ? it.table : "<w:p><w:pPr>" + it.ppr + "</w:pPr>" + it.body + "</w:p>"; });
    out.push(docxSectPr(columns === 2 && !currentFull ? 2 : 1));
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

  function buildDocx(doc, blocks) {
    blocks = blocks || buildBlocks(doc);
    var layout = doc.layout || {};
    var header = layout.header || {}, footer = layout.footer || {};
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
      buildDocxBody(blocks, doc) + "</w:body></w:document>";
    var headerXml = docxStory("hdr", "header", hfRuns(header.left, [], header.right),
      header.left || header.right ? '<w:bottom w:val="single" w:sz="4" w:space="4" w:color="999999"/>' : "");
    var footerXml = docxStory("ftr", "footer", hfRuns(footer.left, [{ text: "", pageNum: true, role: "hf" }], footer.right),
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
    normalizeText: normalizeText,
    extractJsonAll: extractJsonAll,
    TYPE_ICON: TYPE_ICON,
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
    FIXED_ANSWER_TYPES: FIXED_ANSWER_TYPES,
    buildCombinedPrompt: buildCombinedPrompt,
    parseBulkPassages: parseBulkPassages,
    normalizeNo: normalizeNo,
    noLabel: noLabel,
    parseAiProblems: parseAiProblems,
    parseRuns: parseRuns,
    problemSignature: problemSignature,
    findDuplicates: findDuplicates,
    avoidNote: avoidNote,
    needsReview: needsReview,
    checkProblem: checkProblem,
    buildReviewPrompt: buildReviewPrompt,
    applyReview: applyReview,
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
