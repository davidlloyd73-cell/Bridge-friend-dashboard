// =============================================================================
// tabs.js — the dashboard's section tabs (index.html only).
//
// Plain DOM, no dependencies. The tab to open comes from the URL hash
// (#round — so a tab can be linked to), else the last one used on this device,
// else the first. Follows the WAI-ARIA tabs pattern: arrow keys, Home and End
// move between tabs. Announces a "tabchange" event on window so app.js can
// resize charts that were drawn while their pane was hidden.
// =============================================================================
(function () {
  var KEY = "bridge-tab";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tabs [data-tab]"));
  if (!tabs.length) return;
  var names = tabs.map(function (t) { return t.getAttribute("data-tab"); });

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function pick(name) { return names.indexOf(name) >= 0 ? name : null; }

  function show(name, focus, remember) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-tab") === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      var pane = document.getElementById("tab-" + t.getAttribute("data-tab"));
      if (pane) pane.hidden = !on;
    });
    if (remember) {
      try { localStorage.setItem(KEY, name); } catch (e) { /* not remembered */ }
      try { history.replaceState(null, "", "#" + name); } catch (e) { /* file:// etc. */ }
    }
    window.dispatchEvent(new Event("tabchange"));
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t.getAttribute("data-tab"), false, true); });
    t.addEventListener("keydown", function (e) {
      var to = e.key === "ArrowRight" ? (i + 1) % tabs.length
        : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
        : e.key === "Home" ? 0
        : e.key === "End" ? tabs.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      show(names[to], true, true);
    });
  });

  window.addEventListener("hashchange", function () {
    var n = pick(location.hash.slice(1));
    if (n) show(n, false, false);
  });

  show(pick(location.hash.slice(1)) || pick(stored()) || names[0], false, false);
})();
