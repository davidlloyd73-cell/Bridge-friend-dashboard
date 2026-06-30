// =============================================================================
// app.js — render and poll the Bridge Friends sheet for the main dashboard.
// Vanilla JS module. Chart.js is loaded globally from the CDN (window.Chart).
// You normally never need to edit this file — settings live in config.js.
// Fetch/parse/compute logic lives in data.js (shared with race.js).
// =============================================================================

import { CONFIG } from "./config.js";
import {
  PLAYERS, COLORS, COL, fmtNum, escapeHtml,
  fetchRows, buildModel, parseUKDate,
} from "./data.js";

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
let sort2026State = { key: "y2026", dir: "desc" };

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

function render2026Cards(m) {
  const el = $("#player-cards-2026");
  const leader = [...PLAYERS].sort((a, b) => m.y2026[b] - m.y2026[a])[0];
  const sessTotals = m.latest2026Session ? m.latest2026Session.perPlayer : null;

  el.innerHTML = PLAYERS.map((p) => {
    const isLeader = p === leader && m.y2026[p] > 0;
    const sess = sessTotals ? sessTotals[p] : 0;
    return `
      <div class="pcard ${isLeader ? "leader" : ""}" style="--pc:${COLORS[p]}">
        ${isLeader ? '<span class="medal" title="2026 leader">🏆</span>' : ""}
        <div class="name"><span class="swatch"></span>${escapeHtml(p)}</div>
        <div class="big">${fmtNum(m.y2026[p])}</div>
        <div class="sub"><span>This session: <b>${fmtNum(sess)}</b></span><span>Eff: <b>${m.efficiency2026[p]}</b></span></div>
      </div>`;
  }).join("");

  $("#session-2026-label").textContent = m.latest2026Session
    ? `Latest 2026 session: ${m.latest2026Session.label}`
    : "No 2026 sessions yet";
}

function render2026Table(m) {
  const body = $("#standings-2026-body");
  const sessTotals = m.latest2026Session ? m.latest2026Session.perPlayer : null;

  let rows = PLAYERS.map((p) => ({
    player: p,
    y2026: m.y2026[p],
    session: sessTotals ? sessTotals[p] : 0,
    efficiency: m.efficiency2026[p],
  }));

  // Rank is always by 2026 total (independent of current sort).
  const by2026 = [...rows].sort((a, b) => b.y2026 - a.y2026);
  const rankOf = new Map(by2026.map((r, i) => [r.player, i + 1]));

  const dir = sort2026State.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (sort2026State.key === "player") return a.player.localeCompare(b.player) * dir;
    if (sort2026State.key === "rank") return (rankOf.get(a.player) - rankOf.get(b.player)) * dir;
    return (a[sort2026State.key] - b[sort2026State.key]) * dir;
  });

  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="num">${rankOf.get(r.player)}</td>
      <td class="player-cell"><span class="swatch" style="background:${COLORS[r.player]}"></span>${escapeHtml(r.player)}</td>
      <td class="num">${fmtNum(r.y2026)}</td>
      <td class="num">${fmtNum(r.session)}</td>
      <td class="num">${r.efficiency}</td>
    </tr>`).join("");

  // Update header sort indicators.
  document.querySelectorAll("#standings-2026-table th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    if (key === sort2026State.key) {
      th.classList.add("active");
      th.setAttribute("aria-sort", sort2026State.dir === "asc" ? "ascending" : "descending");
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
  render2026Cards(m);
  render2026Table(m);
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

  // Sortable headers for the 2026 standings table.
  document.querySelectorAll("#standings-2026-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sort2026State.key === key) {
        sort2026State.dir = sort2026State.dir === "asc" ? "desc" : "asc";
      } else {
        sort2026State.key = key;
        sort2026State.dir = (key === "player" || key === "rank") ? "asc" : "desc";
      }
      if (lastGoodModel) render2026Table(lastGoodModel);
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

// Exported for unit testing (no effect in the browser). Re-exported from
// data.js, which is now the single source of truth for parsing/computing.
export { buildModel, parseUKDate } from "./data.js";
