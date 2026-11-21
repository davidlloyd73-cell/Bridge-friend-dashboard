// =============================================================================
// nightcheck.js — "Tonight's check": slips in the current session's entries,
// found while everyone is still at the table so they can be fixed that night.
//
// Pure: takes the model data.js built and the current time, returns a list of
// issues. app.js shows them at the top of the Tonight tab and pops up a note
// when a new one appears. The older, whole-history "Sheet check" (HCP totals)
// is separate and unchanged.
//
// Two kinds of issue:
//   serious — changes the scores: a missing or doubled entry, a mistyped hand
//             number, or points that don't pair up (partners score the same,
//             and only one side scores).
//   minor   — partners disagree about the contract or the tricks made. The
//             points are fine, but the contract stats would be off.
// A hand still being entered (fewer than four entries, the latest in the last
// few minutes) is left alone until it's finished.
// =============================================================================

import { PLAYERS, fmtClock } from "./data.js?v=20261121h";

const SHOW_FOR_MS = 18 * 3600 * 1000;   // the check shows until 18 hours after the last hand
const IN_PROGRESS_MS = 4 * 60 * 1000;   // a hand logged in the last 4 minutes may still be arriving
const STRAY_GAP = 40;                   // a hand number this far from tonight's run is out of line
const SUIT_SYM = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠", "no trumps": "NT", notrumps: "NT", nt: "NT" };

const contractOf = (r) => `${r.level}${SUIT_SYM[r.suit.toLowerCase()] || r.suit} with ${r.tricksMade} tricks`;
const listNames = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} or ${a[a.length - 1]}`);

export function nightCheck(m, now = Date.now()) {
  const s = m.latestSession;
  if (!s || !s.lastTsMs || now - s.lastTsMs > SHOW_FOR_MS) return null;
  const recs = m.records.filter((r) => r.sessionKey === s.key && PLAYERS.includes(r.player));
  const hands = new Map();
  recs.forEach((r) => { if (!hands.has(r.hand)) hands.set(r.hand, []); hands.get(r.hand).push(r); });

  const nums = [...hands.keys()].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const median = nums[Math.floor(nums.length / 2)];
  const isStray = (hn, rows) => rows.length <= 2 && (!Number.isFinite(Number(hn)) || Math.abs(Number(hn) - median) > STRAY_GAP);
  const inRun = nums.filter((n) => Math.abs(n - median) <= STRAY_GAP);
  const run = inRun.length ? `${inRun[0]}–${inRun[inRun.length - 1]}` : "";
  const inProgress = (rows) => rows.length < PLAYERS.length && now - Math.max(...rows.map((r) => r.tsMs)) < IN_PROGRESS_MS;

  const issues = [];
  const explained = new Set(); // "hand|player" gaps that a stray entry accounts for

  // Mistyped hand numbers first, so the gap they leave isn't reported twice.
  for (const [hn, rows] of hands) {
    if (!isStray(hn, rows)) continue;
    const who = rows.map((r) => r.player);
    const t = rows[0].tsMs;
    const fits = [...hands.entries()].filter(([h2, r2]) => !isStray(h2, r2)
      && who.every((p) => !r2.some((r) => r.player === p))
      && t >= Math.min(...r2.map((r) => r.tsMs)) - 3 * 60000 && t <= Math.max(...r2.map((r) => r.tsMs)) + 3 * 60000);
    let text = `Hand ${hn}: only ${who.join(" and ")} logged it, and it's out of line with tonight's hand numbers (${run}).`;
    if (fits.length === 1) {
      const [h2] = fits[0];
      text += ` It was entered at ${fmtClock(t)}, during hand ${h2}, which has no entry from ${who.join(" or ")} — probably a typo for ${h2}.`;
      who.forEach((p) => explained.add(`${h2}|${p}`));
    }
    issues.push({ id: `stray|${hn}|${who.join(",")}`, hand: hn, severity: "serious", text });
  }

  for (const [hn, rows] of hands) {
    if (isStray(hn, rows) || inProgress(rows)) continue;
    const who = rows.map((r) => r.player);
    const twice = PLAYERS.filter((p) => who.filter((x) => x === p).length > 1);
    if (twice.length) {
      issues.push({ id: `dup|${hn}|${twice.join(",")}`, hand: hn, severity: "serious", text: `Hand ${hn}: ${twice.join(" and ")} entered it twice — one entry should be deleted.` });
      continue;
    }
    const missing = PLAYERS.filter((p) => !who.includes(p) && !explained.has(`${hn}|${p}`));
    if (missing.length) {
      issues.push({ id: `missing|${hn}|${missing.join(",")}`, hand: hn, severity: "serious", text: `Hand ${hn}: no entry from ${listNames(missing)}.` });
      continue;
    }
    if (rows.length !== PLAYERS.length) continue; // gap explained by a mistyped number above
    const yes = rows.filter((r) => r.wonAuction), no = rows.filter((r) => !r.wonAuction);
    const pts = rows.map((r) => `${r.player} ${r.score}`).join(", ");
    if (yes.length !== 2) {
      issues.push({ id: `auction|${hn}`, hand: hn, severity: "serious", text: `Hand ${hn}: ${yes.length === 0 ? "nobody says" : `${yes.length === 1 ? "only " : ""}${yes.map((r) => r.player).join(", ")} ${yes.length === 1 ? "says" : "say"}`} their side won the auction — it should be exactly two partners.` });
      continue;
    }
    if (yes[0].score !== yes[1].score || no[0].score !== no[1].score || (yes[0].score > 0 && no[0].score > 0)) {
      issues.push({ id: `points|${hn}|${pts}`, hand: hn, severity: "serious", text: `Hand ${hn}: the points don't pair up (${pts}). Partners should score the same, and only one side scores.` });
      continue;
    }
    if (contractOf(yes[0]) !== contractOf(yes[1])) {
      issues.push({ id: `contract|${hn}|${contractOf(yes[0])}|${contractOf(yes[1])}`, hand: hn, severity: "minor", text: `Hand ${hn}: ${yes[0].player} says ${contractOf(yes[0])}, ${yes[1].player} says ${contractOf(yes[1])}. The points agree, so only the contract stats are affected.` });
    }
  }

  const n = (h) => (Number.isFinite(Number(h)) ? Number(h) : Infinity);
  issues.sort((a, b) => n(a.hand) - n(b.hand));
  return { label: s.label, issues, serious: issues.filter((i) => i.severity === "serious").length };
}

/** Pop-up lines for issues that weren't there on the previous refresh. */
export function newIssueAlerts(prev, next) {
  if (!prev || !next) return [];
  const seen = new Set(prev.issues.map((i) => i.id));
  return next.issues.filter((i) => i.severity === "serious" && !seen.has(i.id)).map((i) => `⚠️ ${i.text}`).slice(0, 2);
}
