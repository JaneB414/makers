// 영어 메이커 안의 탭(iframe)에서 Claude 화면 기능(AI 만들기, 파일 저장)을 쓰게 하는 다리.
// 탭은 바깥 페이지와 같은 출처라서 바깥의 window.claude를 빌려 쓴다.
// AbortSignal·Blob은 바깥 창에서 다시 만들어 넘긴다(창이 다르면 같은 종류로 알아보지 못할 수 있다).
(function () {
  var outer;
  try { outer = window.parent !== window ? window.parent : null; } catch (e) { outer = null; }
  if (!outer || window.claude) return;
  var claude;
  try { claude = outer.claude; } catch (e) { return; }
  if (!claude || typeof claude.use !== "function") return;

  function outerOptions(opts) {
    if (!opts || !opts.signal) return opts;
    var c = new outer.AbortController();
    if (opts.signal.aborted) c.abort();
    else opts.signal.addEventListener("abort", function () { c.abort(); });
    var copy = {};
    Object.keys(opts).forEach(function (k) { copy[k] = opts[k]; });
    copy.signal = c.signal;
    return copy;
  }

  function wrap(name, ns) {
    if (!ns) return ns;
    if (name === "sample") {
      var f = function (input, opts) { return ns(input, outerOptions(opts)); };
      f.json = function (input, opts) { return ns.json(input, outerOptions(opts)); };
      if (typeof ns.limits === "function") f.limits = function () { return ns.limits(); };
      return f;
    }
    if (name === "downloads") {
      return {
        save: function (arg) {
          var data = arg.data;
          if (data instanceof Blob) data = new outer.Blob([data], { type: data.type });
          return ns.save({ filename: arg.filename, data: data });
        }
      };
    }
    return ns;
  }

  window.claude = { use: function (name) { return claude.use(name).then(function (ns) { return wrap(name, ns); }); } };
})();
