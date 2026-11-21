// =============================================================================
// race.js — "Race to 50,000" live page. Reuses the same Google Sheet fetch and
// parsing/compute logic as the main dashboard (data.js) so the totals here
// always match the main dashboard's round-total column exactly.
// =============================================================================

import { CONFIG } from "./config.js?v=20261121c";
import {
  PLAYERS, COLORS, fmtNum, fmtDate, fmtClock, escapeHtml, fetchRows, buildModel, parseUKDate,
  ROUND, ROUND_START, verifyRound,
} from "./data.js?v=20261121c";

// Both the target and the round's name come from CONFIG.ROUND — see config.js.
const TARGET = CONFIG.ROUND.TARGET;

// ---- Polling / backoff state (same shape as app.js) ----
let pollTimer = null;
let lastSignature = null;
let lastGoodModel = null;
let consecutiveErrors = 0;
let backoffUntil = 0;

const $ = (sel) => document.querySelector(sel);

// =============================================================================
// Race-specific computation (built on top of the shared model)
// =============================================================================

function buildRace(m) {
  // House rules: first to reach the target wins (worked out once in data.js),
  // and the round runs to the end of that night, so totals keep moving until
  // the next night opens the next round. Winners are listed first; everyone
  // else by total.
  const f = m.finish;
  const totals = {};
  PLAYERS.forEach((p) => { totals[p] = m.roundTotal[p]; });

  const winners = f ? f.winners : [];
  const ranked = [...PLAYERS].sort((a, b) =>
    (winners.includes(b) - winners.includes(a)) || totals[b] - totals[a]);
  const raceOver = !!f;
  const winner = raceOver ? winners[0] : null;
  const leader = ranked[0];
  const leaderTotal = totals[leader];

  return { totals, ranked, raceOver, winner, winners, leader, leaderTotal, pace: m.pace, finish: f };
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
    if (race.winners.includes(player)) {
      return race.winners.length > 1
        ? `🏁 Joint champion! ${fmtNum(total)} points.`
        : `🏁 Champion! ${fmtNum(total)} points.`;
    }
    if (place === race.winners.length + 1) {
      return toGo > 0
        ? `🥈 2nd place — ${fmtNum(toGo)} short.`
        : `🥈 2nd place — past ${fmtNum(TARGET)} too, but not first.`;
    }
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

  const f = race.finish;
  const color = COLORS[race.winner];
  const names = race.winners.map((w) => escapeHtml(w)).join(" and ");
  const shared = race.winners.length > 1;

  el.hidden = false;
  el.style.setProperty("--pf-color", color);
  el.innerHTML = `
    <div class="pf-main">🏁 ${names} ${shared ? "share the win" : "is home"}! ${escapeHtml(ROUND.LABEL)} is won.</div>
    <div class="pf-sub">First to ${fmtNum(TARGET)}: hand ${escapeHtml(f.handNo)}, ${escapeHtml(f.sessionLabel)}, on <b>${fmtNum(f.totalsAtLine[race.winner])}</b>.</div>
    <div class="pf-extra">The round runs to the end of this session, so the totals below still count tonight's hands. ${escapeHtml(nextLabel())} starts on its own the next time you play.</div>`;
}

/** The label the next round will get ("Round 2" -> "Round 3"). */
function nextLabel() {
  const m = /^(.*?)(\d+)(\D*)$/.exec(ROUND.LABEL);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : "The next round";
}

/** Past rounds this page has seen finish, newest first. */
function renderHonours(m) {
  const panel = $("#honours-panel"), body = $("#honours");
  if (!panel || !body) return;
  const past = m.pastRounds || [];
  panel.hidden = past.length === 0;
  body.innerHTML = [...past].reverse().map((r) => {
    const order = [...PLAYERS].sort((a, b) =>
      (r.winners.includes(b) - r.winners.includes(a)) || r.finalTotals[b] - r.finalTotals[a]);
    return `
      <div class="honour" style="--pc:${COLORS[r.winners[0]]}">
        <div class="honour-head"><b>${escapeHtml(r.label)}</b> · 🏆 ${r.winners.map(escapeHtml).join(" &amp; ")}</div>
        <div class="honour-sub muted">First to ${fmtNum(r.target)} on hand ${escapeHtml(r.handNo)}, ${escapeHtml(r.sessionLabel)} ·
          final: ${order.map((p) => `${escapeHtml(p)} ${fmtNum(r.finalTotals[p])}`).join(", ")}</div>
      </div>`;
  }).join("");
}

/** Faint marks on the track at each 10,000, so progress reads against something. */
function ticksHtml() {
  const out = [];
  for (let v = 10000; v < TARGET; v += 10000) {
    out.push(`<span class="lane-tick" style="left:${(v / TARGET) * 100}%" aria-hidden="true"></span>`);
  }
  return out.join("");
}

function paceHtml(player, race) {
  const pace = race.pace && race.pace[player];
  if (race.raceOver || !pace) return "";
  const when = pace.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  return ` <span class="lane-pace">At this pace: home around <b>${escapeHtml(when)}</b>, ` +
    `${pace.sessionsLeft} session${pace.sessionsLeft === 1 ? "" : "s"} to go.</span>`;
}

function renderMilestones(m) {
  const head = $("#milestones-head"), body = $("#milestones-body");
  if (!head || !body) return;
  head.innerHTML = `<tr><th class="num">Mark</th>${PLAYERS.map((p) =>
    `<th class="num"><span class="swatch" style="background:${COLORS[p]}"></span>${escapeHtml(p)}</th>`).join("")}</tr>`;
  body.innerHTML = m.milestones.map((ms) => {
    const cells = PLAYERS.map((p) => {
      const hit = ms.per[p];
      if (!hit) {
        const pace = m.pace && m.pace[p];
        // Only the final mark gets a projection; the others are just "not yet".
        return `<td class="num muted">${ms.value === TARGET && pace ? "~" + escapeHtml(fmtDate(pace.date)) : "—"}</td>`;
      }
      return `<td class="num">${ms.first === p ? '<span class="ms-gold">🥇 </span>' : ""}${escapeHtml(hit.label)}</td>`;
    }).join("");
    return `<tr><td class="num"><b>${fmtNum(ms.value)}</b></td>${cells}</tr>`;
  }).join("");
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
          ${ticksHtml()}
          <div class="finish-line"></div>
          <div class="lane-bar" style="width:${pct}%"></div>
          <div class="lane-runner" style="left:${pct}%">🏃</div>
        </div>
        <div class="lane-status">${statusLine(p, race)}${paceHtml(p, race)}</div>
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
  if (m.latestRoundSession) {
    const hands = m.latestSession && m.latestSession.key === m.latestRoundSession.key
      ? m.latestSessionHands.length
      : null;
    // A session that ran past midnight is shown under the evening it started,
    // so say when it finished rather than leaving the next date unaccounted for.
    const lateFinish = m.latestRoundSession.ranPastMidnight
      ? ` · ran to ${fmtClock(m.latestRoundSession.lastTsMs)} the next morning`
      : "";
    meta.textContent = hands !== null
      ? `Latest session: ${m.latestRoundSession.label} · ${hands} hand${hands === 1 ? "" : "s"} played${lateFinish}`
      : `Latest ${ROUND.LABEL} session: ${m.latestRoundSession.label}${lateFinish}`;
  } else {
    meta.textContent = `No ${ROUND.LABEL} sessions yet`;
  }
}

/** Footer note: named round + the configured target, never a hard-coded year. */
function renderFooterNote() {
  const el = $("#race-footer-note");
  if (!el) return;
  el.textContent =
    `${ROUND.LABEL} only (from ${fmtDate(ROUND_START)}) · target ${fmtNum(TARGET)} · ` +
    "reads live from the same Google Sheet as the main dashboard";
}

function renderAll(m) {
  const race = buildRace(m);
  renderHeader(m);
  renderFooterNote(); // the round can move on between refreshes
  renderBanner(race);
  renderTrack(race);
  renderStrip(race);
  renderMilestones(m);
  renderHonours(m);
  return race;
}

// =============================================================================
// Verification (shared with the main dashboard — see verifyRound in data.js).
// =============================================================================
function logVerification(m, race) {
  /* eslint-disable no-console */
  verifyRound(m);
  console.log("Leader:", race.leader, fmtNum(race.leaderTotal), `· target ${fmtNum(TARGET)}`);
  if (race.raceOver) console.log("Winner:", race.winners.join(" & "), "· hand", race.finish.handNo, race.finish.sessionLabel);
  (m.pastRounds || []).forEach((r) => console.log(`${r.label}: won by ${r.winners.join(" & ")} (hand ${r.handNo}, ${r.sessionLabel}); final`, r.finalTotals));
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
  renderFooterNote();
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
