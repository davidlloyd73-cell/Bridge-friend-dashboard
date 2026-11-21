// =============================================================================
// bridge-puzzle.js — the hub's bridge problems. Pure logic, no DOM, so Node can
// test it (see scripts/test_puzzle.mjs).
//
// BIDDING follows Andrew Robson's flip chart (Acol: 12-14 1NT, four-card
// majors, "Rule of 20" to open, "Rule of 14" to respond at the two level,
// SQOT for overcalls, "Level of the Fit" over partner's overcall). Card numbers
// in the explanations refer to that chart.
//
// How a problem is made: deal a random hand, then work out the answer with the
// chart's rules. Anything the chart does not settle clearly (Stayman, doubles,
// slam bidding, "a good 13", borderline Rule of 14 counts...) is thrown away
// and a new hand is dealt. So every problem shown has one answer the chart
// supports; the cost is that grey-area hands never appear.
//
// CARD PLAY problems are not on the chart: they use standard defensive
// principles (opening lead against no-trumps, third hand high, second hand low,
// cover an honour with an honour), again only where the answer is clear.
//
// Every problem comes from a seed (the "problem number"), so the same number
// always gives the same problem: hub.html?p=<number> reopens it.
// =============================================================================

// ---- Cards and bids --------------------------------------------------------
// Suit/strain index everywhere: 0 clubs, 1 diamonds, 2 hearts, 3 spades, 4 NT.
export const SYM = ["♣", "♦", "♥", "♠", "NT"];
export const SUIT_NAME = ["clubs", "diamonds", "hearts", "spades", "no-trumps"];
export const SEAT_NAME = ["North", "East", "South", "West"];
const STRAIN_CH = "CDHSN";
const RANK_CH = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10" };

export const rankStr = (r) => RANK_CH[r] || String(r);
export const cardId = (s, r) => `${STRAIN_CH[s]}${r}`;
export const cardText = (s, r) => `${SYM[s]}${rankStr(r)}`;
export const parseCard = (id) => ({ s: STRAIN_CH.indexOf(id[0]), r: Number(id.slice(1)) });

export const bid = (level, strain) => `${level}${STRAIN_CH[strain]}`;
export function parseBid(b) {
  if (b === "P" || b === "X") return null;
  return { level: Number(b[0]), strain: STRAIN_CH.indexOf(b[1]) };
}
/** Order of bids: 1C < 1D < ... < 1NT < 2C ... ; Pass is -1. */
export function bidRank(b) {
  const p = parseBid(b);
  return p ? (p.level - 1) * 5 + p.strain : -1;
}
export function bidText(b) {
  if (b === "P") return "Pass";
  if (b === "X") return "Double";
  const p = parseBid(b);
  return `${p.level}${SYM[p.strain]}`;
}
/** The highest bid in an auction so far ("P" if none). */
export function highestBid(calls) {
  return calls.reduce((hi, c) => (bidRank(c) > bidRank(hi) ? c : hi), "P");
}

// ---- Random numbers (seeded) -----------------------------------------------
export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function shuffledDeck(rand) {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ s, r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** A hand: its cards by suit (high to low) plus the counts the rules use. */
export function makeHand(cards) {
  const suits = [[], [], [], []];
  cards.forEach((c) => suits[c.s].push(c.r));
  suits.forEach((s) => s.sort((a, b) => b - a));
  const len = suits.map((s) => s.length);
  const hcp = cards.reduce((n, c) => n + Math.max(0, c.r - 10), 0);
  const shape = [...len].sort((a, b) => b - a).join("");
  return { suits, len, hcp, shape, bal: ["4333", "4432", "5332"].includes(shape) };
}

/** Deal four hands. Returns [hand0..hand3] as makeHand objects. */
function dealFour(rand) {
  const deck = shuffledDeck(rand);
  return [0, 1, 2, 3].map((i) => makeHand(deck.slice(i * 13, i * 13 + 13)));
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** "a void in hearts", "a singleton heart", "two hearts" — for short holdings. */
function shortHolding(n, s) {
  const one = SUIT_NAME[s].replace(/s$/, "");
  return n === 0 ? `a void in ${SUIT_NAME[s]}` : n === 1 ? `a singleton ${one}` : `two ${SUIT_NAME[s]}`;
}
const suitList = (h, s) => h.suits[s].map(rankStr).join(" ") || "none";

// ---- Small rule helpers ----------------------------------------------------
/** Card 3: when supporting (only), a singleton is worth about 3 more, a void 5. */
function shortagePoints(h, trump) {
  return h.len.reduce((n, l, s) => n + (s === trump ? 0 : l === 1 ? 3 : l === 0 ? 5 : 0), 0);
}
/** Card 9: SQOT = number of cards + number of honours (A K Q J 10). */
export function sqot(h, s) {
  return h.len[s] + h.suits[s].filter((r) => r >= 10).length;
}
/** Length points: one for each card over four in a suit. */
const lengthPoints = (h) => h.len.reduce((n, l) => n + Math.max(0, l - 4), 0);
/** Honours in a suit: A K Q J 10 each count one (SQOT, cards 9, 12, 22). */
const honours = (h, s) => h.suits[s].filter((r) => r >= 10).length;
const acesIn = (h) => h.suits.filter((c) => c[0] === 14).length;

/** Conventions p1, Losing Trick Count: in each suit look at the first three
 *  cards (or fewer if shorter) and count a loser for each missing A, K, Q. */
export function losers(h) {
  return h.suits.reduce((n, cards) => {
    const lim = Math.min(cards.length, 3);
    const top = cards.slice(0, lim);
    return n + lim - [14, 13, 12].slice(0, lim).filter((r) => top.includes(r)).length;
  }, 0);
}

/** Card 11: take-out double needs SOS — Support (3+ in every unbid suit),
 *  Opening points, Shortage (fewer than three in their suit). */
function sos(h, X) {
  return h.hcp >= 12 && h.len[X] <= 2 && [0, 1, 2, 3].every((s) => s === X || h.len[s] >= 3);
}
const sosWhy = (h, X) => `SOS: Support for every unbid suit (three+ in each), Opening points (${h.hcp}), Shortage in ${SUIT_NAME[X]} (${h.len[X]}). Double for take-out.`;

/** Card 1 / card 7: opener's suit. Longest; equal length the higher ranking,
 *  except 1H with four-four in the majors. */
function openerSuit(h) {
  const m = Math.max(...h.len);
  const tied = [0, 1, 2, 3].filter((s) => h.len[s] === m);
  if (tied.length === 1) return tied[0];
  if (m === 4 && tied.includes(2) && tied.includes(3)) return 2;
  return Math.max(...tied);
}

/** Card 7 for responder / overcaller among `cands` (suits of 4+ cards):
 *  longest; two+ fours the cheapest bid; two+ fives the higher ranking. */
function chooseSuit(h, cands, levelOf) {
  if (!cands.length) return null;
  const m = Math.max(...cands.map((s) => h.len[s]));
  const tied = cands.filter((s) => h.len[s] === m);
  if (tied.length === 1) return tied[0];
  if (m === 4) return tied.reduce((a, b) => (levelOf(a) * 5 + a <= levelOf(b) * 5 + b ? a : b));
  return Math.max(...tied);
}

/** Notrump stopper (card 8: "e.g. A32, K32, QJ2 or better"). 'unclear' for
 *  holdings like Kx or Qxx that the chart doesn't settle. */
function stopper(h, s) {
  const c = h.suits[s], has = (r) => c.includes(r);
  if (has(14)) return "yes";
  if (has(13) && c.length >= 3) return "yes";
  if (has(12) && has(11) && c.length >= 3) return "yes";
  if (has(13) || has(12)) return "unclear";
  return "no";
}

// =============================================================================
// Seating. Calls run from the dealer clockwise (N, E, S, W). `you` is the seat
// to act next, so the dealer is whoever started that many calls earlier.
// =============================================================================
function seating(rand, calls) {
  const you = Math.floor(rand() * 4);
  const dealer = (((you - calls.length) % 4) + 4) % 4;
  return { you, dealer, partner: (you + 2) % 4 };
}

// =============================================================================
// BIDDING PROBLEMS
// Each returns null (deal again) or { calls, hand, answer, why, card, tag }.
// =============================================================================

/** Cards 1, 2, 7 — what do you open? First or second seat only. */
export function openingBidFor(h) {
  if (h.hcp > 25) return null;
  const s = openerSuit(h), name = SUIT_NAME[s];
  if (h.bal) {
    if (h.hcp < 12) return { answer: "P", why: `Balanced with ${h.hcp} points: too weak to open (balanced openings start at 12).`, card: "Card 1 · Opening when balanced" };
    if (h.hcp <= 14) return { answer: "1N", why: `Balanced (${h.shape.split("").join("-")}) with ${h.hcp} points: every balanced 12–14 opens 1NT.`, card: "Card 1 · Opening when balanced" };
    if (h.hcp <= 19) return { answer: bid(1, s), why: `Balanced with ${h.hcp} points is too strong for 1NT, so open one of your longest suit (${name})${tieNote(h)}. You will show the strength by rebidding no-trumps.`, card: "Card 1 · Opening when balanced" };
    if (h.hcp <= 22) return { answer: "2N", why: `Balanced with ${h.hcp} points: 20–22 opens 2NT.`, card: "Card 19 · 2NT opening" };
    return { answer: "2C", why: `${h.hcp} points: 23+ opens 2♣, balanced or not.`, card: "Card 17 · 2♣ opening" };
  }
  const sorted = [...h.len].sort((a, b) => b - a);
  const r20 = h.hcp + sorted[0] + sorted[1];
  if (h.hcp >= 23) return { answer: "2C", why: `${h.hcp} points: 23+ opens 2♣, then rebid your longest suit.`, card: "Card 17 · 2♣ opening" };
  if (h.hcp >= 20) return null; // with weak twos, card 18 says what to open — not photographed yet
  const sum = `${h.hcp} points + ${sorted[0]} + ${sorted[1]} cards = ${r20}`;
  const L = sorted[0], longS = [0, 1, 2, 3].filter((x) => h.len[x] === L);
  // Pre-empts (cards 22, 23): a good long suit (two+ honours) and a weak hand.
  if (L >= 6 && longS.length === 1) {
    const p = longS[0], hon = honours(h, p), suitTxt = `${SUIT_NAME[p]} (${suitList(h, p)}, ${plural(hon, "honour")})`;
    let pre = null, why, card;
    if (L >= 8) {
      if (hon < 2 || h.hcp > 10) return null;
      pre = bid(4, p); card = "Card 23 · Weak threes";
      why = `Eight good ${suitTxt} and ${h.hcp} points: pre-empt at the four level, 4${SYM[p]}.`;
    } else if (L === 7) {
      if (hon >= 2 && h.hcp >= 3 && h.hcp <= 10) {
        pre = bid(3, p); card = "Card 23 · Weak threes";
        why = `A good seven-card suit, ${suitTxt}, and ${h.hcp} points (about 3–10): pre-empt with 3${SYM[p]}.`;
      } else if (r20 < 20) return null; // poor seven-card suits: card 23 says pass, unless a weak two — unclear
    } else if (p !== 0 && sorted[1] <= 4 && hon >= 2 && h.hcp >= 5 && h.hcp <= 10) {
      pre = bid(2, p); card = "Card 22 · Weak twos";
      why = `Six-card ${suitTxt} with ${h.hcp} points: a weak two (six-card suit, two+ honours, 5–10 points). Open 2${SYM[p]}.`;
    }
    if (pre) {
      if (r20 >= 20) return null; // both a pre-empt and a Rule of 20 opening: judgement
      return { answer: pre, why: `${why} (Rule of 20 fails: ${sum}.)`, card };
    }
  }
  if (L >= 8) return null;
  if (r20 >= 20) return { answer: bid(1, s), why: `Rule of 20: ${sum}, so open. Open one of your longest suit (${name})${tieNote(h)}.`, card: "Card 2 · Opening when unbalanced" };
  const weakNote = L === 6 && longS.length === 1 && longS[0] === 0 ? " (A six-card club suit can't be a weak two: 2♣ is the strong opening.)"
    : L === 6 && longS.length === 1 ? ` (Not a weak two: that needs two+ honours and 5–10 points.)` : "";
  return { answer: "P", why: `Rule of 20: ${sum}, which is short of 20, so pass.${weakNote}`, card: "Card 2 · Opening when unbalanced" };
}
function tieNote(h) {
  const m = Math.max(...h.len), tied = [0, 1, 2, 3].filter((s) => h.len[s] === m);
  if (tied.length < 2) return "";
  if (m === 4 && tied.includes(2) && tied.includes(3)) return "; with four-four in the majors open 1♥";
  return "; with equal length, open the higher ranking";
}

function genOpening(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const r = openingBidFor(h);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.75) return null; // keep passes from dominating
  const calls = rand() < 0.5 ? [] : ["P"];
  return { calls, hand: h, ...r, tag: "Opening" };
}

/** Cards 3, 4, 7 — partner opens one of a suit, RHO passes. */
export function responseToSuit(h, X) {
  if (h.hcp > 15) return null;
  const sx = SYM[X];
  if (h.len[X] >= 4) {
    if (X < 2 && (h.len[2] >= 4 || h.len[3] >= 4)) return null; // major vs minor support: not settled by the chart
    const sp = h.hcp + shortagePoints(h, X);
    if (sp >= (X < 2 ? 13 : 16)) return null; // game-forcing minor raises / slam hands: not on the chart
    const extra = sp > h.hcp ? ` (${h.hcp} HCP plus ${sp - h.hcp} for shortage, since you're supporting)` : "";
    const line = "Support line: 0–5 pass, 6–9 two, 10–12 three, 13+ four.";
    const lv = sp <= 5 ? 0 : sp <= 9 ? 2 : sp <= 12 ? 3 : 4;
    return {
      answer: lv ? bid(lv, X) : "P",
      why: `First priority is support with four+ cards: you have ${h.len[X]} ${SUIT_NAME[X]}. You count ${sp} points${extra}. ${line}`,
      card: "Card 3 · Responding with support",
    };
  }
  if (h.hcp <= 5) return { answer: "P", why: `${h.hcp} points: with 0–5 you pass.`, card: "Card 4 · Responding without support" };

  const levelOf = (s) => (s > X ? 1 : 2);
  const cands = [0, 1, 2, 3].filter((s) => s !== X && h.len[s] >= 4);
  const t = chooseSuit(h, cands, levelOf);
  if (t === null) return null;
  const card = "Card 4 · Responding without support";
  if (levelOf(t) === 1) {
    return { answer: bid(1, t), why: `No four-card support, ${h.hcp} points. Respond in your longest suit at the lowest level${cands.length > 1 ? " (cheapest of fours, higher of fives)" : ""}: ${SUIT_NAME[t]} can go at the one level, and a one-over-one has no upper limit.`, card };
  }
  const r14 = h.hcp + h.len[t], r14lp = r14 + lengthPoints(h);
  if ((r14 >= 14) !== (r14lp >= 14)) return null; // depends on whether length points count: unclear
  if (r14 >= 14) {
    return { answer: bid(2, t), why: `Your longest suit, ${SUIT_NAME[t]}, would have to be bid at the two level. Rule of 14: ${h.hcp} points + ${h.len[t]} cards = ${r14}, so it passes: bid 2${SYM[t]}.`, card };
  }
  const fail = `Your longest suit, ${SUIT_NAME[t]}, would need the two level, but the Rule of 14 fails (${h.hcp} + ${h.len[t]} = ${r14}). `;
  const one = cands.filter((s) => s > X);
  if (one.length) {
    const o = chooseSuit(h, one, levelOf);
    return { answer: bid(1, o), why: `${fail}First choice then: a one-over-one, so bid 1${SYM[o]} with your ${plural(h.len[o], SUIT_NAME[o].replace(/s$/, ""))}.`, card };
  }
  if (h.len[X] === 3) {
    if (X < 2) return null; // three-card minor raises: not on the chart
    if (h.suits[X][0] < 12) return null; // "three decent cards": unclear without an honour
    return { answer: bid(2, X), why: `${fail}No one-level suit to bid, so the next choice is to support partner with three decent cards (${suitList(h, X)}): 2${sx}. Card 3 allows a single major raise with three cards when the alternative is 1NT.`, card };
  }
  return { answer: "1N", why: `${fail}No suit to bid at the one level and no three-card support, so bid the "dustbin" 1NT.`, card };
}

function genRespondSuit(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const X = Math.floor(rand() * 4);
  if (h.len[X] > 5) return null;
  const r = responseToSuit(h, X);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.7) return null;
  const calls = rand() < 0.5 ? [bid(1, X), "P"] : ["P", bid(1, X), "P"];
  return { calls, hand: h, ...r, tag: "Responding to partner" };
}

/** Card 5 — your follow-up after opening 1NT, given partner's response. */
export function openerAfter1NT(h, resp) {
  let answer, why;
  if (resp === "2N") {
    if (h.hcp === 13) return null; // "a good 13" is judgement
    answer = h.hcp === 14 ? "3N" : "P";
    why = h.hcp === 14
      ? "Partner's 2NT invites game with 11–12. You have a maximum (14), so raise to 3NT."
      : "Partner's 2NT invites game with 11–12. You have a minimum (12), so pass.";
  } else if (resp === "2D" || resp === "2H") {
    const M = parseBid(resp).strain + 1;
    if (h.len[M] >= 4 && h.hcp === 13) return null; // maximum or not: judgement
    const jump = h.len[M] >= 4 && h.hcp === 14;
    answer = bid(jump ? 3 : 2, M);
    why = `Partner's ${bidText(resp)} is a transfer showing five+ ${SUIT_NAME[M]}: complete it with 2${SYM[M]}` +
      (jump ? `. But with a maximum (14) and four ${SUIT_NAME[M]} (${suitList(h, M)}), jump to 3${SYM[M]}.` : `${h.len[M] >= 4 ? " (you'd jump only with a maximum)" : ""}.`);
  } else if (resp === "2S") {
    answer = "3C";
    why = "Partner's 2♠ shows 0–10 points with six+ clubs or diamonds. Bid 3♣; partner passes or corrects to 3♦.";
  } else if (resp === "2C") {
    answer = h.len[2] >= 4 ? "2H" : h.len[3] >= 4 ? "2S" : "2D";
    why = "Partner's 2♣ is Stayman, asking for a four-card major. " + (answer === "2H"
      ? `You have four hearts (${suitList(h, 2)}): bid 2♥${h.len[3] >= 4 ? " — with both majors, show hearts first" : ""}.`
      : answer === "2S" ? `You have four spades (${suitList(h, 3)}) but not four hearts: bid 2♠.` : "No four-card major: bid 2♦.");
  } else {
    answer = "P";
    why = `Partner's ${bidText(resp)} is a sign-off in game. Partner is in charge: pass.`;
  }
  return { answer, why };
}

/** Card 5 — you opened 1NT; partner has responded. */
function genOpenerAfter1NT(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  if (!h.bal || h.hcp < 12 || h.hcp > 14) return null;
  const roll = rand();
  const resp = roll < 0.25 ? "2N" : roll < 0.55 ? pick(rand, ["2D", "2H"]) : roll < 0.85 ? "2C" : roll < 0.93 ? "2S" : "3N";
  const r = openerAfter1NT(h, resp);
  if (!r) return null;
  const { answer, why } = r;
  const calls = rand() < 0.5 ? ["1N", "P", resp, "P"] : ["P", "1N", "P", resp, "P"];
  const card = resp === "2C" ? "Card 21 · Stayman" : resp === "2D" || resp === "2H" || resp === "2S" ? "Conventions p10 · Transfers" : "Card 5 · Opening 1NT";
  return { calls, hand: h, answer, why: `${why} (You opened 1NT with ${h.hcp}.)`, card, tag: "Opener's rebid" };
}

/** Card 6 — partner opened 1NT (12–14). */
export function responseTo1NT(h) {
  if (h.hcp >= 17) return null; // slam hands
  const card = "Card 6 · Responding to 1NT", cardT = "Conventions p10 · Transfers", cardS = "Card 21 · Stayman";
  const M5 = [2, 3].filter((s) => h.len[s] >= 5), M4 = [2, 3].filter((s) => h.len[s] === 4);
  const fives = [0, 1, 2, 3].filter((s) => h.len[s] >= 5);
  if (M5.length === 2) return null;
  if (M5.length === 1) {
    const M = M5[0], other = M === 2 ? 3 : 2;
    if (h.len[other] === 4) {
      if (h.hcp <= 10) return { answer: "2C", why: `Weak (${h.hcp}) but five-four in the majors: bid Stayman, which caters for every reply — you'll pass 2${SYM[2]} or 2${SYM[3]}, and over 2♦ bid your five-card major ("Weak Stayman").`, card: cardS };
      if (M === 3) return null; // five spades, four hearts, game-going: not on page 10
    }
    if (fives.length > 1) return null;
    const t = bid(2, M - 1);
    return { answer: t, why: `Five+ ${SUIT_NAME[M]}: transfer by bidding the suit below, ${bidText(t)}. Partner completes with 2${SYM[M]} and then you describe your strength${h.hcp <= 10 ? " — weak, you'll simply pass" : ""}.`, card: cardT };
  }
  if (h.hcp <= 10) {
    const m6 = [0, 1].filter((s) => h.len[s] >= 6);
    if (m6.length > 1) return null;
    if (m6.length === 1) return { answer: "2S", why: `Weak (${h.hcp}) with six+ ${SUIT_NAME[m6[0]]}: bid 2♠, which shows 0–10 with a long minor. Partner bids 3♣ and you pass or correct to 3♦.`, card: cardT };
    if (fives.length) return null; // a weak five-card minor: not covered once 2♦ is a transfer
    return { answer: "P", why: `0–10 points (${h.hcp}) and no five-card major: pass. You can't make game opposite 12–14.`, card };
  }
  if (M4.length) {
    if (h.shape === "4333") return null; // no "worry about notrumps": judgement
    return { answer: "2C", why: `Game-going (${h.hcp}) with precisely four ${SUIT_NAME[M4[M4.length - 1]]}${M4.length > 1 ? " and hearts" : ""}: bid Stayman 2♣ to look for a 4-4 major fit.`, card: cardS };
  }
  if (h.hcp <= 12) {
    if (!h.bal) return null; // unbalanced 11–12 "must choose"
    return { answer: "2N", why: `Balanced with 11–12 (${h.hcp}) and no four-card major: bid 2NT, inviting game.`, card };
  }
  return { answer: "3N", why: `13+ points (${h.hcp}) and no four- or five-card major: bid 3NT.`, card };
}

function genRespond1NT(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const r = responseTo1NT(h);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  const calls = rand() < 0.5 ? ["1N", "P"] : ["P", "1N", "P"];
  return { calls, hand: h, ...r, tag: "Responding to 1NT" };
}

/** Cards 7, 8, 9 — right-hand opponent opens one of a suit. */
export function overcall(h, X) {
  const card9 = "Card 9 · Overcalling suits (SQOT)", card11 = "Card 11 · Take-out double";
  const isSos = sos(h, X);
  const dbl = { answer: "X", why: sosWhy(h, X), card: card11 };
  const levelOf = (s) => (s > X ? 1 : 2);
  if (h.bal && h.hcp >= 15 && h.hcp <= 22) {
    const st = stopper(h, X);
    if (st === "unclear") return null;
    if (st === "no") return isSos ? dbl : null;
    if (isSos) return null; // NT overcall or double: judgement
    const five = [0, 1, 2, 3].find((s) => s !== X && h.len[s] >= 5 && sqot(h, s) >= levelOf(s) + 6);
    if (five !== undefined) return null; // suit overcall vs NT overcall: unclear
    const nt = h.hcp <= 19 ? "1N" : "2N";
    return { answer: nt, why: `Balanced with ${h.hcp} points and a stopper in ${SUIT_NAME[X]} (${suitList(h, X)}): ${h.hcp <= 19 ? "15–19 overcalls 1NT" : "20–22 overcalls 2NT"}.`, card: "Card 8 · Notrumps as an overcall" };
  }
  if (h.hcp >= 16) return isSos ? dbl : null;
  const cands = [0, 1, 2, 3].filter((s) => s !== X && h.len[s] >= 5);
  const passOr = (txt) => (isSos ? dbl : h.hcp >= 12 ? null : { answer: "P", why: txt, card: card9 });
  if (!cands.length) return passOr(`No five-card suit to overcall in (you need a good five+ card suit), and ${h.hcp} points isn't a no-trump overcall. Pass.`);
  const s = chooseSuit(h, cands, levelOf);
  if (cands.length > 1 && h.len[cands[0]] === h.len[cands[1]] && Math.abs(sqot(h, cands[0]) - sqot(h, cands[1])) >= 2) return null;
  const lv = levelOf(s), q = sqot(h, s), minPts = lv === 1 ? 6 : 8;
  const ok = q >= lv + 6 && h.hcp >= minPts;
  const others = cands.filter((o) => o !== s && sqot(h, o) >= levelOf(o) + 6 && h.hcp >= (levelOf(o) === 1 ? 6 : 8));
  if (!ok && others.length) return null;
  const hon = honours(h, s);
  const count = `SQOT for ${SUIT_NAME[s]} (${suitList(h, s)}): ${h.len[s]} cards + ${plural(hon, "honour")} = ${q}`;
  if (ok) {
    if (isSos) return null; // overcall or double: judgement
    return { answer: bid(lv, s), why: `${count}, enough for ${lv + 6} tricks, so overcall ${lv}${SYM[s]} (with ${h.hcp} points; you need ${minPts}+ at the ${lv === 1 ? "one" : "two"} level).`, card: card9 };
  }
  const reason = q < lv + 6 ? `${count}, short of the ${lv + 6} tricks a ${lv}${SYM[s]} overcall is for` : `${count}, but ${h.hcp} points is below the ${minPts} you need at the ${lv === 1 ? "one" : "two"} level`;
  return passOr(`${reason}. Pass.`);
}

function genOvercall(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const X = Math.floor(rand() * 4);
  if (h.len[X] > 5) return null;
  const r = overcall(h, X);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  const calls = rand() < 0.5 ? [bid(1, X)] : ["P", bid(1, X)];
  return { calls, hand: h, ...r, tag: "Overcalling" };
}

/** Card 10 — LHO opened 1X, partner overcalled Y, RHO passed or bid 2Z. */
export function responseToOvercall(h, X, pBid, rhoCall) {
  const Y = parseBid(pBid).strain;
  const Z = rhoCall === "P" ? null : parseBid(rhoCall).strain;
  if (h.hcp >= 12) return null;
  const hi = rhoCall === "P" ? pBid : rhoCall;
  const card = "Card 10 · Responding to a suit overcall";
  if (h.len[Y] >= 3) {
    const fit = h.len[Y] + 5, lv = fit - 6;
    if (fit >= 11) return null;
    const b = bid(lv, Y);
    if (bidRank(b) <= bidRank(hi)) return null; // level of the fit already reached / not legal
    return { answer: b, why: `Support first: partner's overcall shows five+ ${SUIT_NAME[Y]} and you have ${h.len[Y]}, so the partnership has ${fit}. Bid to the level of the fit straight away, for ${fit} tricks: ${lv}${SYM[Y]}. No points are needed.`, card };
  }
  const cands = [0, 1, 2, 3].filter((s) => s !== X && s !== Y && s !== Z && h.len[s] >= 5);
  const levelFor = (s) => { for (let l = 1; l <= 3; l++) if (bidRank(bid(l, s)) > bidRank(hi)) return l; return 9; };
  const s = chooseSuit(h, cands, levelFor);
  const passOk = h.hcp <= 8;
  if (s === null) return passOk ? { answer: "P", why: `With ${shortHolding(h.len[Y], Y)} there's no fit, and you have no five-card suit of your own. Without a fit be cautious: pass.`, card } : null;
  const lv = levelFor(s), q = sqot(h, s), minPts = lv === 1 ? 6 : 8;
  if (lv > 2) return null;
  const okS = q >= lv + 6 && h.hcp >= minPts;
  if (!okS && cands.some((o) => o !== s && sqot(h, o) >= levelFor(o) + 6 && h.hcp >= (levelFor(o) === 1 ? 6 : 8))) return null;
  const count = `SQOT for ${SUIT_NAME[s]} (${suitList(h, s)}) is ${q}`;
  if (okS) return { answer: bid(lv, s), why: `No fit for partner (${shortHolding(h.len[Y], Y)}). A new suit needs SQOT and points: ${count}, enough for ${lv + 6} tricks, and you have ${h.hcp} points (${minPts}+ needed). Bid ${lv}${SYM[s]}.`, card };
  return passOk ? { answer: "P", why: `No fit for partner, and ${count}${q < lv + 6 ? `, short of the ${lv + 6} tricks needed` : `, but ${h.hcp} points is below the ${minPts} needed`}. Without a fit be cautious: pass.`, card } : null;
}

function genRespondOvercall(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const X = Math.floor(rand() * 4);
  const Y = pick(rand, [0, 1, 2, 3].filter((s) => s !== X));
  const pBid = bid(Y > X ? 1 : 2, Y);
  if (h.len[Y] > 5 || h.len[X] > 5) return null;
  let rho = "P";
  if (rand() < 0.4) {
    const zs = [0, 1, 2, 3].filter((z) => z !== X && z !== Y && bidRank(bid(2, z)) > bidRank(pBid));
    if (zs.length) rho = bid(2, pick(rand, zs));
  }
  if (rho !== "P" && h.len[parseBid(rho).strain] >= 5) return null;
  const r = responseToOvercall(h, X, pBid, rho);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  return { calls: [bid(1, X), pBid, rho], hand: h, ...r, tag: "Partner overcalled" };
}

/** Card 8 — partner overcalled 1NT (15–19). */
export function responseTo1NTOvercall(h, X) {
  if (h.hcp >= 15 || h.len[X] >= 5) return null;
  const card = "Card 8 · Responding to a 1NT overcall";
  const fives = [0, 1, 2, 3].filter((s) => s !== X && h.len[s] >= 5);
  if (h.hcp <= 7) {
    if (fives.length >= 2) return null;
    if (fives.length === 1) return { answer: bid(2, fives[0]), why: `0–7 points (${h.hcp}) with a five+ card suit: bid 2${SYM[fives[0]]} to play.`, card };
    return { answer: "P", why: `0–7 points (${h.hcp}) and no five-card suit: pass.`, card };
  }
  if (h.hcp <= 9) {
    if (!h.bal) return null; // unbalanced 8–9 "must choose"
    return { answer: "2N", why: `Balanced with 8–9 (${h.hcp}): bid 2NT.`, card };
  }
  const M = [2, 3].filter((s) => s !== X && h.len[s] >= 5);
  if (M.length === 2) return null;
  if (M.length === 1) {
    const s = M[0];
    return h.len[s] >= 6
      ? { answer: bid(4, s), why: `10+ points (${h.hcp}) with six+ ${SUIT_NAME[s]}: bid 4${SYM[s]}.`, card }
      : { answer: bid(3, s), why: `10+ points (${h.hcp}) with precisely five ${SUIT_NAME[s]}: bid 3${SYM[s]}.`, card };
  }
  return { answer: "3N", why: `10+ points (${h.hcp}) and no five-card major: bid 3NT.`, card };
}

function genRespond1NTOvercall(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  const X = Math.floor(rand() * 4);
  const r = responseTo1NTOvercall(h, X);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  return { calls: [bid(1, X), "1N", "P"], hand: h, ...r, tag: "Partner overcalled 1NT" };
}

// =============================================================================
// CARD-PLAY PROBLEMS (general principles, not the flip chart)
// Seats are relative to declarer d: d+1 is declarer's left, d+2 dummy, d+3 right.
// =============================================================================

/** Opening lead against no-trumps from the longest suit. */
export function ntLead(cards) { // cards high to low
  const [a, b, c] = cards;
  if (a >= 10 && a - b === 1 && b - c === 1) return { r: a, why: "top of a three-card sequence" };
  if (a >= 11 && a - b === 1) return null;                     // two touching honours, e.g. KQ8: styles differ
  if (b >= 10 && b - c === 1 && a >= 11) return null;          // interior sequence (KJ10, AQJ): styles differ
  return { r: cards[3], why: "fourth highest" };
}

function genLeadNT(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), you = (d + 1) % 4, h = hands[you];
  if (h.hcp > 11) return null;
  const order = [0, 1, 2, 3].sort((x, y) => h.len[y] - h.len[x]);
  const L = order[0];
  if (h.len[L] < 5 || h.len[order[1]] >= 5) return null;
  if (h.len[order[1]] === 4 && ntLead(h.suits[order[1]])?.why === "top of a three-card sequence") return null;
  const lead = ntLead(h.suits[L]);
  if (!lead) return null;
  const calls = ["1N", "P", "3N", "P", "P", "P"];
  const dealer = d;
  const ex = lead.why === "fourth highest"
    ? `Against no-trumps lead your longest suit, ${SUIT_NAME[L]} (${suitList(h, L)}), hoping to set up its long cards. With no three-card sequence at the top, lead the fourth highest: the ${rankStr(lead.r)}.`
    : `Against no-trumps lead your longest suit, ${SUIT_NAME[L]} (${suitList(h, L)}). With a three-card sequence at the top, lead the top of it: the ${rankStr(lead.r)}. It is safe and starts knocking out their stoppers.`;
  return {
    kind: "play", calls, dealer, you, declarer: d, hand: h, contract: `3NT by ${SEAT_NAME[d]}`,
    question: "You are on lead. Which card do you lead?",
    answers: [cardId(L, lead.r)], best: cardId(L, lead.r), why: ex,
    card: "Card 24 · Opening lead", tag: "Opening lead",
  };
}

/** Third hand high (lowest of touching honours). */
function genThirdHand(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), leader = (d + 1) % 4, dummy = (d + 2) % 4, you = (d + 3) % 4;
  const h = hands[you], dm = hands[dummy], pt = hands[leader];
  const L = pick(rand, [0, 1, 2, 3]);
  const mine = h.suits[L], dum = dm.suits[L], part = pt.suits[L];
  if (mine.length < 3 || mine[0] < 11 || !dum.length || dum[0] > 6 || part.length < 4) return null;
  const led = part[3];
  if (led > 8) return null;
  // Top card alone (Kxx) or touching honours (KQx): clear. Gapped honours (AQ, KJ): reject.
  let group = [mine[0]];
  for (let i = 1; i < mine.length && mine[i] === group[group.length - 1] - 1; i++) group.push(mine[i]);
  if (group.length === 1 && mine[1] >= 10) return null;
  if (group.length > 3 || group[group.length - 1] < 10) return null; // keep to textbook honour sequences
  const play = group[group.length - 1];
  const dPlay = dum[dum.length - 1];
  const why = group.length > 1
    ? `Partner has led a low card, so third hand plays high to win the trick or force out declarer's honour — but only as high as needed. Your ${group.map(rankStr).join(" ")} are equals, so play the lowest of them: the ${rankStr(play)}. That tells partner you may hold the higher ones too; playing the ${rankStr(group[0])} would tell partner you don't hold the ${rankStr(group[1])}.`
    : `Partner has led a low card and dummy has nothing that matters, so third hand plays high: the ${rankStr(play)}. Playing low would let declarer win cheaply.`;
  return {
    kind: "play", you, declarer: d, dealer: d, hand: h, dummyHand: dm, dummySeat: dummy,
    contract: `3NT by ${SEAT_NAME[d]}`,
    trick: [{ seat: leader, card: cardId(L, led) }, { seat: dummy, card: cardId(L, dPlay) }],
    question: `Partner led the ${cardText(L, led)}; dummy played the ${cardText(L, dPlay)}. Which card do you play?`,
    answers: [cardId(L, play)], best: cardId(L, play), why,
    card: "Card 25 · Defence (3rd player)", tag: "Defence", follow: L,
  };
}

/** Second hand low when declarer leads a small card. */
function genSecondHand(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), you = (d + 1) % 4, dummy = (d + 2) % 4;
  const h = hands[you], dm = hands[dummy], dec = hands[d];
  const L = pick(rand, [0, 1, 2, 3]);
  const mine = h.suits[L], dum = dm.suits[L], decl = dec.suits[L];
  const myHon = mine.filter((r) => r >= 12);
  if (myHon.length !== 1 || mine.filter((r) => r <= 9).length < 2 || mine.some((r) => r === 10 || r === 11)) return null;
  if (!dum.length || dum[0] < 11 || dum.length < 2) return null;
  if (!decl.length || decl[decl.length - 1] > 7) return null;
  const ledR = decl[decl.length - 1];
  const low = mine.filter((r) => r <= 9);
  return {
    kind: "play", you, declarer: d, dealer: d, hand: h, dummyHand: dm, dummySeat: dummy,
    contract: `3NT by ${SEAT_NAME[d]}`,
    trick: [{ seat: d, card: cardId(L, ledR) }],
    question: `Declarer leads the ${cardText(L, ledR)} from hand towards dummy. Which card do you play?`,
    answers: low.map((r) => cardId(L, r)), best: cardId(L, low[low.length - 1]),
    why: `Second hand low. Declarer is leading towards dummy's ${suitList(dm, L)} hoping you'll panic. Playing your ${rankStr(myHon[0])} now would let declarer play low from dummy (or win cheaply later) and give away a trick. Play low and keep your honour to beat one of dummy's: any small card is right, the ${rankStr(low[low.length - 1])} most naturally.`,
    card: "Card 25 · Defence (2nd player)", tag: "Defence", follow: L,
  };
}

/** Cover an honour with an honour. */
function genCover(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), dummy = (d + 2) % 4, you = (d + 3) % 4;
  const h = hands[you], dm = hands[dummy];
  const L = pick(rand, [0, 1, 2, 3]);
  const mine = h.suits[L], dum = dm.suits[L];
  if (dum.length < 2 || dum.length > 3) return null;
  const H = dum[0];
  if (H !== 12 && H !== 11) return null;
  if (dum[1] > 9) return null;                              // no touching honour in dummy
  const higher = mine.filter((r) => r > H);
  if (higher.length !== 1 || higher[0] === 14 || mine.length < 2 || mine.length > 4) return null;
  const c = higher[0];
  return {
    kind: "play", you, declarer: d, dealer: d, hand: h, dummyHand: dm, dummySeat: dummy,
    contract: `3NT by ${SEAT_NAME[d]}`,
    trick: [{ seat: dummy, card: cardId(L, H) }],
    question: `Declarer leads the ${cardText(L, H)} from dummy. Which card do you play?`,
    answers: [cardId(L, c)], best: cardId(L, c),
    why: `Cover an honour with an honour. If you play low, the ${rankStr(H)} may win, or run round to declarer's higher card cheaply. Covering with the ${rankStr(c)} makes declarer spend two honours to win one trick, which can promote a lower card in your or partner's hand. Dummy has no second honour touching the ${rankStr(H)}, so cover now.`,
    card: "Card 25 · Defence (cover an honour)", tag: "Defence", follow: L,
  };
}

// =============================================================================
// MORE BIDDING (second batch of flip-chart cards)
// =============================================================================

/** Deal until a hand passes `ok` (strong hands are rare, so try a few times). */
function dealUntil(rand, ok, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const h = makeHand(shuffledDeck(rand).slice(0, 13));
    if (ok(h)) return h;
  }
  return null;
}

/** Conventions p1 — opener after partner's raise, with Losing Trick Count.
 *  UFO: Unbalanced, Fit (four+ cards), Openers. Partner assumed you had 7
 *  losers; for each one fewer, bid one level higher. */
export function openerAfterRaise(h, M, raise) {
  if (h.bal) return null; // LTC only when unbalanced; balanced openers bid on points
  const L = losers(h), lv = parseBid(raise).level;
  const extra = 7 - L, target = lv + Math.max(0, extra);
  if (target > 4) return null; // slam territory
  const count = `Losing Trick Count: you have ${L} losers`;
  const why = extra <= 0
    ? `${count}. Partner's raise assumed you had 7; you have no fewer, so stop: pass.`
    : `${count}, ${extra === 1 ? "one fewer loser" : `${["", "", "two", "three"][extra]} fewer losers`} than the 7 partner assumed, so bid ${extra === 1 ? "one level" : `${["", "", "two", "three"][extra]} levels`} higher: ${target}${SYM[M]}.`;
  return { answer: extra <= 0 ? "P" : bid(target, M), why: `UFO applies (unbalanced, a four+ card fit, you opened). ${why}`, card: "Conventions p1 · Losing Trick Count" };
}

function genOpenerAfterRaise(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const o = openingBidFor(h);
  if (!o || !["1H", "1S"].includes(o.answer)) return null;
  const M = parseBid(o.answer).strain;
  const raise = h.len[M] >= 5 && rand() < 0.5 ? bid(2, M) : bid(3, M);
  const r = openerAfterRaise(h, M, raise);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.4) return null;
  const calls = rand() < 0.5 ? [o.answer, "P", raise, "P"] : ["P", o.answer, "P", raise, "P"];
  return { calls, hand: h, ...r, tag: "Losing Trick Count" };
}

/** Page 10 / card 21 — responder's second bid after a transfer or Stayman. */
export function responderSecondBid(h, first, reply) {
  const cardT = "Conventions p10 · Transfers", cardS = "Card 21 · Stayman";
  if (first === "2D" || first === "2H") {
    const M = parseBid(first).strain + 1, other = M === 2 ? 3 : 2;
    if (h.hcp <= 10) return { answer: "P", why: `Weak (${h.hcp}): passing the completed transfer is the equivalent of a weakness take-out.`, card: cardT };
    if (h.len[M] >= 6) {
      if (h.hcp <= 12) return { answer: bid(3, M), why: `Six+ ${SUIT_NAME[M]} and 11–12 (${h.hcp}): 3${SYM[M]}, invitational.`, card: cardT };
      return { answer: bid(4, M), why: `Six+ ${SUIT_NAME[M]} and enough for game (${h.hcp}): 4${SYM[M]}, to play.`, card: cardT };
    }
    if (M === 2 && h.len[3] === 4) return { answer: "2S", why: `Five hearts, four spades and 11+ (${h.hcp}): bid 2♠, forcing for one round.`, card: cardT };
    if (h.len[other] >= 4) return null;
    const m4 = [0, 1].filter((s) => h.len[s] >= 4);
    if (m4.length > 1) return null;
    if (m4.length === 1) {
      if (h.hcp <= 12) return null; // invitational with a side minor: not settled by the page
      return { answer: bid(3, m4[0]), why: `Five ${SUIT_NAME[M]}, four ${SUIT_NAME[m4[0]]} and 13+ (${h.hcp}): bid 3${SYM[m4[0]]}, forcing.`, card: cardT };
    }
    if (!h.bal) return null;
    if (h.hcp <= 12) return { answer: "2N", why: `Five ${SUIT_NAME[M]}, balanced, 11–12 (${h.hcp}): 2NT, invitational. Partner chooses between pass, 3${SYM[M]}, 3NT and 4${SYM[M]}.`, card: cardT };
    return { answer: "3N", why: `Five ${SUIT_NAME[M]}, balanced, game values (${h.hcp}): 3NT, giving partner a choice between 3NT and 4${SYM[M]}.`, card: cardT };
  }
  if (first === "2S") {
    const m = h.len[0] >= 6 ? 0 : 1;
    return { answer: m === 0 ? "P" : "3D", why: m === 0 ? "Your long minor is clubs, so pass 3♣." : "Your long minor is diamonds, so correct to 3♦; partner must pass.", card: cardT };
  }
  // Stayman
  if (h.hcp <= 10) {
    const M = h.len[2] >= 5 ? 2 : 3;
    if (reply === "2D") return { answer: bid(2, M), why: `Weak Stayman: no major fit shown, so bid your five-card major, 2${SYM[M]}, to play.`, card: cardS };
    return { answer: "P", why: `Weak Stayman: partner's ${bidText(reply)} hits one of your majors, so pass.`, card: cardS };
  }
  const fitM = reply === "2H" && h.len[2] >= 4 ? 2 : reply === "2S" && h.len[3] >= 4 ? 3 : null;
  if (fitM !== null) {
    if (h.hcp <= 12) return null; // invitational raise: not on the card
    return { answer: bid(4, fitM), why: `Partner's ${bidText(reply)} finds your four-card fit, and you have game values (${h.hcp}): 4${SYM[fitM]}.`, card: cardS };
  }
  return h.hcp <= 12
    ? { answer: "2N", why: `No major fit yet; with 11–12 (${h.hcp}) bid 2NT, inviting. ${reply === "2H" ? "If partner also has four spades they can bid them." : ""}`.trim(), card: cardS }
    : { answer: "3N", why: `No major fit yet; with game values (${h.hcp}) bid 3NT.${reply === "2H" ? " If partner also has four spades they can correct to 4♠." : ""}`, card: cardS };
}

function genResponderSecond(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const r1 = responseTo1NT(h);
  if (!r1 || !["2C", "2D", "2H", "2S"].includes(r1.answer)) return null;
  const first = r1.answer;
  const reply = first === "2C" ? pick(rand, ["2D", "2H", "2S"]) : first === "2S" ? "3C" : bid(2, parseBid(first).strain + 1);
  if (first === "2C" && h.hcp <= 10 && reply === "2D" && rand() < 0.3) return null;
  const r = responderSecondBid(h, first, reply);
  if (!r) return null;
  const calls = rand() < 0.5 ? ["1N", "P", first, "P", reply, "P"] : ["P", "1N", "P", first, "P", reply, "P"];
  return { calls, hand: h, ...r, tag: first === "2C" ? "Stayman" : "Transfers" };
}

/** Page 10 — opener's third bid after 1NT–transfer–completion–2NT/3NT/3M. */
export function openerAfterTransferCont(h, M, cont) {
  const cardT = "Conventions p10 · Transfers";
  const three = h.len[M] >= 3;
  if (cont === "3N") return { answer: three ? bid(4, M) : "P", why: `Partner's 3NT shows five ${SUIT_NAME[M]}, balanced, giving a choice of games. ${three ? `You have three+ ${SUIT_NAME[M]} (${suitList(h, M)}): bid 4${SYM[M]}.` : `You have only two (${suitList(h, M)}): pass 3NT.`}`, card: cardT };
  if (h.hcp === 13) return null; // min or max: judgement
  const max = h.hcp === 14;
  if (cont === "2N") {
    const answer = max ? (three ? bid(4, M) : "3N") : (three ? bid(3, M) : "P");
    return { answer, why: `Partner's 2NT shows five ${SUIT_NAME[M]}, balanced, 11–12: invitational. You have a ${max ? "maximum" : "minimum"} (${h.hcp}) and ${three ? "three+" : "two"} ${SUIT_NAME[M]}, so ${bidText(answer) === "Pass" ? "pass" : "bid " + bidText(answer)}.`, card: cardT };
  }
  return { answer: max ? bid(4, M) : "P", why: `Partner's 3${SYM[M]} shows six+ ${SUIT_NAME[M]}, invitational. With a ${max ? "maximum (14), accept: 4" + SYM[M] : "minimum (12), decline: pass"}.`, card: cardT };
}

function genOpenerTransferCont(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  if (!h.bal || h.hcp < 12 || h.hcp > 14) return null;
  const M = pick(rand, [2, 3]);
  if (h.len[M] >= 4) return null; // you'd have considered the jump
  const cont = pick(rand, ["2N", "2N", "3N", bid(3, M)]);
  const r = openerAfterTransferCont(h, M, cont);
  if (!r) return null;
  const t = bid(2, M - 1), done = bid(2, M);
  const calls = ["1N", "P", t, "P", done, "P", cont, "P"];
  return { calls, hand: h, ...r, tag: "Transfers" };
}

/** Card 11 — partner doubled their 1X for take-out; RHO passed. */
export function respondTakeout(h, X) {
  if (h.len[X] >= 5 || h.hcp > 15) return null;
  const cands = [0, 1, 2, 3].filter((s) => s !== X);
  const m = Math.max(...cands.map((s) => h.len[s]));
  const tied = cands.filter((s) => h.len[s] === m);
  if (tied.length > 1) return null;
  const s = tied[0], base = s > X ? 1 : 2;
  const card = "Card 11 · Responding to a take-out double";
  if (h.hcp <= 8) return { answer: bid(base, s), why: `You must respond. 0–8 points (${h.hcp}): bid your longest other suit, ${SUIT_NAME[s]}, at the lowest level: ${base}${SYM[s]}.`, card };
  if (h.hcp <= 12) return { answer: bid(base + 1, s), why: `9–12 points (${h.hcp}): bid your longest other suit, ${SUIT_NAME[s]}, with a jump: ${base + 1}${SYM[s]}.`, card };
  if (s < 2) return null; // game in a minor: unclear (3NT?)
  return { answer: bid(4, s), why: `13+ points (${h.hcp}): bid your longest other suit at game level: 4${SYM[s]}.`, card };
}

function genRespondTakeout(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const X = Math.floor(rand() * 4);
  const r = respondTakeout(h, X);
  if (!r) return null;
  return { calls: [bid(1, X), "X", "P"], hand: h, ...r, tag: "Partner doubled" };
}

/** Card 12 — right-hand opponent opens 1NT; or partner has doubled their 1NT. */
export function vs1NT(h) {
  const card12 = "Card 12 · Penalty double of 1NT";
  if (h.hcp >= 16) return { answer: "X", why: `16+ points (${h.hcp}), any shape: double 1NT for penalties.`, card: card12 };
  const fives = [0, 1, 2, 3].filter((s) => h.len[s] >= 5 && sqot(h, s) >= 8);
  if (fives.length > 1) return null;
  if (fives.length === 1 && h.hcp >= 8) {
    const s = fives[0];
    return { answer: bid(2, s), why: `Not enough to double (you need 16+), but SQOT for ${SUIT_NAME[s]} (${suitList(h, s)}) is ${sqot(h, s)}, enough for eight tricks, with ${h.hcp} points: overcall 2${SYM[s]}.`, card: "Card 9 · Overcalling suits (SQOT)" };
  }
  if ([0, 1, 2, 3].some((s) => h.len[s] >= 5) && h.hcp >= 8) return null; // a five-card suit that fails SQOT: judgement
  return { answer: "P", why: `${h.hcp} points: a double of 1NT needs 16+, and you have no suit good enough to overcall. Pass.`, card: card12 };
}
function genVs1NT(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const r = vs1NT(h);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  return { calls: rand() < 0.5 ? ["1N"] : ["P", "1N"], hand: h, ...r, tag: "They opened 1NT" };
}

export function afterPartnerDoubles1NT(h) {
  const card = "Card 12 · Penalty double of 1NT";
  const longs = [0, 1, 2, 3].filter((s) => h.len[s] >= 5);
  if (h.hcp <= 3 && longs.length === 1) return { answer: bid(2, longs[0]), why: `Partner's double is for penalties. You're very weak (${h.hcp}) with a long suit, so take out into 2${SYM[longs[0]]}.`, card };
  if (h.hcp >= 5) return { answer: "P", why: `Partner's double is for penalties (16+). With ${h.hcp} points, pass and defend — you're not "very weak with a long suit".`, card };
  return null;
}
function genAfterPartnerDoubles1NT(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  if (h.hcp > 9) return null;
  const r = afterPartnerDoubles1NT(h);
  if (!r) return null;
  return { calls: ["1N", "X", "P"], hand: h, ...r, tag: "Partner doubled 1NT" };
}

/** Cards 3 and 12 — partner opened 1X, RHO overcalled Y. */
export function overOvercall(h, X, ovc) {
  const Y = parseBid(ovc).strain, lv = parseBid(ovc).level;
  if (h.len[X] >= 4) {
    if (X < 2) return null;
    const sp = h.hcp + shortagePoints(h, X);
    if (sp >= 16) return null;
    const t = sp <= 5 ? 0 : sp <= 9 ? 2 : sp <= 12 ? 3 : 4;
    if (t && bidRank(bid(t, X)) <= bidRank(ovc)) return null;
    return { answer: t ? bid(t, X) : "P", why: `Support first: four+ ${SUIT_NAME[X]}, ${sp} points${sp > h.hcp ? " counting shortage" : ""}. Support line: 0–5 pass, 6–9 two, 10–12 three, 13+ four.`, card: "Card 3 · Responding with support" };
  }
  const need = 8 - lv; // tricks to beat their contract
  const count = h.len[Y] + honours(h, Y);
  if (h.len[X] <= 2 && h.hcp >= 9 && h.len[Y] >= 4 && count >= need) {
    return { answer: "X", why: `Penalty double: 9+ points (${h.hcp}), no fit for partner, and good trumps — ${SUIT_NAME[Y]} ${suitList(h, Y)}: ${h.len[Y]} cards + ${plural(honours(h, Y), "honour")} = ${count}, at least the ${need} tricks needed to beat ${bidText(ovc)}.`, card: "Card 12 · Penalty double of an overcall" };
  }
  if (h.hcp <= 5 && h.len[X] <= 2) return { answer: "P", why: `${h.hcp} points and no fit for partner: pass.`, card: "Card 4 · Responding without support" };
  return null;
}
function genOverOvercall(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const X = Math.floor(rand() * 4);
  const Y = pick(rand, [0, 1, 2, 3].filter((s) => s !== X));
  const ovc = bid(Y > X ? 1 : 2, Y);
  const r = overOvercall(h, X, ovc);
  if (!r) return null;
  if (r.answer === "P" && rand() < 0.6) return null;
  return { calls: rand() < 0.5 ? [bid(1, X), ovc] : ["P", bid(1, X), ovc], hand: h, ...r, tag: "They overcalled" };
}

/** Card 17 — partner opened 2♣. */
export function respond2C(h) {
  if (h.hcp > 15) return null;
  const card = "Card 17 · Responding to 2♣";
  if (h.hcp <= 7) return { answer: "2D", why: `0–7 points (${h.hcp}): the negative 2♦.`, card };
  const fives = [0, 1, 2, 3].filter((s) => h.len[s] >= 5);
  if (fives.length > 1) return null;
  if (fives.length === 1) {
    const s = fives[0], b = s >= 2 ? bid(2, s) : bid(3, s);
    return { answer: b, why: `A positive (8+, you have ${h.hcp}) with a five+ card suit: bid it, ${bidText(b)}${s === 1 ? " (3♦, since 2♦ would be the negative)" : ""}.`, card };
  }
  return { answer: "2N", why: `A positive (8+, you have ${h.hcp}) with no five-card suit: 2NT.`, card };
}
function genRespond2C(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const r = respond2C(h);
  if (!r) return null;
  if (r.answer === "2D" && rand() < 0.5) return null;
  return { calls: rand() < 0.5 ? ["2C", "P"] : ["P", "2C", "P"], hand: h, ...r, tag: "Partner opened 2♣" };
}
function genOpener2C(rand) {
  const h = dealUntil(rand, (x) => x.hcp >= 23 && x.hcp <= 27, 400);
  if (!h) return null;
  let answer, why;
  if (h.bal) {
    answer = h.hcp <= 24 ? "2N" : "3N";
    why = `Balanced with ${h.hcp}: after 2♣–2♦, ${h.hcp <= 24 ? "23–24 rebids 2NT (the one sequence partner may pass)" : "25+ rebids 3NT"}.`;
  } else {
    const m = Math.max(...h.len), longS = [0, 1, 2, 3].filter((s) => h.len[s] === m);
    if (m < 5 || longS.length > 1) return null;
    const s = longS[0];
    answer = s >= 2 ? bid(2, s) : bid(3, s);
    why = `Unbalanced: after 2♣–2♦, rebid your longest suit (five+), ${SUIT_NAME[s]}: ${bidText(answer)}. The auction is forcing to game.`;
  }
  return { calls: rand() < 0.5 ? ["2C", "P", "2D", "P"] : ["P", "2C", "P", "2D", "P"], hand: h, answer, why, card: "Card 17 · 2♣ opening", tag: "Your 2♣ opening" };
}

/** Card 19 + page 10 — partner opened 2NT (20–22), transfers on. */
export function respond2NT(h) {
  if (h.hcp >= 16) return null;
  const card = "Card 19 · Responding to 2NT", cardT = "Conventions p10 · Transfers over 2NT";
  const M5 = [2, 3].filter((s) => h.len[s] >= 5), M4 = [2, 3].filter((s) => h.len[s] === 4);
  if (M5.length === 2) return null;
  if (M5.length === 1) {
    const M = M5[0];
    if (M4.length || h.hcp <= 3 || h.hcp >= 12) return null;
    const t = bid(3, M - 1);
    return { answer: t, why: `Five+ ${SUIT_NAME[M]} and 4+ points: transfer with ${bidText(t)} (the suit below). Any bid over 2NT is forcing to game.`, card: cardT };
  }
  const six = [0, 1].filter((s) => h.len[s] >= 6);
  if (six.length === 1 && h.hcp >= 12) return { answer: bid(6, six[0]), why: `12+ points (${h.hcp}) with six+ ${SUIT_NAME[six[0]]}: bid the small slam, 6${SYM[six[0]]}.`, card };
  if (six.length && h.hcp >= 4) return null;
  if (h.hcp <= 3) return { answer: "P", why: `0–3 points (${h.hcp}) and no six-card major: pass.`, card };
  if (M4.length) {
    if (h.hcp >= 11) return null;
    return { answer: "3C", why: `4+ points (${h.hcp}) and precisely four ${SUIT_NAME[M4[M4.length - 1]]}${M4.length > 1 ? " and hearts" : ""}: Stayman, 3♣.`, card };
  }
  if (h.hcp <= 10) return { answer: "3N", why: `4–10 points (${h.hcp}) and no five-card major: 3NT.`, card };
  if (h.hcp <= 12) return h.bal ? { answer: "4N", why: `11–12 balanced (${h.hcp}): 4NT, a quantitative slam invite (no suit agreed, so it isn't Blackwood).`, card } : null;
  return { answer: "6N", why: `13+ points (${h.hcp}) and no six-card suit: 6NT (33+ between you).`, card };
}
function genRespond2NT(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const r = respond2NT(h);
  if (!r) return null;
  if (r.answer === "3N" && rand() < 0.4) return null;
  return { calls: rand() < 0.5 ? ["2N", "P"] : ["P", "2N", "P"], hand: h, ...r, tag: "Partner opened 2NT" };
}
function genOpener2NT(rand) {
  const h = dealUntil(rand, (x) => x.bal && x.hcp >= 20 && x.hcp <= 22, 400);
  if (!h) return null;
  const resp = pick(rand, ["3C", "3C", "3D", "3H", "4N"]);
  let answer, why, card = "Card 19 · 2NT opening";
  if (resp === "3C") {
    answer = h.len[2] >= 4 ? "3H" : h.len[3] >= 4 ? "3S" : "3D";
    why = `Partner's 3♣ is Stayman. ${answer === "3D" ? "No four-card major: 3♦." : `Four ${answer === "3H" ? "hearts" : "spades"}: ${bidText(answer)}${answer === "3H" && h.len[3] >= 4 ? " (with both majors, hearts first)" : ""}.`}`;
  } else if (resp === "3D" || resp === "3H") {
    const M = parseBid(resp).strain + 1;
    answer = bid(3, M); card = "Conventions p10 · Transfers over 2NT";
    why = `Partner's ${bidText(resp)} is a transfer showing five+ ${SUIT_NAME[M]}: complete it, ${bidText(answer)}.`;
  } else {
    if (h.hcp === 21) return null;
    answer = h.hcp === 22 ? "6N" : "P";
    why = `Partner's 4NT is quantitative (11–12, balanced). With a ${h.hcp === 22 ? "maximum (22) bid 6NT" : "minimum (20) pass"}.`;
  }
  return { calls: rand() < 0.5 ? ["2N", "P", resp, "P"] : ["P", "2N", "P", resp, "P"], hand: h, answer, why, card, tag: "Your 2NT opening" };
}

/** Cards 22, 23 — partner pre-empted. "Put up or shut up". */
export function respondPreempt(h, s, level) {
  const card = level === 2 ? "Card 22 · Responding to a weak two" : "Card 23 · Responding to a three-opener";
  const pLen = level === 2 ? 6 : 7, fit = h.len[s] + pLen;
  const a = acesIn(h);
  let strong;
  if (h.hcp <= 13) strong = false;
  else if (h.hcp <= 15) { if (a > 0) return null; strong = false; }       // upgrade for aces: unclear
  else if (h.hcp <= 17) { if (a === 0) return null; strong = true; }      // downgrade for quacks: unclear
  else strong = true;
  if (strong) {
    if (h.len[s] < 2 || s < 2) return null;
    return { answer: bid(4, s), why: `About 16+ (${h.hcp}, with ${plural(a, "ace")}) and a fit (${h.len[s]} ${SUIT_NAME[s]}): put up — bid game, 4${SYM[s]}.`, card };
  }
  if (fit >= 11) return null;
  const lof = fit - 6;
  const ans = lof > level ? bid(lof, s) : "P";
  return { answer: ans, why: `Under about 16 (${h.hcp}${h.hcp >= 14 ? ", and no aces to upgrade" : ""}): shut up, or raise to the level of the fit. You have ${h.len[s] <= 1 ? shortHolding(h.len[s], s) : `${h.len[s]} ${SUIT_NAME[s]}`}, partner ${pLen}, so ${fit} between you: ${lof > level ? `bid for ${fit} tricks, ${lof}${SYM[s]}` : "no higher than partner's bid — pass"}.`, card };
}
function genRespondPreempt(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const level = rand() < 0.55 ? 2 : 3;
  const s = level === 2 ? pick(rand, [1, 2, 3]) : pick(rand, [0, 1, 2, 3]);
  if (h.len[s] > 13 - (level === 2 ? 6 : 7)) return null;
  const r = respondPreempt(h, s, level);
  if (!r) return null;
  const open = bid(level, s);
  return { calls: rand() < 0.5 ? [open, "P"] : ["P", open, "P"], hand: h, ...r, tag: level === 2 ? "Partner's weak two" : "Partner pre-empted" };
}

/** Card 20 — Blackwood. */
const BW = ["5C", "5D", "5H", "5S"];
function genBlackwoodReply(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const M = pick(rand, [2, 3]);
  const r = responseToSuit(h, M);
  if (!r || r.answer !== bid(3, M)) return null;
  const a = acesIn(h);
  const answer = BW[a % 4];
  return {
    calls: ["P", bid(1, M), "P", bid(3, M), "P", "4N", "P"].slice(rand() < 0.5 ? 1 : 0), hand: h, answer,
    why: `A suit has been agreed (${SUIT_NAME[M]}), so partner's 4NT is Blackwood, asking for aces. You have ${plural(a, "ace")}: ${bidText(answer)} (5♣ none or four, 5♦ one, 5♥ two, 5♠ three).`,
    card: "Card 20 · Blackwood", tag: "Blackwood",
  };
}
function genBlackwoodAsker(rand) {
  const h = makeHand(shuffledDeck(rand).slice(0, 13));
  const o = openingBidFor(h);
  if (!o || !["1H", "1S"].includes(o.answer) || h.bal || h.hcp < 15) return null;
  const M = parseBid(o.answer).strain, mine = acesIn(h);
  if (mine < 1) return null;
  const lo = Math.max(0, 2 - mine), hi = Math.min(2, 4 - mine);
  if (lo > hi) return null;
  const p = lo + Math.floor(rand() * (hi - lo + 1));
  const reply = BW[p], total = mine + p;
  let answer;
  if (total >= 3) answer = bid(6, M);
  else if (reply === bid(5, M)) answer = "P";
  else if (bidRank(bid(5, M)) > bidRank(reply)) answer = bid(5, M);
  else return null;
  const calls = [o.answer, "P", bid(3, M), "P", "4N", "P", reply, "P"];
  return {
    calls: rand() < 0.5 ? calls : ["P", ...calls], hand: h, answer,
    why: `Partner's ${bidText(reply)} shows ${plural(p, "ace")}; you have ${mine}, so ${total} between you. ${total >= 3 ? `Three or four aces: bid six, 6${SYM[M]}.` : `Only two: sign off in five${answer === "P" ? ` — partner's reply already is 5${SYM[M]}, so pass` : `, 5${SYM[M]}`}.`}`,
    card: "Card 20 · Blackwood", tag: "Blackwood",
  };
}

// =============================================================================
// MORE CARD PLAY (cards 14, 15, 24, 25)
// =============================================================================

/** Card 24 — opening lead against a suit contract (partner hasn't bid). */
export function suitLead(h, T) {
  const side = [0, 1, 2, 3].filter((s) => s !== T);
  const ak = side.filter((s) => h.suits[s][0] === 14 && h.suits[s][1] === 13);
  if (ak.length > 1) return null;
  if (ak.length === 1) return { s: ak[0], r: 14, why: `Top of the list against a suit contract is A-K: lead the ace from ${suitList(h, ak[0])} (you keep the lead while you look at dummy).` };
  const singles = side.filter((s) => h.len[s] === 1);
  if (singles.length > 1) return null;
  if (singles.length === 1) return { s: singles[0], r: h.suits[singles[0]][0], why: `No A-K, so the next best lead is a singleton: the ${cardText(singles[0], h.suits[singles[0]][0])}, hoping to ruff.` };
  const seq = side.filter((s) => h.len[s] >= 2 && h.suits[s][0] >= 10 && h.suits[s][0] <= 13 && h.suits[s][0] - h.suits[s][1] === 1);
  if (seq.length !== 1) return null;
  const s = seq[0], top = h.suits[s][0];
  return { s, r: top, why: `No A-K and no singleton, so lead from touching honours (${suitList(h, s)}): the higher one, the ${rankStr(top)}.` };
}
function genLeadSuit(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), you = (d + 1) % 4, h = hands[you];
  const T = pick(rand, [2, 3]);
  if (h.len[T] > 3 || h.hcp > 12) return null;
  const L = suitLead(h, T);
  if (!L) return null;
  const calls = [bid(1, T), "P", bid(3, T), "P", bid(4, T), "P", "P", "P"];
  return {
    kind: "play", calls, dealer: d, you, declarer: d, hand: h, contract: `4${SYM[T]} by ${SEAT_NAME[d]}`,
    question: "You are on lead against a suit contract. Which card do you lead?",
    answers: [cardId(L.s, L.r)], best: cardId(L.s, L.r), why: `${L.why} (Trumps — the opponents' suit — are a bad lead.)`,
    card: "Card 24 · Opening lead", tag: "Opening lead",
  };
}

/** Card 25 — fourth hand: win as cheaply as possible, or play your lowest. */
function genFourthHand(rand) {
  const hands = dealFour(rand);
  const d = Math.floor(rand() * 4), dummy = (d + 2) % 4, partner = (d + 3) % 4, you = (d + 1) % 4;
  const L = pick(rand, [0, 1, 2, 3]);
  const mine = hands[you].suits[L], dum = hands[dummy].suits[L], part = hands[partner].suits[L], dec = hands[d].suits[L];
  if (mine.length < 2 || !dum.length || !part.length || !dec.length) return null;
  const c1 = dum[dum.length - 1], c2 = part[part.length - 1], c3 = dec[0];
  const win = Math.max(c1, c2, c3);
  if (win === c2) return null; // partner already winning: a different question
  const over = mine.filter((r) => r > win);
  const ans = over.length ? over[over.length - 1] : mine[mine.length - 1];
  return {
    kind: "play", you, declarer: d, dealer: d, hand: hands[you], dummyHand: hands[dummy], dummySeat: dummy,
    contract: `3NT by ${SEAT_NAME[d]}`,
    trick: [{ seat: dummy, card: cardId(L, c1) }, { seat: partner, card: cardId(L, c2) }, { seat: d, card: cardId(L, c3) }],
    question: `Dummy led the ${cardText(L, c1)}, partner played the ${cardText(L, c2)}, declarer the ${cardText(L, c3)}. Which card do you play?`,
    answers: [cardId(L, ans)], best: cardId(L, ans),
    why: over.length ? `Fourth hand: win as cheaply as possible. The ${rankStr(ans)} is your lowest card that beats declarer's ${rankStr(c3)}.` : `Fourth hand: you can't beat the ${rankStr(win)}, so play your lowest card, the ${rankStr(ans)}.`,
    card: "Card 25 · Defence (4th player)", tag: "Defence", follow: L,
  };
}

/** Cards 14, 15 — declarer: which card first in this suit? Built from
 *  templates, since a random deal rarely gives a clean example. */
function smalls(rand, n, used) {
  const out = [];
  for (let tries = 0; out.length < n && tries < 100; tries++) {
    const r = 2 + Math.floor(rand() * 7); // 2..8
    if (!used.has(r)) { used.add(r); out.push(r); }
  }
  return out.length === n ? out : null;
}
function genSuitPlay(rand) {
  const s = Math.floor(rand() * 4);
  const kind = pick(rand, ["top", "top", "K", "AQ", "AKJ", "trumpAQ"]);
  const used = new Set();
  let a, b, answers, best, why, card = "Card 14 · Making tricks without trumps", trumps = false;
  // a and b are the two hands' cards in the suit; b gets displayed as yours or dummy's at random.
  if (kind === "top") {
    const run = pick(rand, [[14, 13, 12], [14, 13, 12, 11], [13, 12, 11], [12, 11, 10]]);
    run.forEach((r) => used.add(r));
    const k = 1 + Math.floor(rand() * (run.length - 1));
    const short = run.slice(0).sort(() => rand() - 0.5).slice(0, k).sort((x, y) => y - x);
    const long = run.filter((r) => !short.includes(r));
    const sx = smalls(rand, Math.floor(rand() * 2), used), lx = smalls(rand, short.length + (sx ? sx.length : 0) - long.length + 1 + Math.floor(rand() * 2), used);
    if (!sx || !lx) return null;
    a = [...short, ...sx].sort((x, y) => y - x); b = [...long, ...lx].sort((x, y) => y - x);
    if (a.length >= b.length) return null;
    if (run[0] !== 14) return null; // missing the ace: that's a "force", not top tricks
    trumps = run.length === 3 && b.length >= 5 && rand() < 0.5;
    best = `A:${a[0]}`; answers = [best];
    why = `With sequential top cards between the two hands, lead the Highest card from the sHorter length first — the ${rankStr(a[0])} — so the long hand isn't blocked.`;
    if (trumps) { card = "Card 15 · Drawing trumps"; why = `Drawing trumps with sequential top cards: play the highest card from the shorter length first, the ${rankStr(a[0])}.`; }
  } else if (kind === "K" || kind === "AQ") {
    const top = kind === "K" ? [13] : [14, 12];
    top.forEach((r) => used.add(r)); used.add(11); used.add(10);
    const ax = smalls(rand, Math.floor(rand() * 2), used), bx = smalls(rand, 2 + Math.floor(rand() * 2), used);
    if (!ax || !bx) return null;
    a = [...top, ...ax].sort((x, y) => y - x); b = bx.sort((x, y) => y - x);
    answers = b.map((r) => `B:${r}`); best = `B:${b[b.length - 1]}`;
    why = kind === "K"
      ? `Finesse: lead from the opposite hand towards the card you're trying to promote. Lead low from ${b.map(rankStr).join(" ")} towards the K, hoping the second player has the ace.`
      : `Finesse: lead low from ${b.map(rankStr).join(" ")} towards the A-Q, and play the queen if the second player plays low — hoping they hold the king.`;
  } else if (kind === "AKJ") {
    [14, 13, 11, 12].forEach((r) => used.add(r)); used.add(10);
    const ax = smalls(rand, 2, used), bx = smalls(rand, 1, used);
    if (!ax || !bx) return null;
    a = [14, 13, ...ax].sort((x, y) => y - x); b = [11, ...bx];
    answers = ax.map((r) => `A:${r}`); best = `A:${Math.min(...ax)}`;
    why = `Finesse for the queen: lead low from ${a.map(rankStr).join(" ")} towards the J, hoping the second player holds the queen.`;
  } else {
    [14, 12, 13, 11, 10].forEach((r) => used.add(r));
    const ax = smalls(rand, 1, used), bx = smalls(rand, 5 + Math.floor(rand() * 2), used);
    if (!ax || !bx) return null;
    a = [14, 12, ...ax].sort((x, y) => y - x); b = bx.sort((x, y) => y - x);
    trumps = true; card = "Card 15 · Drawing trumps";
    answers = b.map((r) => `B:${r}`); best = `B:${b[b.length - 1]}`;
    why = `The top trumps aren't sequential (the king is missing), so lead from the opposite hand towards the card you're trying to promote: low from ${b.map(rankStr).join(" ")} to the queen, hoping the king is with the second player. Then cash the ace.`;
  }
  const youHaveA = rand() < 0.5;
  return {
    kind: "suit", suit: s, trumps,
    contract: trumps ? `4${SYM[s]} by South` : `3NT by South`,
    dummyCards: youHaveA ? b : a, youCards: youHaveA ? a : b,
    // answers refer to "A" / "B" hands; translate to who holds them
    answers: answers.map((x) => tr(x, youHaveA)), best: tr(best, youHaveA), why, card, tag: "Declarer play",
    question: trumps ? `${SUIT_NAME[s][0].toUpperCase() + SUIT_NAME[s].slice(1)} are trumps. Which card do you play first?` : `How do you play ${SUIT_NAME[s]}? Which card do you play first?`,
    you: 2, declarer: 2, dummySeat: 0,
  };
}
function tr(x, youHaveA) {
  const [hand, r] = x.split(":");
  const who = (hand === "A") === youHaveA ? "Y" : "D";
  return `${who}:${r}`;
}

// =============================================================================
// Problem factory
// =============================================================================
export const TYPES = [
  { key: "open", kind: "bid", w: 3, make: genOpening },
  { key: "respond", kind: "bid", w: 3, make: genRespondSuit },
  { key: "rebid1nt", kind: "bid", w: 2, make: genOpenerAfter1NT },
  { key: "resp1nt", kind: "bid", w: 2, make: genRespond1NT },
  { key: "resp2nd", kind: "bid", w: 2, make: genResponderSecond },
  { key: "transfer3", kind: "bid", w: 1, make: genOpenerTransferCont },
  { key: "ltc", kind: "bid", w: 2.5, make: genOpenerAfterRaise },
  { key: "overcall", kind: "bid", w: 2.5, make: genOvercall },
  { key: "respovercall", kind: "bid", w: 1.5, make: genRespondOvercall },
  { key: "resp1ntovercall", kind: "bid", w: 1, make: genRespond1NTOvercall },
  { key: "takeout", kind: "bid", w: 1.5, make: genRespondTakeout },
  { key: "vs1nt", kind: "bid", w: 1, make: genVs1NT },
  { key: "pdbl1nt", kind: "bid", w: 0.5, make: genAfterPartnerDoubles1NT },
  { key: "overovc", kind: "bid", w: 1.5, make: genOverOvercall },
  { key: "resp2c", kind: "bid", w: 1, make: genRespond2C },
  { key: "open2c", kind: "bid", w: 0.7, make: genOpener2C },
  { key: "resp2nt", kind: "bid", w: 1, make: genRespond2NT },
  { key: "open2nt", kind: "bid", w: 0.7, make: genOpener2NT },
  { key: "preempt", kind: "bid", w: 1.5, make: genRespondPreempt },
  { key: "bwreply", kind: "bid", w: 0.7, make: genBlackwoodReply },
  { key: "bwask", kind: "bid", w: 0.7, make: genBlackwoodAsker },
  { key: "leadnt", kind: "play", w: 1.5, make: genLeadNT },
  { key: "leadsuit", kind: "play", w: 1.5, make: genLeadSuit },
  { key: "third", kind: "play", w: 1, make: genThirdHand },
  { key: "second", kind: "play", w: 1, make: genSecondHand },
  { key: "cover", kind: "play", w: 1, make: genCover },
  { key: "fourth", kind: "play", w: 1, make: genFourthHand },
  { key: "suitplay", kind: "play", w: 2, make: genSuitPlay },
];

// Roughly seven bidding problems for every three card-play ones.
const PLAY_SHARE = 0.3;

/** Build problem number `seed`. Optionally force a type (tests). */
export function makeProblem(seed, onlyType) {
  const rand = rng(seed);
  let types = TYPES;
  if (onlyType) types = TYPES.filter((t) => t.key === onlyType);
  else {
    const kind = rand() < PLAY_SHARE ? "play" : "bid";
    types = TYPES.filter((t) => t.kind === kind);
  }
  const total = types.reduce((n, t) => n + t.w, 0);
  // Pick the type once, then deal until that type accepts a hand, so a rarely
  // accepted type still gets its fair share.
  let x = rand() * total, t = types[types.length - 1];
  for (const ty of types) { x -= ty.w; if (x <= 0) { t = ty; break; } }
  for (let attempt = 0; attempt < 50000; attempt++) {
    const p = t.make(rand);
    if (!p) continue;
    if (p.kind === "play" || p.kind === "suit") return { seed, type: t.key, ...p };
    const seat = seating(rand, p.calls);
    return { seed, type: t.key, kind: "bid", ...seat, ...p, best: p.answer, answers: [p.answer] };
  }
  return null;
}

/** Legal calls now: Pass plus every bid above the highest so far. */
export function legalBids(calls) {
  const hi = bidRank(highestBid(calls));
  const out = ["P"];
  // Double is open when the last call that wasn't a pass is an opponent's bid.
  let j = calls.length - 1;
  while (j >= 0 && calls[j] === "P") j--;
  if (j >= 0 && calls[j] !== "X" && (calls.length - j) % 2 === 1) out.push("X");
  for (let l = 1; l <= 7; l++) for (let s = 0; s <= 4; s++) if (bidRank(bid(l, s)) > hi) out.push(bid(l, s));
  return out;
}
