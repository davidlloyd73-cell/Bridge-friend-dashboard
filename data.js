// =============================================================================
// data.js — single source of truth for fetching, parsing, and computing the
// Bridge Friends sheet model. Imported by BOTH app.js (main dashboard) and
// race.js (race-to-50000 page) so the two pages never disagree on totals.
// =============================================================================

import { CONFIG } from "./config.js";

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

/**
 * Parse a UK date string "dd/mm/yyyy" (optionally with " HH:MM:SS") into a Date.
 * Never interprets as US mm/dd. Returns null if unparseable.
 */
export function parseUKDate(v) {
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
    };
  });

  // ---- Per-player totals (all-time + 2026) ----
  const grand = {}, y2026 = {}, hcpTotal = {}, hcp2026 = {};
  PLAYERS.forEach((p) => { grand[p] = 0; y2026[p] = 0; hcpTotal[p] = 0; hcp2026[p] = 0; });

  records.forEach((rec) => {
    if (!(rec.player in grand)) return; // skip "Unknown" from leaderboard maths
    grand[rec.player] += rec.score;
    hcpTotal[rec.player] += rec.hcp;
    if (rec.year === 2026) { y2026[rec.player] += rec.score; hcp2026[rec.player] += rec.hcp; }
  });

  const efficiency = {}, efficiency2026 = {};
  PLAYERS.forEach((p) => {
    efficiency[p] = hcpTotal[p] > 0 ? Math.round(grand[p] / hcpTotal[p]) : 0;
    efficiency2026[p] = hcp2026[p] > 0 ? Math.round(y2026[p] / hcp2026[p]) : 0;
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
  const latest2026Session = sessions2026.length ? sessions2026[sessions2026.length - 1] : null;

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
    records, grand, y2026, hcpTotal, hcp2026, efficiency, efficiency2026,
    sessions, allTime, race2026, latest2026Session,
    latestHand, latestSession, latestSessionHands,
    rowCount: records.length,
    newestTsMs: latestRec ? latestRec.tsMs : 0,
    fetchedAt: new Date(),
  };
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
