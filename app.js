// =============================================================================
// app.js — render and poll the Bridge Friends sheet for the main dashboard.
// Vanilla JS module. Chart.js is loaded globally from the CDN (window.Chart).
// You normally never need to edit this file — settings live in config.js.
// Fetch/parse/compute logic lives in data.js (shared with race.js).
// =============================================================================

import { CONFIG } from "./config.js?v=20260808f";
import {
  PLAYERS, COLORS, COL, fmtNum, fmtDate, escapeHtml,
  fetchRows, buildModel, parseUKDate,
  ROUND, ROUND_START, verifyRound,
} from "./data.js?v=20260808f";

// ---- Polling / backoff state ----
let pollTimer = null;
let lastSignature = null;       // change-detection: rowCount + newest timestamp
let lastGoodModel = null;       // last successfully parsed model (kept on error)
let consecutiveErrors = 0;
let backoffUntil = 0;           // epoch ms; don't fetch before this on errors

// ---- Chart instances (created lazily) ----
let chartAllTime = null;
let chartRound = null;

// ---- Sort state for the standings tables ----
let sortState = { key: "grand", dir: "desc" };
let sortRoundState = { key: "roundTotal", dir: "desc" };

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
    roundTotal: m.roundTotal[p],
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
      <td class="num">${fmtNum(r.roundTotal)}</td>
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

function renderRoundCards(m) {
  const el = $("#player-cards-2026");
  const leader = [...PLAYERS].sort((a, b) => m.roundTotal[b] - m.roundTotal[a])[0];
  const sessTotals = m.latestRoundSession ? m.latestRoundSession.perPlayer : null;

  el.innerHTML = PLAYERS.map((p) => {
    const isLeader = p === leader && m.roundTotal[p] > 0;
    const sess = sessTotals ? sessTotals[p] : 0;
    return `
      <div class="pcard ${isLeader ? "leader" : ""}" style="--pc:${COLORS[p]}">
        ${isLeader ? `<span class="medal" title="${escapeHtml(ROUND.LABEL)} leader">🏆</span>` : ""}
        <div class="name"><span class="swatch"></span>${escapeHtml(p)}</div>
        <div class="big">${fmtNum(m.roundTotal[p])}</div>
        <div class="sub"><span>This session: <b>${fmtNum(sess)}</b></span><span>Eff: <b>${m.efficiencyRound[p]}</b></span></div>
      </div>`;
  }).join("");

  $("#session-2026-label").textContent = m.latestRoundSession
    ? `Latest ${ROUND.LABEL} session: ${m.latestRoundSession.label}`
    : `No ${ROUND.LABEL} sessions yet`;
}

function renderRoundTable(m) {
  const body = $("#standings-2026-body");
  const sessTotals = m.latestRoundSession ? m.latestRoundSession.perPlayer : null;

  let rows = PLAYERS.map((p) => ({
    player: p,
    roundTotal: m.roundTotal[p],
    session: sessTotals ? sessTotals[p] : 0,
    efficiency: m.efficiencyRound[p],
  }));

  // Rank is always by round total (independent of current sort).
  const byRound = [...rows].sort((a, b) => b.roundTotal - a.roundTotal);
  const rankOf = new Map(byRound.map((r, i) => [r.player, i + 1]));

  const dir = sortRoundState.dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (sortRoundState.key === "player") return a.player.localeCompare(b.player) * dir;
    if (sortRoundState.key === "rank") return (rankOf.get(a.player) - rankOf.get(b.player)) * dir;
    return (a[sortRoundState.key] - b[sortRoundState.key]) * dir;
  });

  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="num">${rankOf.get(r.player)}</td>
      <td class="player-cell"><span class="swatch" style="background:${COLORS[r.player]}"></span>${escapeHtml(r.player)}</td>
      <td class="num">${fmtNum(r.roundTotal)}</td>
      <td class="num">${fmtNum(r.session)}</td>
      <td class="num">${r.efficiency}</td>
    </tr>`).join("");

  // Update header sort indicators.
  document.querySelectorAll("#standings-2026-table th.sortable").forEach((th) => {
    const key = th.dataset.sort;
    if (key === sortRoundState.key) {
      th.classList.add("active");
      th.setAttribute("aria-sort", sortRoundState.dir === "asc" ? "ascending" : "descending");
    } else {
      th.classList.remove("active");
      th.removeAttribute("aria-sort");
    }
  });
}

/**
 * All-time efficiency: how many points each player won per high-card point they
 * were dealt, alongside the raw HCP those points came from. Ranked by
 * efficiency — the whole point of the panel — so it is not sortable.
 */
function renderEfficiencyTable(m) {
  const body = $("#efficiency-body");
  if (!body) return;

  const rows = PLAYERS
    .map((p) => ({
      player: p,
      hcp: m.hcpTotal[p],
      perHand: m.hcpPerHand[p],
      efficiency: m.efficiency[p],
    }))
    .sort((a, b) => b.efficiency - a.efficiency);

  body.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="player-cell"><span class="swatch" style="background:${COLORS[r.player]}"></span>${escapeHtml(r.player)}</td>
      <td class="num">${fmtNum(r.hcp)}</td>
      <td class="num">${r.perHand.toFixed(1)}</td>
      <td class="num">${r.efficiency}</td>
    </tr>`).join("");
}

function renderMiniRound(m) {
  const el = $("#mini-2026");
  const ranked = [...PLAYERS].sort((a, b) => m.roundTotal[b] - m.roundTotal[a]);
  el.innerHTML = ranked.map((p, i) => `
    <span class="mini-pill">
      <span class="swatch" style="background:${COLORS[p]}"></span>
      ${i === 0 && m.roundTotal[p] > 0 ? "🏆 " : ""}${escapeHtml(p)} <b>${fmtNum(m.roundTotal[p])}</b>
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

/**
 * Read a design token off :root. Chart.js draws to canvas and cannot resolve a
 * CSS custom property itself, so anything it paints has to be handed a resolved
 * value. Reading them here rather than hardcoding keeps tokens.css the single
 * source of truth — restyle there and the charts follow.
 */
function token(name, fallback) {
  if (typeof getComputedStyle === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartOptions() {
  // On the navy ground Chart.js's default grey axes and grid are all but
  // invisible, so tick, grid and legend colours are set explicitly.
  const inkSoft = token("--ink-soft", "#C3CCD8");
  const ink = token("--ink", "#F2EFE9");
  const line = token("--line", "#24405C");
  const mono = token("--font-mono", "ui-monospace, Menlo, monospace");
  const body = token("--font-body", "Georgia, serif");
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        labels: {
          usePointStyle: true, boxWidth: 8, padding: 16,
          color: ink,
          font: { family: body, size: 13 },
        },
      },
      tooltip: {
        callbacks: { label: (c) => `${c.dataset.label}: ${fmtNum(c.parsed.y)}` },
        titleFont: { family: body },
        bodyFont: { family: mono },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => fmtNum(v), color: inkSoft, font: { family: mono, size: 11 } },
        grid: { color: line },
        border: { color: line },
      },
      x: {
        ticks: {
          maxRotation: 0, autoSkip: true, maxTicksLimit: 10,
          color: inkSoft, font: { family: mono, size: 11 },
        },
        grid: { color: line },
        border: { color: line },
      },
    },
  };
}

// The round chart keeps blank slots to the RIGHT of the last session so the
// lines have somewhere to climb into — real points only, never a forecast.
// MIN_SLOTS keeps the axis from being two columns wide early in a round;
// LOOKAHEAD keeps a little room ahead once the round is well under way.
const ROUND_CHART_MIN_SLOTS = 12;
const ROUND_CHART_LOOKAHEAD = 4;

/**
 * The round series padded with empty future slots. Padding is `null`, which
 * Chart.js skips entirely — no point is drawn and (with spanGaps off) no line
 * is extended into the blank space, so nothing here implies a prediction.
 */
function paddedRoundSeries(m) {
  const played = m.raceRound.labels.length;
  const slots = Math.max(ROUND_CHART_MIN_SLOTS, played + ROUND_CHART_LOOKAHEAD);
  const blanks = Math.max(0, slots - played);
  const series = {};
  PLAYERS.forEach((p) => {
    series[p] = (m.raceRound.series[p] || []).concat(new Array(blanks).fill(null));
  });
  return { labels: m.raceRound.labels.concat(new Array(blanks).fill("")), series };
}

/**
 * Top of the round chart's y-axis. Normally the target itself, so the height of
 * every line reads directly as "how far towards 50,000". If someone goes past
 * the target we grow the axis in whole tick steps rather than clip their line.
 */
function roundYMax(m) {
  const target = ROUND.TARGET;
  const step = target / 5;
  const highest = Math.max(0, ...PLAYERS.map((p) => {
    const s = m.raceRound.series[p];
    return s && s.length ? s[s.length - 1] : 0;
  }));
  return highest > target ? Math.ceil(highest / step) * step : target;
}

/**
 * The round chart is a race to a fixed finish, so its y-axis is anchored to
 * CONFIG.ROUND.TARGET instead of auto-scaling to the data. That makes each
 * point readable as progress towards the target, and keeps the shape of the
 * race honest as the round goes on (an auto-scaled axis re-zooms every session
 * and makes a 3,000-point lead look identical to a 30,000-point one).
 */
function roundChartOptions(m) {
  const target = ROUND.TARGET;
  const o = chartOptions();
  o.scales.y.max = roundYMax(m);
  o.scales.y.ticks.stepSize = target / 5;

  // The x-axis is mostly blank padding, and autoSkip spaces ticks evenly across
  // ALL slots — which silently drops real session labels in favour of empty
  // ones. Show every tick while the axis is short (the padding renders as
  // nothing anyway) and only hand back to autoSkip once a round is long enough
  // for the labels to actually crowd.
  const slots = Math.max(ROUND_CHART_MIN_SLOTS, m.raceRound.labels.length + ROUND_CHART_LOOKAHEAD);
  o.scales.x.ticks.autoSkip = slots > 16;
  // The gridline at the target is the finish line — gold and heavier than the
  // recessive grid, matching the dashed gold finish line on the race page, so
  // the top of the chart reads as a goal rather than a bound.
  const grid = token("--line", "#24405C");
  const finish = token("--gold", "#D4A24C");
  o.scales.y.grid = {
    color: (c) => (c.tick && c.tick.value === target ? finish : grid),
    lineWidth: (c) => (c.tick && c.tick.value === target ? 2 : 1),
  };
  o.plugins.tooltip.callbacks.label = (c) =>
    `${c.dataset.label}: ${fmtNum(c.parsed.y)} · ${Math.round((c.parsed.y / target) * 100)}% of ${fmtNum(target)}`;
  return o;
}

function renderCharts(m) {
  if (typeof window.Chart === "undefined") return; // CDN not ready yet
  // All-time — auto-scaled; it has no finish line to aim at.
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
  // Current round — axis pinned to the target, with blank slots ahead.
  const padded = paddedRoundSeries(m);
  if (!chartRound) {
    chartRound = new Chart($("#chart-2026"), {
      type: "line",
      data: { labels: padded.labels, datasets: lineDatasets(padded.series) },
      options: roundChartOptions(m),
    });
  } else {
    chartRound.data.labels = padded.labels;
    chartRound.data.datasets.forEach((ds) => (ds.data = padded.series[ds.label]));
    chartRound.options.scales.y.max = roundYMax(m); // may grow past the target
    chartRound.update();
  }
}

/**
 * Stamp the round's name onto the static markup. Everything that used to read
 * "2026" in a heading, column header, tooltip or footnote is written from
 * CONFIG.ROUND.LABEL here, so a new round needs no HTML edits.
 */
function renderRoundLabels() {
  const L = ROUND.LABEL;
  const set = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  set("#players-2026-title", `${L} Standings`);
  set("#race2026-title", `${L} race — to ${fmtNum(ROUND.TARGET)}`);
  set("#th-round-total", `${L} total`);
  set("#th-round-total-alltime", `${L} total`);
  set("#standings-2026-note",
    `${L} sessions only (from ${fmtDate(ROUND_START)}). Click a column header to sort. ` +
    `Efficiency = ${L} score ÷ ${L} HCP dealt.`);

  const canvas = $("#chart-2026");
  if (canvas) {
    canvas.setAttribute("aria-label",
      `${L} cumulative score line chart, scaled from 0 to the ${fmtNum(ROUND.TARGET)} target`);
  }
}

function renderAll(m) {
  renderLatestHand(m);
  renderThisSession(m);
  renderRoundCards(m);
  renderRoundTable(m);
  renderPlayerCards(m);
  renderTable(m);
  renderEfficiencyTable(m);
  renderMiniRound(m);
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
    roundTotal: m.roundTotal[p],
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
  verifyRound(m);
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
  renderRoundLabels();

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

  // Sortable headers for the round standings table.
  document.querySelectorAll("#standings-2026-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortRoundState.key === key) {
        sortRoundState.dir = sortRoundState.dir === "asc" ? "desc" : "asc";
      } else {
        sortRoundState.key = key;
        sortRoundState.dir = (key === "player" || key === "rank") ? "asc" : "desc";
      }
      if (lastGoodModel) renderRoundTable(lastGoodModel);
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
export { buildModel, parseUKDate } from "./data.js?v=20260808f";
