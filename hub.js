// hub.js — fills the hub's news windows from news.json (written by
// scripts/fetch_news.py via the news.yml Action). Plain DOM, no dependencies.
(function () {
  "use strict";

  // Words that move the Doom Desk's needle, and the verdict for each band.
  var DOOM_WORDS = /\b(risk|extinction|existential|doom|catastroph\w*|superintelligen\w*|misalign\w*|takeover|bubble|collapse|unemployment|layoffs?|jobs?|deceptive|scheming|loss of control|arms race|p\(doom\))\b/gi;
  var VERDICTS = [
    [0.15, "Mild concern. Someone has probably written a strongly worded blog post."],
    [0.35, "Elevated. Several people on LessWrong have stopped sleeping."],
    [0.6, "High. Tea is being drunk nervously in Berkeley."],
    [1.01, "Severe. The paperclips are on order."]
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function ago(iso) {
    if (!iso) return "";
    var mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 60) return mins + "m ago";
    if (mins < 2880) return Math.round(mins / 60) + "h ago";
    return Math.round(mins / 1440) + "d ago";
  }

  function render(id, items, withBlurb) {
    var ul = document.getElementById(id);
    if (!ul) return;
    ul.textContent = "";
    if (!items || !items.length) { ul.appendChild(el("li", "muted", "Nothing to show right now.")); return; }
    items.forEach(function (it) {
      var li = el("li");
      var a = el("a", null, it.title);
      a.href = it.url; a.target = "_blank"; a.rel = "noopener";
      li.appendChild(a);
      li.appendChild(el("span", "meta", it.source + (it.date ? " · " + ago(it.date) : "")));
      if (withBlurb && it.summary) li.appendChild(el("span", "blurb", it.summary));
      ul.appendChild(li);
    });
  }

  function doom(items) {
    var text = (items || []).map(function (i) { return i.title + " " + i.summary; }).join(" ");
    var hits = (text.match(DOOM_WORDS) || []).length;
    var score = Math.min(1, hits / Math.max(1, (items || []).length * 2.5));
    document.getElementById("doom-fill").style.width = Math.round(score * 100) + "%";
    var verdict = VERDICTS.filter(function (v) { return score < v[0]; })[0][1];
    document.getElementById("doom-read").textContent =
      "Doom-o-meter: " + Math.round(score * 100) + "%. " + verdict;
  }

  fetch("news.json?t=" + Date.now())
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var w = d.windows || {};
      render("news-art", w.art, true);
      render("news-film", w.film, true);
      render("news-theatre", w.theatre, true);
      render("news-doom", w.doom, false);
      doom(w.doom);
      document.getElementById("hub-updated").textContent = "News updated " + ago(d.updated);
    })
    .catch(function () {
      document.getElementById("hub-updated").textContent = "Couldn't load the news just now.";
      ["art", "film", "theatre", "doom"].forEach(function (k) { render("news-" + k, [], false); });
    });
})();
