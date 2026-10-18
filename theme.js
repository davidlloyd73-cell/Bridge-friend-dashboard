// =============================================================================
// theme.js — light / dark switch, shared by both pages.
//
// Loaded in <head>, before the stylesheet paints, so the right theme is on
// <html> from the first frame (no flash of dark on a light device). Uses the
// saved choice if there is one, otherwise follows the device setting. The
// choice is a convenience: if storage is blocked it simply isn't remembered.
// Charts bake their colours in, so a change is announced as a "themechange"
// event on window for app.js to rebuild them.
// =============================================================================
(function () {
  var KEY = "bridge-theme";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var button = null;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; }
    catch (e) { return null; }
  }
  function current() { return saved() || (mq && mq.matches ? "light" : "dark"); }

  function apply(announce) {
    var t = current();
    root.setAttribute("data-theme", t);
    if (button) {
      button.textContent = t === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
      button.title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
      button.setAttribute("aria-label", button.title);
    }
    if (announce) window.dispatchEvent(new Event("themechange"));
  }

  apply(false);
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (!saved()) apply(true); });

  document.addEventListener("DOMContentLoaded", function () {
    var host = document.querySelector(".header-status");
    if (!host) return;
    button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered */ }
      apply(true);
    });
    host.insertBefore(button, host.firstChild);
    apply(false);
  });
})();
