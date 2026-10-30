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
      render("news-music", w.music, true);
      render("news-food", w.food, true);
      render("news-bridge", w.bridge, false);
      render("news-doom", w.doom, false);
      doom(w.doom);
      document.getElementById("hub-updated").textContent = "News updated " + ago(d.updated);
    })
    .catch(function () {
      document.getElementById("hub-updated").textContent = "Couldn't load the news just now.";
      ["art", "film", "theatre", "music", "food", "bridge", "doom"].forEach(function (k) { render("news-" + k, [], false); });
    });

  // ---- Hand of the day: the same deal for everyone, seeded by the date -------
  var SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
  var RANKS = "AKQJT98765432";
  var VUL = ["None", "N-S", "E-W", "Both", "N-S", "E-W", "Both", "None", "E-W", "Both", "None", "N-S", "Both", "None", "N-S", "E-W"];

  function rng(seed) {                       // mulberry32
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dealOfTheDay() {
    var now = new Date();
    var day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
    var rand = rng(day * 2654435761);
    var deck = [];
    for (var s = 0; s < 4; s++) for (var r = 0; r < 13; r++) deck.push([s, r]);
    for (var i = 51; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), x = deck[i]; deck[i] = deck[j]; deck[j] = x;
    }
    var hands = [0, 1, 2, 3].map(function (h) {
      return deck.slice(h * 13, h * 13 + 13).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    });
    var board = day % 16 + 1;
    return { hands: hands, board: board, dealer: "NESW"[(board - 1) % 4], vul: VUL[board - 1] };
  }

  function handNode(cls, label, cards) {
    var d = el("div", "hand " + cls);
    var hcp = cards.reduce(function (n, c) { return n + Math.max(0, 4 - c[1]); }, 0);
    d.appendChild(el("b", null, label + " \u00B7 " + hcp + " HCP"));
    for (var s = 0; s < 4; s++) {
      var line = el("div");
      var sym = el("span", s === 1 || s === 2 ? "red" : null, SUITS[s] + " ");
      line.appendChild(sym);
      var held = cards.filter(function (c) { return c[0] === s; }).map(function (c) { return RANKS[c[1]]; }).join("");
      line.appendChild(document.createTextNode(held.replace("T", "10") || "\u2014"));
      d.appendChild(line);
    }
    return d;
  }

  function showDeal() {
    var host = document.getElementById("deal");
    if (!host) return;
    var d = dealOfTheDay();
    host.appendChild(handNode("n", "North", d.hands[0]));
    host.appendChild(handNode("w", "West", d.hands[3]));
    var info = el("div", "info");
    info.appendChild(el("div", null, "Hand of the day"));
    info.appendChild(el("div", null, "Board " + d.board));
    info.appendChild(el("div", null, "Dealer " + d.dealer));
    info.appendChild(el("div", null, "Vul " + d.vul));
    host.appendChild(info);
    host.appendChild(handNode("e", "East", d.hands[1]));
    host.appendChild(handNode("s", "South", d.hands[2]));
  }

  // ---- London now: weather (Open-Meteo) and Tube status (TfL), both keyless --
  function wxIcon(c) {
    if (c === 0) return "\u2600\uFE0F";
    if (c <= 2) return "\uD83C\uDF24\uFE0F";
    if (c === 3) return "\u2601\uFE0F";
    if (c === 45 || c === 48) return "\uD83C\uDF2B\uFE0F";
    if (c >= 51 && c <= 57) return "\uD83C\uDF26\uFE0F";
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "\uD83C\uDF27\uFE0F";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "\uD83C\uDF28\uFE0F";
    return "\u26C8\uFE0F";
  }

  function showWeather() {
    var host = document.getElementById("weather");
    fetch("https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=Europe%2FLondon&forecast_days=3")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        host.textContent = "";
        d.daily.time.forEach(function (t, i) {
          var day = el("div", "day");
          var name = i === 0 ? "Today" : new Date(t + "T12:00").toLocaleDateString("en-GB", { weekday: "short" });
          day.appendChild(el("div", "d", name));
          day.appendChild(el("div", "ico", wxIcon(d.daily.weather_code[i])));
          day.appendChild(el("div", "t", Math.round(d.daily.temperature_2m_max[i]) + "\u00B0 / " + Math.round(d.daily.temperature_2m_min[i]) + "\u00B0"));
          day.appendChild(el("div", "d", d.daily.precipitation_probability_max[i] + "% rain"));
          host.appendChild(day);
        });
      })
      .catch(function () { host.textContent = ""; host.appendChild(el("p", "muted", "Weather unavailable.")); });
  }

  function showTube() {
    var host = document.getElementById("tube");
    fetch("https://api.tfl.gov.uk/Line/Mode/tube,elizabeth-line/Status")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (lines) {
        var bad = lines.filter(function (l) { return l.lineStatuses[0].statusSeverity !== 10; });
        host.textContent = "";
        if (!bad.length) { host.appendChild(el("p", "tube-ok", "Good service on all lines.")); return; }
        bad.forEach(function (l) {
          var row = el("div", "tube-line");
          row.appendChild(el("span", null, l.name));
          row.appendChild(el("span", "st", l.lineStatuses[0].statusSeverityDescription));
          host.appendChild(row);
        });
        host.appendChild(el("p", "tube-note", "All other lines: good service."));
      })
      .catch(function () { host.textContent = ""; host.appendChild(el("p", "muted", "Tube status unavailable.")); });
  }

  showDeal();
  showWeather();
  showTube();
  setInterval(showTube, 5 * 60 * 1000);
})();
