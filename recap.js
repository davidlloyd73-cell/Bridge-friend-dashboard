// =============================================================================
// recap.js — the "copy recap" text: a short summary of the latest session,
// written to paste straight into WhatsApp (*bold* is WhatsApp's own markup).
// Pure: takes the model, returns a string. No DOM, so it can be tested alone.
// =============================================================================

import { PLAYERS, ROUND, fmtNum } from "./data.js?v=20261018f";

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];
const SUITS = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠", "no trumps": "NT", notrumps: "NT", nt: "NT" };

/** Plain-text contract: "6♣*", "3NT", "4♥**". */
function contractText(h) {
  if (!h.hasContract) return "";
  const d = String(h.doubled || "").toLowerCase();
  const mark = d.startsWith("redouble") ? "**" : d.startsWith("double") ? "*" : "";
  return `${h.level}${SUITS[String(h.suit).toLowerCase()] || h.suit}${mark}`;
}

/** Players ranked best first, with ties sharing a place. */
function ranking(totals) {
  const ranked = [...PLAYERS].sort((a, b) => totals[b] - totals[a] || PLAYERS.indexOf(a) - PLAYERS.indexOf(b));
  const place = {};
  ranked.forEach((p, i) => {
    place[p] = i > 0 && totals[p] === totals[ranked[i - 1]] ? place[ranked[i - 1]] : i;
  });
  return { ranked, place };
}

export function buildRecap(m, siteUrl) {
  const s = m.latestSession;
  if (!s) return "";
  const lines = [];
  const hands = m.latestSessionHands || [];

  lines.push(`*Bridge night — ${s.label}*`);
  const night = ranking(s.perPlayer);
  night.ranked.forEach((p) => lines.push(`${MEDALS[night.place[p]]} ${p} ${fmtNum(s.perPlayer[p])}`));

  const top = s.perPlayer[night.ranked[0]], next = s.perPlayer[night.ranked[1]];
  const winners = night.ranked.filter((p) => s.perPlayer[p] === top);
  lines.push("");
  lines.push(winners.length > 1
    ? `${hands.length} hands · ${winners.join(" and ")} level at the top`
    : `${hands.length} hands · ${winners[0]} won by ${fmtNum(top - next)}`);

  // The night's biggest single hand, to whichever side took the points.
  let big = null;
  hands.forEach((h) => {
    const declWon = h.declScore >= h.defScore;
    const score = declWon ? h.declScore : h.defScore;
    if (score > 0 && (!big || score > big.score)) {
      big = { score, h, side: declWon ? [h.declarer, h.partner].filter(Boolean) : h.defenders };
    }
  });
  if (big) {
    const c = contractText(big.h);
    lines.push(`Biggest hand: ${big.side.join(" & ")}${c ? ` ${c}` : ""}, ${fmtNum(big.score)} (hand ${big.h.handNo})`);
  }

  // Whinge Factor: the HCP you were dealt. Most dealt is the one to blame.
  const hcp = PLAYERS.map((p) => [p, m.hcpSession[p].sum]);
  const most = Math.max(...hcp.map((x) => x[1]));
  if (most > 0) {
    const who = hcp.filter((x) => x[1] === most).map((x) => x[0]);
    lines.push(`Best cards: ${who.join(" and ")} (${most} HCP dealt)`);
  }

  const r = ranking(m.roundTotal);
  if (m.roundTotal[r.ranked[0]] > 0) {
    lines.push("");
    lines.push(`*${ROUND.LABEL}* — to ${fmtNum(ROUND.TARGET)}`);
    r.ranked.forEach((p) => lines.push(`${r.place[p] + 1}. ${p} ${fmtNum(m.roundTotal[p])}`));
    const lead = m.pace && m.pace[r.ranked[0]];
    if (lead) {
      lines.push(`${r.ranked[0]} on pace to finish about ${lead.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);
    }
  }

  if (siteUrl) { lines.push(""); lines.push(siteUrl); }
  return lines.join("\n");
}
