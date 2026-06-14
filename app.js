// =============================================================================
// app.js — fetch, parse, compute, render, and poll the Bridge Friends sheet.
// Vanilla JS module. Chart.js is loaded globally from the CDN (window.Chart).
// You normally never need to edit this file — settings live in config.js.
// =============================================================================

import { CONFIG } from "./config.js";

// ---- Fixed players & their signature colours (hex must match styles.css) ----
const PLAYERS = CONFIG.PLAYERS; // ["David","Vivienne","Hamish","Caroline"]
const COLORS = {
  David: "#2563eb",
  Vivienne: "#16a34a",
  Hamish: "#ea580c",
  Caroline: "#9333ea",
  Unknown: "#6b7280",
};

// Column indices for the raw "Form responses 1" tab, range A:L.
const COL = {
  TIMESTAMP: 0, // A  dd/mm/yyyy HH:MM:SS
  DATE: 1,      // B  dd/mm/yyyy   (session date)
  HAND: 2,      // C  hand number
  PLAYER: 3,    // D  player name
  HCP: 4,       // E  point count of hand (high-card points)
  WON_AUCTION: 5, // F  Yes/No
  DECLARER: 6,  // G  declarer name or blank
  CONTRACT_LEVEL: 7, // H  bid level 1-7 (blank for defenders)
  SUIT: 8,      // I  Clubs/Diamonds/Hearts/Spades/No Trumps
  TRICKS_MADE: 9, // J  tricks actually won
  DOUBLED: 10,  // K  blank / Doubled / Redoubled
  SCORE: 11,    // L  points scored by that player for the hand
};

// ---- Polling / backoff state ----
let pollTimer = null;
let lastSignature = null;       // change-detection: rowCount + newest timestamp
let lastGoodModel = null;       // last successfully parsed model (kept on error)
let consecutiveErrors = 0;
let backoffUntil = 0;           // epoch ms; don't fetch before this on errors

// ---- Chart instances (created lazily) ----
let chartAllTime = null;
let chart2026 = null;

// ---- Sort state for the standings table ----
let sortState = { key: "grand", dir: "desc" };

// =============================================================================
// Utilities
// =============================================================================

/** Safe number parser: blanks/undefined -> 0, strips commas & spaces. */
function num(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise a player name to one of the fixed four, else "Unknown". */
function normPlayer(v) {
  const s = String(v ?? "").trim();
  const hit = PLAYERS.find((p) => p.toLowerCase() === s.toLowerCase());
  return hit || "Unknown";
}

/**
 * Parse a UK date string "dd/mm/yyyy" (optionally with " HH:MM:SS") into a Date.
 * Never interprets as US mm/dd. Returns null if unparseable.
 */
function parseUKDate(v) {
  if (!v) return null;
  const str = String(v).trim();
  const [datePart, timePart] = str.split(/\s+/, 2);
  const m = datePart.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  let [, dd, mm, yyyy] = m;
  dd = parseInt(dd, 10);
  mm = parseInt(mm, 10);
  yyyy = parseInt(yyyy, 10);
  if (yyyy < 100) yyyy += 2000;
  let hh = 0, mi = 0, ss = 0;
  if (timePart) {
    const t = timePart.split(":");
    hh = parseInt(t[0], 10) || 0;
    mi = parseInt(t[1], 10) || 0;
    ss = parseInt(t[2], 10) || 0;
  }
  const d = new Date(yyyy, mm - 1, dd, hh, mi, ss);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short, friendly date label for chart axes & headings, e.g. "7 Jun 25". */
function fmtDate(d) {
  if (!d) return "?";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

/** Format a number with thousands separators. */
function fmtNum(n) {
  return Math.round(n).toLocaleString("en-GB");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// =============================================================================
// Fetch
// =============================================================================

function buildUrl() {
  const range = encodeURIComponent(CONFIG.RANGE);
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${range}?key=${CONFIG.API_KEY}&majorDimension=ROWS`;
}

async function fetchRows() {
  if (CONFIG.API_KEY === "PASTE_YOUR_API_KEY_HERE" || !CONFIG.API_KEY) {
    throw new Error("No API key set — edit config.js and paste your Google Sheets API key.");
  }
  const res = await fetch(buildUrl(), { cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    throw new Error(`Sheets API ${res.status}${detail ? ": " + detail : ""}`);
  }
  const data = await res.json();
  return Array.isArray(data.values) ? data.values : [];
}

// =============================================================================
// Parse + compute
// =============================================================================

/**
 * Turn the raw value rows into a structured model with all computed stats.
 * `rows` includes the header row at index 0.
 */
function buildModel(rows) {
  // Drop the header row; ignore fully-empty rows.
  const dataRows = rows.slice(1).filter((r) => r && r.length && String(r[COL.PLAYER] ?? "").trim() !== "");

  const records = dataRows.map((r, i) => {
    const ts = parseUKDate(r[COL.TIMESTAMP]);
    const date = parseUKDate(r[COL.DATE]);
    return {
      idx: i,
      ts,
      tsMs: ts ? ts.getTime() : 0,
      rawDate: String(r[COL.DATE] ?? "").trim(),
      date,
      year: date ? date.getFullYear() : null,
      hand: String(r[COL.HAND] ?? "").trim(),
      player: normPlayer(r[COL.PLAYER]),
      hcp: num(r[COL.HCP]),
      wonAuction: /^y/i.test(String(r[COL.WON_AUCTION] ?? "").trim()),
      declarer: normPlayer(r[COL.DECLARER]),
      declarerRaw: String(r[COL.DECLARER] ?? "").trim(),
      level: num(r[COL.CONTRACT_LEVEL]),
      suit: String(r[COL.SUIT] ?? "").trim(),
      tricksMade: num(r[COL.TRICKS_MADE]),
      doubled: String(r[COL.DOUBLED] ?? "").trim(),
      score: num(r[COL.SCORE]),
    };
  });

  // ---- Per-player totals ----
  const grand = {}, y2026 = {}, hcpTotal = {};
  PLAYERS.forEach((p) => { grand[p] = 0; y2026[p] = 0; hcpTotal[p] = 0; });

  records.forEach((rec) => {
    if (!(rec.player in grand)) return; // skip "Unknown" from leaderboard maths
    grand[rec.player] += rec.score;
    hcpTotal[rec.player] += rec.hcp;
    if (rec.year === 2026) y2026[rec.player] += rec.score;
  });

  const efficiency = {};
  PLAYERS.forEach((p) => {
    efficiency[p] = hcpTotal[p] > 0 ? Math.round(grand[p] / hcpTotal[p]) : 0;
  });

  // ---- Sessions: group by Date value, ordered ascending by real date ----
  const sessionMap = new Map(); // key = rawDate string -> { date, label, perPlayer{} }
  records.forEach((rec) => {
    const key = rec.rawDate || "(no date)";
    if (!sessionMap.has(key)) {
      const per = {}; PLAYERS.forEach((p) => (per[p] = 0));
      sessionMap.set(key, { key, date: rec.date, label: fmtDate(rec.date), perPlayer: per, year: rec.year });
    }
    const s = sessionMap.get(key);
    if (rec.player in s.perPlayer) s.perPlayer[rec.player] += rec.score;
  });

  const sessions = [...sessionMap.values()].sort((a, b) => {
    const at = a.date ? a.date.getTime() : 0;
    const bt = b.date ? b.date.getTime() : 0;
    return at - bt;
  });

  // ---- Cumulative series (all-time + 2026) ----
  function cumulative(sessionList) {
    const running = {}; PLAYERS.forEach((p) => (running[p] = 0));
    const labels = [];
    const series = {}; PLAYERS.forEach((p) => (series[p] = []));
    sessionList.forEach((s) => {
      labels.push(s.label);
      PLAYERS.forEach((p) => {
        running[p] += s.perPlayer[p];
        series[p].push(running[p]);
      });
    });
    return { labels, series };
  }
  const allTime = cumulative(sessions);
  const sessions2026 = sessions.filter((s) => s.year === 2026);
  const race2026 = cumulative(sessions2026);

  // ---- Latest hand (newest timestamp) ----
  let latestRec = null;
  records.forEach((rec) => {
    if (!latestRec || rec.tsMs > latestRec.tsMs) latestRec = rec;
  });

  // All rows belonging to the latest hand = same rawDate + same hand number.
  let latestHand = null;
  if (latestRec) {
    const handRows = records.filter(
      (r) => r.rawDate === latestRec.rawDate && r.hand === latestRec.hand
    );
    latestHand = summariseHand(handRows, latestRec);
  }

  // The latest *session* is the date of the newest-timestamp row.
  const latestSessionKey = latestRec ? (latestRec.rawDate || "(no date)") : null;
  const latestSession = sessionMap.get(latestSessionKey) || null;

  // Hand-by-hand breakdown for the latest session: group that session's rows by
  // hand number, summarise each, and order by hand number (then timestamp).
  let latestSessionHands = [];
  if (latestRec) {
    const sessRows = records.filter((r) => (r.rawDate || "(no date)") === latestSessionKey);
    const byHand = new Map();
    sessRows.forEach((r) => {
      if (!byHand.has(r.hand)) byHand.set(r.hand, []);
      byHand.get(r.hand).push(r);
    });
    latestSessionHands = [...byHand.values()]
      .map((rows) => {
        const s = summariseHand(rows, rows[0]);
        s.firstTsMs = Math.min(...rows.map((x) => x.tsMs || Infinity));
        return s;
      })
      .sort((a, b) => {
        const an = parseInt(a.handNo, 10), bn = parseInt(b.handNo, 10);
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
        return a.firstTsMs - b.firstTsMs;
      });
  }

  return {
    records, grand, y2026, hcpTotal, efficiency,
    sessions, allTime, race2026,
    latestHand, latestSession, latestSessionHands,
    rowCount: records.length,
    newestTsMs: latestRec ? latestRec.tsMs : 0,
    fetchedAt: new Date(),
  };
}

/** Build the "latest hand" summary from the rows of a single hand. */
function summariseHand(handRows, fallbackRec) {
  // Declaring side = players who said they won the auction (F = Yes).
  const declaringRows = handRows.filter((r) => r.wonAuction);
  const defendingRows = handRows.filter((r) => !r.wonAuction);

  // The declarer's own row carries the contract details (G names a player).
  const declarerRow =
    handRows.find((r) => r.declarerRaw && r.declarer !== "Unknown" && r.player === r.declarer) ||
    handRows.find((r) => r.declarerRaw) ||
    declaringRows[0] || fallbackRec;

  const declarerName = (declarerRow && declarerRow.declarer !== "Unknown")
    ? declarerRow.declarer
    : (declarerRow ? declarerRow.player : "?");

  // Partner = the other player on the declaring side who isn't the declarer.
  let partner = null;
  const declSidePlayers = [...new Set(declaringRows.map((r) => r.player))];
  const partners = declSidePlayers.filter((p) => p !== declarerName && p !== "Unknown");
  if (partners.length === 1) partner = partners[0];
  // If ambiguous (0 or >1 candidates) we leave partner null and show declarer only.

  // Every player on a side logs the SAME per-player score, so show a single
  // representative value (not the sum of both partners). Prefer the declarer's
  // own row for the declaring side; fall back to any side member.
  const declScore = (declarerRow && declarerRow.wonAuction)
    ? declarerRow.score
    : (declaringRows[0] ? declaringRows[0].score : 0);
  const defScore = defendingRows[0] ? defendingRows[0].score : 0;

  const level = declarerRow ? declarerRow.level : 0;
  const suit = declarerRow ? declarerRow.suit : "";
  const doubled = declarerRow ? declarerRow.doubled : "";
  const tricksMade = declarerRow ? declarerRow.tricksMade : 0;
  const tricksNeeded = level > 0 ? level + 6 : 0;
  const resultDiff = tricksNeeded > 0 ? tricksMade - tricksNeeded : null;

  return {
    handNo: (declarerRow && declarerRow.hand) || (fallbackRec && fallbackRec.hand) || "?",
    dateLabel: fmtDate(declarerRow ? declarerRow.date : (fallbackRec && fallbackRec.date)),
    declarer: declarerName,
    partner,
    level, suit, doubled,
    tricksNeeded, tricksMade, resultDiff,
    declScore, defScore,
    hasContract: level > 0,
  };
}

// =============================================================================
// Rendering
// =============================================================================

const $ = (sel) => document.querySelector(sel);

const SUIT_SYMBOL = {
  clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠",
  "no trumps": "NT", notrumps: "NT", nt: "NT",
};
function suitDisplay(suit) {
  const key = suit.toLowerCase();
  const sym = SUIT_SYMBOL[key] || suit;
  const red = key === "hearts" || key === "diamonds";
  return { sym, red };
}

/** Doubling mark: "*" for Doubled, "**" for Redoubled, "" otherwise. */
function doubleMark(doubled) {
  const d = String(doubled || "").toLowerCase();
  if (d.startsWith("redouble")) return "**";
  if (d.startsWith("double")) return "*";
  return "";
}

/** Full contract as HTML (e.g. 3NT*, 4♥). Returns "—" when there's no contract. */
function contractHtml(h) {
  if (!h.hasContract) return "—";
  const { sym, red } = suitDisplay(h.suit);
  return `${h.level}<span class="${red ? "lh-suit-red" : ""}">${sym}</span>${doubleMark(h.doubled)}`;
}

/** Made/needed result as HTML, or "" when there's no contract. */
function resultHtmlFor(h) {
  if (!h.hasContract || h.resultDiff === null) return "";
  return h.resultDiff >= 0
    ? `<span class="lh-result-made">Made${h.resultDiff > 0 ? " +" + h.resultDiff : ""}</span>`
    : `<span class="lh-result-down">Down ${Math.abs(h.resultDiff)}</span>`;
}

function renderLatestHand(m) {
  const el = $("#latest-hand");
  const h = m.latestHand;
  if (!h) { el.innerHTML = '<p class="muted">No hands recorded yet.</p>'; return; }

  const contract = h.hasContract ? `<span class="lh-contract">${contractHtml(h)}</span>` : "—";
  const resultHtml = resultHtmlFor(h);

  const declColor = COLORS[h.declarer] || COLORS.Unknown;
  const sideLabel = h.partner
    ? `<span style="color:${declColor};font-weight:700">${escapeHtml(h.declarer)}</span> &amp; ${escapeHtml(h.partner)}`
    : `<span style="color:${declColor};font-weight:700">${escapeHtml(h.declarer)}</span> <span class="muted small">(partner unknown)</span>`;

  el.innerHTML = `
    <div class="lh-top">
      <span class="lh-hand-no">Hand #${escapeHtml(h.handNo)}</span>
      ${contract}
      ${resultHtml}
      <span class="muted">${escapeHtml(h.dateLabel)}</span>
    </div>
    <div class="lh-grid">
      <div class="lh-cell"><div class="k">Declaring side</div><div class="v">${sideLabel}</div></div>
      <div class="lh-cell"><div class="k">Tricks</div><div class="v">${h.hasContract ? `made ${h.tricksMade} / needed ${h.tricksNeeded}` : "—"}</div></div>
      <div class="lh-cell"><div class="k">Declaring side points</div><div class="v">${fmtNum(h.declScore)}</div></div>
      <div class="lh-cell"><div class="k">Defending side points</div><div class="v">${fmtNum(h.defScore)}</div></div>
    </div>`;
}

function renderThisSession(m) {
  const meta = $("#this-session-meta");
  const totalsEl = $("#session-totals");
  const body = $("#session-hands-body");
  if (!m.latestSession) {
    meta.textContent = "";
    totalsEl.innerHTML = "";
    body.innerHTML = `<tr><td colspan="5" class="muted">No session data yet.</td></tr>`;
    return;
  }

  const hands = m.latestSessionHands || [];
  meta.textContent = `${m.latestSession.label} · ${hands.length} hand${hands.length === 1 ? "" : "s"} played`;

  // Per-player session totals as colour pills.
  totalsEl.innerHTML = PLAYERS.map((p) => `
    <span class="mini-pill">
      <span class="swatch" style="background:${COLORS[p]}"></span>
      ${escapeHtml(p)} <b>${fmtNum(m.latestSession.perPlayer[p])}</b>
    </span>`).join("");

  // Hand-by-hand rows (newest hand first).
  body.innerHTML = [...hands].reverse().map((h) => {
    const declColor = COLORS[h.declarer] || COLORS.Unknown;
    const side = h.partner
      ? `<span style="color:${declColor};font-weight:600">${escapeHtml(h.declarer)}</span> &amp; ${escapeHtml(h.partner)}`
      : `<span style="color:${declColor};font-weight:600">${escapeHtml(h.declarer)}</span>`;
    const tricks = h.hasContract ? `<span class="muted small">(${h.tricksMade}/${h.tricksNeeded})</span>` : "";
    const result = resultHtmlFor(h) || "—";
    return `
      <tr>
        <td class="num">${escapeHtml(h.handNo)}</td>
        <td>${side}</td>
        <td>${contractHtml(h)}</td>
        <td>${result} ${tricks}</td>
        <td class="num">${fmtNum(h.declScore)}</td>
      </tr>`;
  }).join("");
}

function renderPlayerCards(m) {
  const el = $("#player-cards");
  const leader = [...PLAYERS].sort((a, b) => m.grand[b] - m.grand[a])[0];
  const sessTotals = m.latestSession ? m.latestSession.perPlayer : null;

  el.innerHTML = PLAYERS.map((p) => {
    const isLeader = p === leader && m.grand[p] > 0;
    const sess = sessTotals ? sessTotals[p] : 0;
    return `
      <div class="pcard ${isLeader ? "leader" : ""}" style="--pc:${COLORS[p]}">
        ${isLeader ? '<span class="medal" title="Leader">🏆</span>' : ""}
        <div class="name"><span class="swatch"></span>${escapeHtml(p)}</div>
        <div class="big">${fmtNum(m.grand[p])}</div>
        <div class="sub"><span>This session: <b>${fmtNum(sess)}</b></span><span>Eff: <b>${m.efficiency[p]}</b></span></div>
      </div>`;
  }).join("");

  $("#session-label").textContent = m.latestSession
    ? `Latest session: ${m.latestSession.label}`
    : "";
}

function renderTable(m) {
  const body = $("#standings-body");
  const sessTotals = m.latestSession ? m.latestSession.perPlayer : null;

  let rows = PLAYERS.map((p) => ({
    player: p,
    grand: m.grand[p],
    y2026: m.y2026[p],
    session: sessTotals ? sessTotals[p] : 0,
    efficiency: m.efficiency[p],
  }));

  // Rank is always by grand total (independent of current sort).
  const byGrand = [...rows].sort((a, b) => b.grand - a.grand);
  const rankOf = new Map(byGrand.map((r, i) => [r.player, i + 1]));

  const dir = sortState.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (sortState.key === "player") return a.player.localeCompare(b.player) * dir;
    if (sortState.key === "rank") return (rankOf.get(a.player) - rankOf.get(b.player)) * dir;
    return (a[sortState.key] - b[sortState.key]) * dir;
  });

  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="num">${rankOf.get(r.player)}</td>
      <td class="player-cell"><span class="swatch" style="background:${COLORS[r.player]}"></span>${escapeHtml(r.player)}</td>
      <td class="num">${fmtNum(r.grand)}</td>
      <td class="num">${fmtNum(r.y2026)}</td>
      <td class="num">${fmtNum(r.session)}</td>
      <td class="num">${r.efficiency}</td>
    </tr>`).join("");

  // Update header sort indicators.
  document.querySelectorAll("#standings-table th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    if (key === sortState.key) {
      th.classList.add("active");
      th.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
    } else {
      th.classList.remove("active");
      th.removeAttribute("aria-sort");
    }
  });
}

function renderMini2026(m) {
  const el = $("#mini-2026");
  const ranked = [...PLAYERS].sort((a, b) => m.y2026[b] - m.y2026[a]);
  el.innerHTML = ranked.map((p, i) => `
    <span class="mini-pill">
      <span class="swatch" style="background:${COLORS[p]}"></span>
      ${i === 0 && m.y2026[p] > 0 ? "🏆 " : ""}${escapeHtml(p)} <b>${fmtNum(m.y2026[p])}</b>
    </span>`).join("");
}

// ---- Charts ----
function lineDatasets(series) {
  return PLAYERS.map((p) => ({
    label: p,
    data: series[p],
    borderColor: COLORS[p],
    backgroundColor: COLORS[p],
    borderWidth: 2.5,
    pointRadius: 2,
    pointHoverRadius: 5,
    tension: 0.2,
    fill: false,
  }));
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtNum(c.parsed.y)}` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } },
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    },
  };
}

function renderCharts(m) {
  if (typeof window.Chart === "undefined") return; // CDN not ready yet
  // All-time
  if (!chartAllTime) {
    chartAllTime = new Chart($("#chart-alltime"), {
      type: "line",
      data: { labels: m.allTime.labels, datasets: lineDatasets(m.allTime.series) },
      options: chartOptions(),
    });
  } else {
    chartAllTime.data.labels = m.allTime.labels;
    chartAllTime.data.datasets.forEach((ds) => (ds.data = m.allTime.series[ds.label]));
    chartAllTime.update();
  }
  // 2026
  if (!chart2026) {
    chart2026 = new Chart($("#chart-2026"), {
      type: "line",
      data: { labels: m.race2026.labels, datasets: lineDatasets(m.race2026.series) },
      options: chartOptions(),
    });
  } else {
    chart2026.data.labels = m.race2026.labels;
    chart2026.data.datasets.forEach((ds) => (ds.data = m.race2026.series[ds.label]));
    chart2026.update();
  }
}

function renderAll(m) {
  renderLatestHand(m);
  renderThisSession(m);
  renderPlayerCards(m);
  renderTable(m);
  renderMini2026(m);
  renderCharts(m);
  $("#last-updated").textContent = "Updated " + m.fetchedAt.toLocaleTimeString("en-GB");
}

// =============================================================================
// Verification: print a one-off sanity report to the console.
// =============================================================================
function logVerification(m) {
  /* eslint-disable no-console */
  console.groupCollapsed("%cBridge Friends — data verification", "font-weight:bold");
  console.log("Total data rows:", m.rowCount);
  console.log("Distinct sessions:", m.sessions.length);
  console.table(PLAYERS.map((p) => ({
    player: p,
    grandTotal: m.grand[p],
    total2026: m.y2026[p],
    totalHCP: m.hcpTotal[p],
    efficiency: m.efficiency[p],
  })));
  if (m.sessions.length) {
    console.log("Earliest session:", m.sessions[0].label, "(expect ~June 2025)");
    console.log("Latest session:", m.sessions[m.sessions.length - 1].label);
  }
  console.log("Latest hand:", m.latestHand);
  const totals = PLAYERS.map((p) => m.grand[p]);
  const max = Math.max(...totals), min = Math.min(...totals.filter((t) => t > 0), 0);
  if (max > 0 && min > 0 && max / min > 5) {
    console.warn("⚠ Grand totals look lopsided (max/min > 5×). Double-check column parsing (Score = column L).");
  } else {
    console.log("✓ Grand totals look like four numbers in the same ballpark.");
  }
  console.groupEnd();
  /* eslint-enable no-console */
}
let verificationLogged = false;

// =============================================================================
// Refresh / polling loop
// =============================================================================

function setSpinner(on) { $("#spinner").hidden = !on; }
function setError(msg) {
  const el = $("#error-banner");
  if (msg) { el.hidden = false; el.textContent = msg; }
  else { el.hidden = true; el.textContent = ""; }
}

async function refresh({ manual = false } = {}) {
  if (!manual && Date.now() < backoffUntil) return; // politely backing off
  setSpinner(true);
  try {
    const rows = await fetchRows();
    const newestTs = rows.length > 1
      ? Math.max(...rows.slice(1).map((r) => {
          const d = parseUKDate(r[COL.TIMESTAMP]); return d ? d.getTime() : 0;
        }))
      : 0;
    const signature = `${rows.length}|${newestTs}`;

    consecutiveErrors = 0;
    backoffUntil = 0;
    setError(null);

    if (signature !== lastSignature || manual) {
      const model = buildModel(rows);
      lastSignature = signature;
      lastGoodModel = model;
      renderAll(model);
      if (!verificationLogged) { logVerification(model); verificationLogged = true; }
    } else {
      // Data unchanged — just refresh the "updated" stamp.
      $("#last-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB");
    }
  } catch (err) {
    consecutiveErrors += 1;
    // Polite exponential backoff, capped at ~10 minutes.
    const backoffMs = Math.min(CONFIG.REFRESH_MS * Math.pow(2, consecutiveErrors), 10 * 60 * 1000);
    backoffUntil = Date.now() + backoffMs;
    const note = lastGoodModel
      ? "Couldn't reach the sheet, retrying… (showing last good data)"
      : `Couldn't load the sheet: ${err.message}`;
    setError(note);
    // eslint-disable-next-line no-console
    console.warn("[refresh]", err.message, "— next try in", Math.round(backoffMs / 1000), "s");
  } finally {
    setSpinner(false);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(), CONFIG.REFRESH_MS);
}

// =============================================================================
// Wire up the page
// =============================================================================
function init() {
  $("#add-hand-link").href = CONFIG.FORM_URL;

  // Sortable table headers.
  document.querySelectorAll("#standings-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        // Default to descending for numeric columns, ascending for names/rank.
        sortState.dir = (key === "player" || key === "rank") ? "asc" : "desc";
      }
      if (lastGoodModel) renderTable(lastGoodModel);
    });
  });

  // Manual refresh button.
  $("#refresh-now").addEventListener("click", () => refresh({ manual: true }));

  // First load + start polling.
  refresh({ manual: true }).then(startPolling);
}

// Only boot the UI in a browser. (In Node — e.g. tests — `document` is absent,
// so we skip init and just expose the pure functions below.)
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

// Exported for unit testing (no effect in the browser).
export { buildModel, parseUKDate, num, normPlayer, summariseHand };
