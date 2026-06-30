// =============================================================================
// race.js — "Race to 50,000" live page. Reuses the same Google Sheet fetch and
// parsing/compute logic as the main dashboard (data.js) so the totals here
// always match the main dashboard's "2026 total" column exactly.
// =============================================================================

import { CONFIG } from "./config.js";
import { PLAYERS, COLORS, fmtNum, escapeHtml, fetchRows, buildModel, parseUKDate } from "./data.js";

const TARGET = 50000;

// ---- Polling / backoff state (same shape as app.js) ----
let pollTimer = null;
let lastSignature = null;
let lastGoodModel = null;
let consecutiveErrors = 0;
let backoffUntil = 0;

// Set this to a player name (e.g. "David") while testing to force their total
// past 50,000 and exercise the photo-finish banner. MUST be null before
// shipping — leaving it set would fake a result on the live page.
const TEST_FORCE_WINNER = null;

const $ = (sel) => document.querySelector(sel);

// =============================================================================
// Race-specific computation (built on top of the shared model)
// =============================================================================

function buildRace(m) {
  const totals = {};
  PLAYERS.forEach((p) => { totals[p] = m.y2026[p]; });

  if (TEST_FORCE_WINNER && PLAYERS.includes(TEST_FORCE_WINNER)) {
    totals[TEST_FORCE_WINNER] = TARGET + 250; // test-only override, see const above
  }

  const ranked = [...PLAYERS].sort((a, b) => totals[b] - totals[a]);
  const winners = ranked.filter((p) => totals[p] >= TARGET);
  const raceOver = winners.length > 0;
  // If more than one crossed in the same refresh, higher total wins.
  winners.sort((a, b) => totals[b] - totals[a]);
  const winner = raceOver ? winners[0] : null;
  const leader = ranked[0];
  const leaderTotal = totals[leader];

  return { totals, ranked, raceOver, winner, winners, leader, leaderTotal };
}

// =============================================================================
// Rendering
// =============================================================================

function statusLine(player, race) {
  const { totals, raceOver, winner, leader, leaderTotal } = race;
  const total = totals[player];
  const toGo = Math.max(0, TARGET - total);

  if (raceOver) {
    const place = race.ranked.indexOf(player) + 1;
    if (player === winner) return `🏁 Champion! ${fmtNum(total)} points.`;
    if (place === 2) return `🥈 2nd place — ${fmtNum(toGo)} short at the line.`;
    if (place === race.ranked.length) return `🥄 Wooden spoon — better luck next round.`;
    return `${ordinal(place)} place — ${fmtNum(total)} points.`;
  }

  if (player === leader) {
    return `Nose in front — ${fmtNum(toGo)} to glory.`;
  }
  const gap = leaderTotal - total;
  if (gap > 15000) {
    return `Playing for pride now — ${fmtNum(toGo)} to go.`;
  }
  return `Still in it — ${fmtNum(toGo)} to go.`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function renderBanner(race) {
  const el = $("#photo-finish");
  if (!race.raceOver) { el.hidden = true; el.innerHTML = ""; return; }

  const second = race.ranked[1];
  const margin = race.totals[race.winner] - race.totals[second];
  const color = COLORS[race.winner];

  const extra = race.winners.length > 1
    ? `<div class="pf-extra">Both ${race.winners.map((w) => escapeHtml(w)).join(" and ")} crossed the line — ${escapeHtml(race.winner)} had the higher total.</div>`
    : "";

  el.hidden = false;
  el.style.setProperty("--pf-color", color);
  el.innerHTML = `
    <div class="pf-main">🏁 ${escapeHtml(race.winner)} is home! Round over.</div>
    <div class="pf-sub">Final: <b>${fmtNum(race.totals[race.winner])}</b> · won by <b>${fmtNum(margin)}</b> over ${escapeHtml(second)}</div>
    ${extra}`;
}

function renderTrack(race) {
  const el = $("#track");
  el.innerHTML = race.ranked.map((p) => {
    const total = race.totals[p];
    const pct = Math.min(100, (total / TARGET) * 100);
    const toGo = Math.max(0, TARGET - total);
    const isLeader = p === race.leader && !race.raceOver;
    const isWinner = race.raceOver && p === race.winner;

    return `
      <div class="lane" style="--pc:${COLORS[p]}">
        <div class="lane-head">
          <span class="lane-name">${(isLeader || isWinner) ? '<span class="trophy">🏆</span>' : ""}${escapeHtml(p)}</span>
          <span class="lane-total">${fmtNum(total)} <span class="lane-togo">${toGo > 0 ? `· ${fmtNum(toGo)} to go` : "· HOME"}</span></span>
        </div>
        <div class="lane-bar-wrap">
          <div class="finish-line"></div>
          <div class="lane-bar" style="width:${pct}%"></div>
          <div class="lane-runner" style="left:${pct}%">🏃</div>
        </div>
        <div class="lane-status">${statusLine(p, race)}</div>
      </div>`;
  }).join("");
}

function renderStrip(race) {
  const el = $("#points-to-glory");
  const sorted = [...PLAYERS].sort(
    (a, b) => Math.max(0, TARGET - race.totals[a]) - Math.max(0, TARGET - race.totals[b])
  );
  el.innerHTML = sorted.map((p) => {
    const toGo = Math.max(0, TARGET - race.totals[p]);
    return `
      <span class="glory-pill" style="--pc:${COLORS[p]}">
        <span class="swatch"></span>${escapeHtml(p)} <b>${toGo > 0 ? fmtNum(toGo) : "HOME"}</b>
      </span>`;
  }).join("");
}

function renderHeader(m) {
  $("#last-updated").textContent = "Updated " + m.fetchedAt.toLocaleTimeString("en-GB");
  const meta = $("#race-meta");
  if (m.latest2026Session) {
    const hands = m.latestSession && m.latestSession.key === m.latest2026Session.key
      ? m.latestSessionHands.length
      : null;
    meta.textContent = hands !== null
      ? `Latest session: ${m.latest2026Session.label} · ${hands} hand${hands === 1 ? "" : "s"} played`
      : `Latest 2026 session: ${m.latest2026Session.label}`;
  } else {
    meta.textContent = "No 2026 sessions yet";
  }
}

function renderAll(m) {
  const race = buildRace(m);
  renderHeader(m);
  renderBanner(race);
  renderTrack(race);
  renderStrip(race);
  return race;
}

// =============================================================================
// Verification: print each player's 2026 total + gap to console.
// =============================================================================
function logVerification(m, race) {
  /* eslint-disable no-console */
  console.groupCollapsed("%cRace to 50,000 — data verification", "font-weight:bold");
  console.table(PLAYERS.map((p) => ({
    player: p,
    total2026: m.y2026[p],
    gapTo50000: Math.max(0, TARGET - m.y2026[p]),
  })));
  console.log("Leader:", race.leader, fmtNum(race.leaderTotal));
  if (race.raceOver) console.log("Winner:", race.winner);
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
  if (!manual && Date.now() < backoffUntil) return;
  setSpinner(true);
  try {
    const rows = await fetchRows();
    const newestTs = rows.length > 1
      ? Math.max(...rows.slice(1).map((r) => {
          const d = parseUKDate(r[0]); return d ? d.getTime() : 0;
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
      const race = renderAll(model);
      if (!verificationLogged) { logVerification(model, race); verificationLogged = true; }
    } else {
      $("#last-updated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB");
    }
  } catch (err) {
    consecutiveErrors += 1;
    const backoffMs = Math.min(CONFIG.REFRESH_MS * Math.pow(2, consecutiveErrors), 10 * 60 * 1000);
    backoffUntil = Date.now() + backoffMs;
    const note = lastGoodModel
      ? "Couldn't reach the sheet, retrying… (showing last good data)"
      : `Couldn't load the sheet: ${err.message}`;
    setError(note);
    // eslint-disable-next-line no-console
    console.warn("[race refresh]", err.message, "— next try in", Math.round(backoffMs / 1000), "s");
  } finally {
    setSpinner(false);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(), CONFIG.REFRESH_MS);
}

function init() {
  $("#refresh-now").addEventListener("click", () => refresh({ manual: true }));
  refresh({ manual: true }).then(startPolling);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
