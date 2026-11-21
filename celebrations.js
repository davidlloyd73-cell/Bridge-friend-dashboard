// =============================================================================
// celebrations.js — what is worth a cheer when new hands arrive.
//
// Pure: compares the model the page was showing with the one just built and
// returns a few short messages. Only ever called for a refresh that happens
// while the page is open, never on first load, so opening the dashboard
// doesn't replay old news.
// =============================================================================

import { PLAYERS, ROUND, fmtNum } from "./data.js?v=20261121c";

const SUITS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠", "no trumps": "NT", notrumps: "NT", nt: "NT" };

/** The one player strictly out in front on `totals`, or null (nobody scored / a tie). */
function soleLeader(totals) {
  const ranked = [...PLAYERS].sort((a, b) => totals[b] - totals[a]);
  return totals[ranked[0]] > 0 && totals[ranked[0]] > totals[ranked[1]] ? ranked[0] : null;
}

const grandTotals = (m) => m.grand;

export function celebrate(prev, next) {
  if (!prev || !next || next.rowCount <= prev.rowCount) return [];
  const out = [];

  // A new round has begun (the last one was won and a new night started).
  // Round totals reset, so none of the round comparisons below would mean
  // anything; say so and skip the round comparisons below.
  const newRound = prev.roundLabel !== next.roundLabel;
  if (newRound) {
    const last = (next.pastRounds || []).at(-1);
    out.push(`🆕 ${next.roundLabel} is under way${last ? ` — ${last.winners.join(" & ")} won ${last.label}` : ""}.`);
  }

  // Round finished: nothing else matters as much. Judged by the shared finish
  // in data.js (first to cross wins), so this can't name someone the race
  // page doesn't.
  if (!newRound && !prev.finish && next.finish) {
    const f = next.finish, names = f.winners.join(" & ");
    out.push(`🏆 ${names} ${f.winners.length > 1 ? "are" : "is"} home first! ${ROUND.LABEL} is won — ${fmtNum(f.totalsAtLine[f.winners[0]])}.`);
  }

  // A slam brought home on the newest hand.
  const h = next.latestHand, ph = prev.latestHand;
  const isNewHand = h && (!ph || h.handNo !== ph.handNo || h.dateLabel !== ph.dateLabel);
  if (isNewHand && h.level >= 6 && h.resultDiff !== null && h.resultDiff >= 0) {
    const sym = SUITS[String(h.suit).toLowerCase()] || h.suit;
    out.push(`🎉 ${h.declarer} makes a ${h.level >= 7 ? "grand " : ""}slam — ${h.level}${sym}!`);
  }

  // A new biggest hand on record.
  const nb = next.recordBook && next.recordBook.bigHand, pb = prev.recordBook && prev.recordBook.bigHand;
  if (nb && pb && nb.score > pb.score) {
    out.push(`💥 New record hand: ${nb.side.join(" & ")}, ${fmtNum(nb.score)} points.`);
  }

  // Passing a 10,000 mark in the round.
  if (!newRound) PLAYERS.forEach((p) => {
    const before = Math.floor(prev.roundTotal[p] / 10000), after = Math.floor(next.roundTotal[p] / 10000);
    if (after > before && next.roundTotal[p] < ROUND.TARGET) {
      out.push(`🏁 ${p} passes ${fmtNum(after * 10000)} in ${ROUND.LABEL}.`);
    }
  });

  // Changes at the top. Tonight only counts within the same session, so the
  // first hand of a new night doesn't read as everyone "taking the lead".
  const sameNight = prev.latestSession && next.latestSession && prev.latestSession.key === next.latestSession.key;
  const lead = (label, a, b) => {
    if (a && b && a !== b) out.push(`👑 ${b} takes the lead ${label}.`);
  };
  if (sameNight) lead("tonight", soleLeader(prev.latestSession.perPlayer), soleLeader(next.latestSession.perPlayer));
  // Once the round is won, the winner is settled: no "takes the lead" after it.
  if (!newRound && !next.finish) lead(`in ${ROUND.LABEL}`, soleLeader(prev.roundTotal), soleLeader(next.roundTotal));
  lead("overall", soleLeader(grandTotals(prev)), soleLeader(grandTotals(next)));

  return out.slice(0, 3);
}
