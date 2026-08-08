// =============================================================================
// data.js — single source of truth for fetching, parsing, and computing the
// Bridge Friends sheet model. Imported by BOTH app.js (main dashboard) and
// race.js (race-to-50000 page) so the two pages never disagree on totals.
// =============================================================================

import { CONFIG } from "./config.js?v=20260808b";

// ---- Fixed players & their signature colours (hex must match styles.css) ----
export const PLAYERS = CONFIG.PLAYERS; // ["David","Vivienne","Hamish","Caroline"]
export const COLORS = {
  David: "#2563eb",
  Vivienne: "#16a34a",
  Hamish: "#ea580c",
  Caroline: "#9333ea",
  Unknown: "#6b7280",
};

// Column indices for the raw "Form responses 1" tab, range A:L.
export const COL = {
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

// =============================================================================
// Utilities
// =============================================================================

/** Safe number parser: blanks/undefined -> 0, strips commas & spaces. */
export function num(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise a player name to one of the fixed four, else "Unknown". */
export function normPlayer(v) {
  const s = String(v ?? "").trim();
  const hit = PLAYERS.find((p) => p.toLowerCase() === s.toLowerCase());
  return hit || "Unknown";
}

// A Google Sheets date "serial": days since 30 Dec 1899. The Form sometimes
// writes a real date VALUE into column B rather than text, and if that cell's
// number format is plain the Sheets API hands us the bare serial ("46242")
// instead of "08/08/2026". Range guard = 1954-2064, which is comfortably wider
// than any bridge session and still excludes hand numbers, scores and HCP.
const SERIAL_EPOCH = { y: 1899, m: 11, d: 30 };
const SERIAL_MIN = 20000;
const SERIAL_MAX = 60000;

/**
 * Parse a UK date string "dd/mm/yyyy" (optionally with " HH:MM:SS") into a Date.
 * Also accepts a Google Sheets date serial number (see above). Never interprets
 * as US mm/dd. Returns null if unparseable.
 */
export function parseUKDate(v) {
  if (v === null || v === undefined) return null;
  const str = String(v).trim();
  if (str === "") return null;

  // Bare number => Sheets serial. Built with the same local-midnight semantics
  // as the dd/mm/yyyy branch below, so both spellings of one day compare equal.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = parseFloat(str);
    if (!Number.isFinite(n) || n < SERIAL_MIN || n > SERIAL_MAX) return null;
    const days = Math.floor(n);
    const d = new Date(SERIAL_EPOCH.y, SERIAL_EPOCH.m, SERIAL_EPOCH.d + days);
    // Fractional part = time of day.
    const ms = Math.round((n - days) * 24 * 60 * 60 * 1000);
    if (ms) d.setTime(d.getTime() + ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

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

// ---- The current round (see CONFIG.ROUND in config.js) ----------------------
// Parsed once here so the record-level and session-level filters can never
// drift apart. parseUKDate with no time part gives 00:00 local, which is
// exactly the "inclusive from the start of that day" semantics we want.
export const ROUND = CONFIG.ROUND;
export const ROUND_START = parseUKDate(CONFIG.ROUND.START);
// Fail CLOSED if START is unparseable: an empty round is obviously wrong at a
// glance, whereas failing open would sweep every session into the round, push
// all four totals past TARGET and have the race page crown a false champion.
export const ROUND_START_MS = ROUND_START ? ROUND_START.getTime() : Infinity;

/**
 * Is this date inside the current round? Null/unparseable dates are never in
 * the round (the model deliberately tolerates a "(no date)" session).
 */
export function inRound(date) {
  return !!date && date.getTime() >= ROUND_START_MS;
}

/**
 * Stable per-day identity for a Date, e.g. "2026-08-08". Used as the session
 * key so grouping never depends on how the cell happened to be typed.
 */
export function dayKey(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Short, friendly date label for chart axes & headings, e.g. "7 Jun 25". */
export function fmtDate(d) {
  if (!d) return "?";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

/** Format a number with thousands separators. */
export function fmtNum(n) {
  return Math.round(n).toLocaleString("en-GB");
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// =============================================================================
// Fetch
// =============================================================================

export function buildUrl() {
  const range = encodeURIComponent(CONFIG.RANGE);
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${range}?key=${CONFIG.API_KEY}&majorDimension=ROWS`;
}

export async function fetchRows() {
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
export function buildModel(rows) {
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
      inRound: inRound(date),
      // Which session this row belongs to. Derived from the parsed day so it
      // survives column B being written as text on one row and as a Sheets
      // date serial on the next.
      sessionKey: dayKey(date) || String(r[COL.DATE] ?? "").trim() || "(no date)",
    };
  });

  // ---- Per-player totals (all-time + current round) ----
  const grand = {}, roundTotal = {}, hcpTotal = {}, hcpRound = {};
  PLAYERS.forEach((p) => { grand[p] = 0; roundTotal[p] = 0; hcpTotal[p] = 0; hcpRound[p] = 0; });

  records.forEach((rec) => {
    if (!(rec.player in grand)) return; // skip "Unknown" from leaderboard maths
    grand[rec.player] += rec.score;
    hcpTotal[rec.player] += rec.hcp;
    if (rec.inRound) { roundTotal[rec.player] += rec.score; hcpRound[rec.player] += rec.hcp; }
  });

  const efficiency = {}, efficiencyRound = {};
  PLAYERS.forEach((p) => {
    efficiency[p] = hcpTotal[p] > 0 ? Math.round(grand[p] / hcpTotal[p]) : 0;
    efficiencyRound[p] = hcpRound[p] > 0 ? Math.round(roundTotal[p] / hcpRound[p]) : 0;
  });

  // ---- Sessions: group by calendar day, ordered ascending by real date ----
  // Keyed on the PARSED day, not the raw cell text, so one session can't split
  // in two when column B holds the same day spelled differently ("08/08/2026"
  // in some rows, the serial "46242" in others).
  const sessionMap = new Map(); // key = yyyy-mm-dd -> { date, label, perPlayer{} }
  records.forEach((rec) => {
    const key = rec.sessionKey;
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

  // ---- Cumulative series (all-time + current round) ----
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
  const sessionsRound = sessions.filter((s) => inRound(s.date));
  const raceRound = cumulative(sessionsRound);
  const latestRoundSession = sessionsRound.length ? sessionsRound[sessionsRound.length - 1] : null;

  // ---- Latest hand (newest timestamp) ----
  let latestRec = null;
  records.forEach((rec) => {
    if (!latestRec || rec.tsMs > latestRec.tsMs) latestRec = rec;
  });

  // All rows belonging to the latest hand = same session + same hand number.
  let latestHand = null;
  if (latestRec) {
    const handRows = records.filter(
      (r) => r.sessionKey === latestRec.sessionKey && r.hand === latestRec.hand
    );
    latestHand = summariseHand(handRows, latestRec);
  }

  // The latest *session* is the date of the newest-timestamp row.
  const latestSessionKey = latestRec ? latestRec.sessionKey : null;
  const latestSession = sessionMap.get(latestSessionKey) || null;

  // Hand-by-hand breakdown for the latest session: group that session's rows by
  // hand number, summarise each, and order by hand number (then timestamp).
  let latestSessionHands = [];
  if (latestRec) {
    const sessRows = records.filter((r) => r.sessionKey === latestSessionKey);
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
    records, grand, roundTotal, hcpTotal, hcpRound, efficiency, efficiencyRound,
    sessions, allTime, sessionsRound, raceRound, latestRoundSession,
    latestHand, latestSession, latestSessionHands,
    rowCount: records.length,
    newestTsMs: latestRec ? latestRec.tsMs : 0,
    fetchedAt: new Date(),
  };
}

// =============================================================================
// Verification — shared by both pages.
//
// Proves the round scoping is doing what config.js says it should:
//   1) every player's round total == the sum of column L over their rows dated
//      on or after CONFIG.ROUND.START (recomputed from the raw records here,
//      NOT read back from the field we're checking);
//   2) the round's session list starts on CONFIG.ROUND.START and contains
//      nothing dated earlier.
// Both checks read the date from config, never a hard-coded year or day, so
// they keep working unchanged for the next round.
// =============================================================================
export function verifyRound(m) {
  /* eslint-disable no-console */
  console.groupCollapsed(
    `%c${ROUND.LABEL} — round scoping verification (start ${ROUND.START}, target ${fmtNum(ROUND.TARGET)})`,
    "font-weight:bold"
  );

  // ---- 1) Per-player round total vs. raw column-L sum ----
  let allMatch = true;
  console.table(PLAYERS.map((p) => {
    const sumOfColumnL = m.records
      .filter((r) => r.player === p && r.date && r.date.getTime() >= ROUND_START_MS)
      .reduce((sum, r) => sum + r.score, 0);
    const ok = sumOfColumnL === m.roundTotal[p];
    if (!ok) allMatch = false;
    return {
      player: p,
      roundTotal: m.roundTotal[p],
      sumOfColumnL,
      gapToTarget: Math.max(0, ROUND.TARGET - m.roundTotal[p]),
      check: ok ? "✓ match" : "✗ MISMATCH",
    };
  }));
  console.log(allMatch
    ? `✓ Every round total equals the sum of column L for that player's rows dated on/after ${ROUND.START}.`
    : "✗ At least one round total does NOT match the raw column-L sum — investigate.");

  // ---- 2) The sessions that make up the round ----
  const roundSessions = m.sessionsRound || [];
  console.log(`Sessions in ${ROUND.LABEL} — ${roundSessions.length} in total:`);
  console.table(roundSessions.map((s, i) => ({
    "#": i + 1,
    date: s.key,
    label: s.label,
    ...Object.fromEntries(PLAYERS.map((p) => [p, s.perPlayer[p]])),
  })));

  const first = roundSessions[0] || null;
  const firstIsStart = !!first && !!first.date && first.date.getTime() === ROUND_START_MS;
  console.log(firstIsStart
    ? `✓ First session of the round is ${first.label} — the configured start (${ROUND.START}).`
    : `✗ First session is ${first ? first.label : "(none)"} — expected the ${ROUND.START} session.`);

  const noneBefore = roundSessions.every((s) => s.date && s.date.getTime() >= ROUND_START_MS);
  console.log(noneBefore
    ? `✓ No session dated before ${ROUND.START} appears in the round.`
    : `✗ A session dated before ${ROUND.START} leaked into the round.`);

  const excluded = m.sessions.filter((s) => !roundSessions.includes(s));
  console.log(`Excluded (pre-round) sessions — ${excluded.length}:`, excluded.map((s) => s.label));

  // ---- 3) Undated rows. These belong to NO session, so they are invisible on
  //         both charts and count towards no round — exactly the failure mode
  //         where a hand is entered but the graph never moves. Never silent.
  const undated = m.records.filter((r) => !r.date);
  if (undated.length) {
    console.warn(
      `⚠ ${undated.length} row(s) have an unreadable date in column B and are excluded ` +
      `from every session, chart and round total. Raw values seen: ` +
      `${[...new Set(undated.map((r) => JSON.stringify(r.rawDate)))].join(", ")}`
    );
    console.table(undated.map((r) => ({
      hand: r.hand, player: r.player, columnB: r.rawDate, score: r.score,
    })));
  } else {
    console.log("✓ Every row has a readable date — no hands stranded off the charts.");
  }

  console.groupEnd();
  return { allMatch, firstIsStart, noneBefore, roundSessions, excluded };
  /* eslint-enable no-console */
}

/** Build the "latest hand" summary from the rows of a single hand. */
export function summariseHand(handRows, fallbackRec) {
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
