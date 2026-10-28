// 영어 메이커 안의 탭(iframe)에서 Claude 화면 기능(AI 만들기, 파일 저장)을 쓰게 하는 다리.
// 탭은 바깥 페이지와 같은 출처라서 바깥의 window.claude를 빌려 쓴다.
// Claude 화면은 '자기 창에서 만든' 평범한 객체만 받는다. 탭 안에서 만든 객체({}, 배열, AbortSignal, Blob)는
// 다른 창의 것이라 거절될 수 있으므로, 넘기는 값은 모두 바깥 창에서 새로 만들어 넘긴다.
(function () {
  var outer;
  try { outer = window.parent !== window ? window.parent : null; } catch (e) { outer = null; }
  if (!outer || window.claude) return;
  var claude;
  try { claude = outer.claude; } catch (e) { return; }
  if (!claude || typeof claude.use !== "function") return;

  // 문자열·숫자·불리언과 그 배열·객체를 바깥 창의 값으로 다시 만든다.
  function toOuter(value) {
    if (value === null || typeof value !== "object") return value;
    return outer.JSON.parse(JSON.stringify(value));
  }

  function outerSignal(signal) {
    var c = new outer.AbortController();
    if (signal.aborted) c.abort();
    else signal.addEventListener("abort", function () { c.abort(); });
    return c.signal;
  }

  // sample 옵션: 함수(onText, tools의 execute)와 signal·images는 따로 옮기고, 나머지는 바깥 창 객체로.
  function outerOptions(opts) {
    if (opts === undefined || opts === null) return opts;
    var copy = new outer.Object();
    Object.keys(opts).forEach(function (k) {
      var v = opts[k];
      if (k === "signal" && v) copy.signal = outerSignal(v);
      else if (k === "onText" && typeof v === "function") copy.onText = function (u) { v({ text: u.text, delta: u.delta }); };
      else if (k === "images" && v) copy.images = toOuterBlobs(v);
      else if (k === "tools" && Array.isArray(v)) copy.tools = outerTools(v);
      else copy[k] = toOuter(v);
    });
    return copy;
  }

  function outerTools(tools) {
    var list = new outer.Array();
    tools.forEach(function (t) {
      var o = new outer.Object();
      o.name = t.name;
      o.description = t.description;
      if (t.inputSchema) o.inputSchema = toOuter(t.inputSchema);
      o.execute = function (input) { return Promise.resolve(t.execute(JSON.parse(JSON.stringify(input)))).then(toOuter); };
      list.push(o);
    });
    return list;
  }

  function toOuterBlob(b) { return b instanceof outer.Blob ? b : new outer.Blob([b], { type: b.type || "" }); }
  function toOuterBlobs(v) {
    if (v && typeof v.length === "number" && !(v instanceof Blob)) {
      var arr = new outer.Array();
      Array.prototype.forEach.call(v, function (b) { arr.push(toOuterBlob(b)); });
      return arr;
    }
    return toOuterBlob(v);
  }

  // 결과·오류는 탭 안의 평범한 값으로 바꿔 돌려준다.
  function back(promise) {
    return Promise.resolve(promise).then(
      function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); },
      function (e) {
        var err = new Error(e && e.message ? String(e.message) : String(e));
        if (e && e.code) err.code = String(e.code);
        if (e && e.text !== undefined) err.text = e.text;
        throw err;
      }
    );
  }

  function wrap(name, ns) {
    if (!ns) return ns;
    if (name === "sample") {
      var f = function (input, opts) { return back(ns(toOuter(input), outerOptions(opts))); };
      f.json = function (input, opts) { return back(ns.json(toOuter(input), outerOptions(opts))); };
      if (typeof ns.limits === "function") f.limits = function () { return back(ns.limits()); };
      return f;
    }
    if (name === "downloads") {
      return {
        save: function (arg) {
          var data = arg.data;
          if (typeof data !== "string") data = toOuterBlob(data instanceof Blob ? data : new Blob([data]));
          var req = new outer.Object();
          req.filename = String(arg.filename);
          req.data = data;
          if (arg.request) req.request = String(arg.request);
          return back(ns.save(req));
        }
      };
    }
    return ns;
  }

  window.claude = { use: function (name) { return claude.use(name).then(function (ns) { return wrap(name, ns); }); } };
})();
