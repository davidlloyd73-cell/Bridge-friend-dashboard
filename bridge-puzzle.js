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
  if (b === "P") return null;
  return { level: Number(b[0]), strain: STRAIN_CH.indexOf(b[1]) };
}
/** Order of bids: 1C < 1D < ... < 1NT < 2C ... ; Pass is -1. */
export function bidRank(b) {
  const p = parseBid(b);
  return p ? (p.level - 1) * 5 + p.strain : -1;
}
export function bidText(b) {
  if (b === "P") return "Pass";
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
function openingBidFor(h) {
  if (Math.max(...h.len) >= 7 || h.hcp > 25) return null; // pre-empts / huge hands: not on the chart
  const s = openerSuit(h), name = SUIT_NAME[s];
  if (h.bal) {
    if (h.hcp < 12) return { answer: "P", why: `Balanced with ${h.hcp} points: too weak to open (balanced openings start at 12).` };
    if (h.hcp <= 14) return { answer: "1N", why: `Balanced (${h.shape.split("").join("-")}) with ${h.hcp} points: every balanced 12–14 opens 1NT.` };
    if (h.hcp <= 19) return { answer: bid(1, s), why: `Balanced with ${h.hcp} points is too strong for 1NT, so open one of your longest suit (${name})${tieNote(h)}. You will show the strength by rebidding no-trumps.` };
    if (h.hcp <= 22) return { answer: "2N", why: `Balanced with ${h.hcp} points: 20–22 opens 2NT.` };
    return { answer: "2C", why: `${h.hcp} points: 23+ opens 2♣, balanced or not.` };
  }
  const r20 = h.hcp + [...h.len].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
  if (h.hcp >= 23) return { answer: "2C", why: `${h.hcp} points: 23+ opens 2♣, then rebid your longest suit.` };
  if (h.hcp >= 20) {
    if (s === 0) return null; // "two of longest" would be 2♣, which the chart keeps for 23+
    return { answer: bid(2, s), why: `Unbalanced with ${h.hcp} points: 20–22 opens two of your longest suit (${name}).` };
  }
  const top2 = [...h.len].sort((a, b) => b - a).slice(0, 2);
  const sum = `${h.hcp} points + ${top2[0]} + ${top2[1]} cards = ${r20}`;
  if (r20 >= 20) return { answer: bid(1, s), why: `Rule of 20: ${sum}, so open. Open one of your longest suit (${name})${tieNote(h)}.` };
  return { answer: "P", why: `Rule of 20: ${sum}, which is short of 20, so pass.` };
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
  return { calls, hand: h, ...r, card: h.bal ? "Card 1 · Opening when balanced" : "Card 2 · Opening when unbalanced", tag: "Opening" };
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

/** Card 5 — you opened 1NT; partner has responded. */
function genOpenerAfter1NT(rand) {
  const deck = shuffledDeck(rand), h = makeHand(deck.slice(0, 13));
  if (!h.bal || h.hcp < 12 || h.hcp > 14) return null;
  const roll = rand();
  const resp = roll < 0.35 ? "2N" : roll < 0.75 ? pick(rand, ["3H", "3S"]) : roll < 0.9 ? pick(rand, ["2D", "2H", "2S"]) : pick(rand, ["3N", "4H", "4S"]);
  let answer, why;
  if (resp === "2N") {
    if (h.hcp === 13) return null; // "a good 13" is judgement
    answer = h.hcp === 14 ? "3N" : "P";
    why = h.hcp === 14
      ? "Partner's 2NT invites game with 11–12. You have a maximum (14), so raise to 3NT."
      : "Partner's 2NT invites game with 11–12. You have a minimum (12), so pass.";
  } else if (resp === "3H" || resp === "3S") {
    const M = resp === "3H" ? 2 : 3;
    answer = h.len[M] >= 3 ? bid(4, M) : "3N";
    why = `Partner's 3${SYM[M]} shows 13+ points and precisely five ${SUIT_NAME[M]}. ` + (h.len[M] >= 3
      ? `You have ${h.len[M]} (${suitList(h, M)}), so raise to 4${SYM[M]}.`
      : `You have only a doubleton (${suitList(h, M)}), so bid 3NT.`);
  } else if (resp[0] === "2") {
    answer = "P";
    why = `Partner's ${bidText(resp)} is a weak take-out: 0–10 points with five+ ${SUIT_NAME[parseBid(resp).strain]}. Partner is in charge and has placed the contract, so pass.`;
  } else {
    answer = "P";
    why = `Partner's ${bidText(resp)} is a sign-off in game. Partner is in charge: pass.`;
  }
  const calls = rand() < 0.5 ? ["1N", "P", resp, "P"] : ["P", "1N", "P", resp, "P"];
  return { calls, hand: h, answer, why: `${why} (You opened 1NT with ${h.hcp}.)`, card: "Card 5 · Opening 1NT", tag: "Opener's rebid" };
}

/** Card 6 — partner opened 1NT (12–14). */
export function responseTo1NT(h) {
  if (h.hcp >= 18) return null;
  const fives = [0, 1, 2, 3].filter((s) => h.len[s] >= 5);
  const card = "Card 6 · Responding to 1NT";
  if (h.hcp <= 10) {
    if (fives.length >= 2) return null;
    if (fives.length === 1) {
      const s = fives[0];
      if (s === 0) return null; // 2♣ is Stayman by agreement (page 21, not covered here)
      return { answer: bid(2, s), why: `0–10 points (${h.hcp}) with a five+ card suit: take out into 2${SYM[s]}. Partner will pass.`, card };
    }
    if (h.len[2] >= 4 && h.len[3] >= 4) return null; // a Stayman hand for some
    return { answer: "P", why: `0–10 points (${h.hcp}) and no five-card suit: pass. You can't make game opposite 12–14.`, card };
  }
  if (h.hcp <= 12) {
    if (!h.bal || h.len[2] >= 4 || h.len[3] >= 4) return null; // unbalanced 11–12 "must choose"; 4-card major = Stayman
    return { answer: "2N", why: `Balanced with 11–12 (${h.hcp}): bid 2NT, inviting game.`, card };
  }
  const M = [2, 3].filter((s) => h.len[s] >= 5);
  if (M.length === 2) return null;
  if (M.length === 1) {
    const s = M[0];
    if (h.len[s] >= 6) return { answer: bid(4, s), why: `13+ points (${h.hcp}) with six+ ${SUIT_NAME[s]}: bid game, 4${SYM[s]}.`, card };
    return { answer: bid(3, s), why: `13+ points (${h.hcp}) with precisely five ${SUIT_NAME[s]}: bid 3${SYM[s]}, and partner chooses between 4${SYM[s]} and 3NT.`, card };
  }
  if (h.len[2] >= 4 || h.len[3] >= 4) return null; // Stayman territory
  return { answer: "3N", why: `13+ points (${h.hcp}) and no five-card major: bid 3NT.`, card };
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
  const card9 = "Card 9 · Overcalling suits (SQOT)";
  if (h.bal && h.hcp >= 15 && h.hcp <= 22) {
    const st = stopper(h, X);
    if (st !== "yes") return null; // no stopper: a double, which the chart doesn't cover
    const levelOf = (s) => (s > X ? 1 : 2);
    const five = [0, 1, 2, 3].find((s) => s !== X && h.len[s] >= 5 && sqot(h, s) >= levelOf(s) + 6);
    if (five !== undefined) return null; // suit overcall vs NT overcall: unclear
    const nt = h.hcp <= 19 ? "1N" : "2N";
    return { answer: nt, why: `Balanced with ${h.hcp} points and a stopper in ${SUIT_NAME[X]} (${suitList(h, X)}): ${h.hcp <= 19 ? "15–19 overcalls 1NT" : "20–22 overcalls 2NT"}.`, card: "Card 8 · Notrumps as an overcall" };
  }
  if (h.hcp >= 16) return null; // double first, then bid: not on the chart
  const cands = [0, 1, 2, 3].filter((s) => s !== X && h.len[s] >= 5);
  const passWhy = (txt) => (h.hcp >= 12 ? null : { answer: "P", why: txt, card: card9 });
  if (!cands.length) return passWhy(`No five-card suit to overcall in (you need a good five+ card suit), and ${h.hcp} points isn't a no-trump overcall. Pass.`);
  const levelOf = (s) => (s > X ? 1 : 2);
  let s = chooseSuit(h, cands, levelOf);
  if (cands.length > 1 && h.len[cands[0]] === h.len[cands[1]] && Math.abs(sqot(h, cands[0]) - sqot(h, cands[1])) >= 2) return null; // "unless suit quality is very disparate"
  const lv = levelOf(s), q = sqot(h, s), minPts = lv === 1 ? 6 : 8;
  const ok = q >= lv + 6 && h.hcp >= minPts;
  const others = cands.filter((o) => o !== s && sqot(h, o) >= levelOf(o) + 6 && h.hcp >= (levelOf(o) === 1 ? 6 : 8));
  if (!ok && others.length) return null;
  const honours = h.suits[s].filter((r) => r >= 10).length;
  const count = `SQOT for ${SUIT_NAME[s]} (${suitList(h, s)}): ${h.len[s]} cards + ${plural(honours, "honour")} = ${q}`;
  if (ok) return { answer: bid(lv, s), why: `${count}, enough for ${lv + 6} tricks, so overcall ${lv}${SYM[s]} (with ${h.hcp} points; you need ${minPts}+ at the ${lv === 1 ? "one" : "two"} level).`, card: card9 };
  const reason = q < lv + 6 ? `${count}, short of the ${lv + 6} tricks a ${lv}${SYM[s]} overcall is for` : `${count}, but ${h.hcp} points is below the ${minPts} you need at the ${lv === 1 ? "one" : "two"} level`;
  return passWhy(`${reason}. Pass.`);
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
  if (a >= 11 && b >= 10 && a - b === 2) return null;          // e.g. KJ9, Q10: near-sequence
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
    card: "Card play · Opening leads", tag: "Opening lead",
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
    card: "Card play · Third hand high", tag: "Defence", follow: L,
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
    card: "Card play · Second hand low", tag: "Defence", follow: L,
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
    card: "Card play · Covering honours", tag: "Defence", follow: L,
  };
}

// =============================================================================
// Problem factory
// =============================================================================
export const TYPES = [
  { key: "open", kind: "bid", w: 3, make: genOpening },
  { key: "respond", kind: "bid", w: 4, make: genRespondSuit },
  { key: "rebid1nt", kind: "bid", w: 1.5, make: genOpenerAfter1NT },
  { key: "resp1nt", kind: "bid", w: 2, make: genRespond1NT },
  { key: "overcall", kind: "bid", w: 3, make: genOvercall },
  { key: "respovercall", kind: "bid", w: 2, make: genRespondOvercall },
  { key: "resp1ntovercall", kind: "bid", w: 1, make: genRespond1NTOvercall },
  { key: "leadnt", kind: "play", w: 2, make: genLeadNT },
  { key: "third", kind: "play", w: 1, make: genThirdHand },
  { key: "second", kind: "play", w: 1, make: genSecondHand },
  { key: "cover", kind: "play", w: 1, make: genCover },
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
    if (p.kind === "play") return { seed, type: t.key, ...p };
    const seat = seating(rand, p.calls);
    return { seed, type: t.key, kind: "bid", ...seat, ...p, best: p.answer, answers: [p.answer] };
  }
  return null;
}

/** Legal calls now: Pass plus every bid above the highest so far. */
export function legalBids(calls) {
  const hi = bidRank(highestBid(calls));
  const out = ["P"];
  for (let l = 1; l <= 7; l++) for (let s = 0; s <= 4; s++) if (bidRank(bid(l, s)) > hi) out.push(bid(l, s));
  return out;
}
