// Tests for bridge-puzzle.js. Run from the repo root:  node scripts/test_puzzle.mjs
// Part 1 checks the rules against the flip chart's own examples and hand-built
// cases. Part 2 generates thousands of problems and checks they're well formed.
import {
  makeHand, sqot, responseToSuit, responseTo1NT, overcall, responseToOvercall,
  responseTo1NTOvercall, ntLead, makeProblem, legalBids, parseCard, TYPES,
  openingBidFor, openerAfter1NT, losers, openerAfterRaise, responderSecondBid, openerAfterTransferCont,
  respondTakeout, vs1NT, overOvercall, respond2C, respond2NT, respondPreempt, suitLead,
} from "../bridge-puzzle.js";

let fails = 0, passes = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passes++ : fails++;
  if (!ok) console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// "AQ732 9652 64 K852" = spades hearts diamonds clubs, "-" for a void.
const R = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
function H(str) {
  const parts = str.split(" ");
  const cards = [];
  parts.forEach((p, i) => {
    const s = 3 - i;
    if (p === "-") return;
    p.replace(/10/g, "T").split("").forEach((ch) => cards.push({ s, r: R[ch] || Number(ch) }));
  });
  if (cards.length !== 13) throw new Error(`${str} has ${cards.length} cards`);
  return makeHand(cards);
}
const C = 0, D = 1, Hh = 2, S = 3;

// ---- Card 9: SQOT examples -------------------------------------------------
eq("SQOT AQ732 = 7", sqot(H("AQ732 K52 64 852"), S), 7);
eq("SQOT K8632 = 6", sqot(H("K8632 K52 64 852"), S), 6);
eq("SQOT A108632 = 8", sqot(H("A108632 K52 64 85"), S), 8);
// Over 1♥: AQ732 with 6+ pts overcalls 1♠; K8632 doesn't.
eq("overcall AQ732 1S", overcall(H("AQ732 852 K64 52"), Hh)?.answer, "1S");
eq("overcall K8632 pass", overcall(H("K8632 852 Q64 52"), Hh)?.answer, "P");
// Over 1♠ (needs the two level): A108632 SQOT 8 → 2♥ wouldn't apply; use hearts.
eq("overcall A108632 at 2 level", overcall(H("52 A108632 K64 Q5"), S)?.answer, "2H");

// ---- Card 10: the four (1♥)-1♠-(2♣)-? examples ----------------------------
const ov = (hand) => responseToOvercall(H(hand), Hh, "1S", "2C")?.answer;
eq("card10 Q52 → 2S", ov("Q52 9652 64 K852"), "2S");
eq("card10 J842 → 3S", ov("J842 5 A7532 974"), "3S");
eq("card10 98532 → 4S", ov("98532 97432 4 A2"), "4S");
eq("card10 no fit → 2D", ov("5 753 AQ1095 K632"), "2D");

// ---- Card 3: support line -----------------------------------------------------
eq("1H, 4 hearts 7pts → 2H", responseToSuit(H("Q42 K863 J52 964"), Hh)?.answer, "2H");
eq("1H, 4 hearts 11pts → 3H", responseToSuit(H("A42 K863 Q52 J64"), Hh)?.answer, "3H");
eq("1S, singleton adds 3 → 4S (10+3)", responseToSuit(H("KJ63 5 A9752 Q64"), S)?.answer, "4S");
eq("1S, 4 spades 4 pts → pass", responseToSuit(H("Q963 J52 8642 75"), S)?.answer, "P");

// ---- Card 4: without support, Rule of 14 -------------------------------
eq("1H, 4 spades → 1S", responseToSuit(H("KJ63 52 Q752 964"), Hh)?.answer, "1S");
eq("1S, 5 diamonds 9 pts → 2D (9+5=14)", responseToSuit(H("52 K63 KQ752 J64"), S)?.answer, "2D");
eq("1S, 8+5=13 but 14 with length pts → rejected", responseToSuit(H("52 K63 KJ752 J64"), S), null);
eq("over 1S, A108632 with 7 pts → pass (8+ needed)", overcall(H("52 A108632 K64 85"), S)?.answer, "P");
eq("1S, 5 diamonds 7pts, 3 spades honour → 2S", responseToSuit(H("Q52 863 KJ752 64"), S)?.answer, "2S");
eq("1H, 4 clubs + 4 spades, weak → 1S (cheapest)", responseToSuit(H("Q752 64 J83 K952"), Hh)?.answer, "1S");
eq("1S, 7pts, no 1-level, 2 spades → 1NT", responseToSuit(H("52 K632 Q75 J964"), S)?.answer, "1N");
eq("1D, 4 hearts 4 spades → 1H (cheapest of fours)", responseToSuit(H("K752 Q864 J3 952"), D)?.answer, "1H");

// ---- Card 6: responding to 1NT ------------------------------------------------
eq("1NT, 5 hearts weak → 2D transfer", responseTo1NT(H("52 Q8642 J73 952"))?.answer, "2D");
eq("1NT, 11 balanced no major → 2NT", responseTo1NT(H("K52 Q86 A732 Q52"))?.answer, "2N");
eq("1NT, 14 with five spades → 2H transfer", responseTo1NT(H("AQ863 K6 K73 Q52"))?.answer, "2H");
eq("1NT, 16 with six hearts → 2D transfer", responseTo1NT(H("52 AQ8632 K73 KJ"))?.answer, "2D");
eq("1NT, 14 no 4-card major → 3NT", responseTo1NT(H("K52 Q86 AK73 J52"))?.answer, "3N");
eq("1NT, weak with 5 clubs rejected (Stayman)", responseTo1NT(H("52 864 J73 Q9852")), null);
eq("1NT, 11 with 4 spades rejected (Stayman)", responseTo1NT(H("K952 Q86 A73 Q52")), null);

// ---- Card 8: 1NT overcall and responses --------------------------------
eq("over 1D, 16 bal with AJ5 → 1NT", overcall(H("KQ5 A963 AJ5 J52"), D)?.answer, "1N");
eq("over 1D, 13 with K5 doubleton, SOS → X", overcall(H("KQ53 A963 K5 J52"), D)?.answer, "X");
eq("over 1D, 16 bal with K5 doubleton rejected", overcall(H("KQ53 A963 K5 AJ2"), D), null);
eq("partner 1NT ovc, 5 pts 5 hearts → 2H", responseTo1NTOvercall(H("52 QJ862 J73 952"), C)?.answer, "2H");
eq("partner 1NT ovc, 8 bal → 2NT", responseTo1NTOvercall(H("K52 Q86 J732 Q52"), C)?.answer, "2N");

// ---- Opening leads vs NT ----------------------------------------------------
eq("lead from KQJ73 → K", ntLead([13, 12, 11, 7, 3])?.r, 13);
eq("lead from K9752 → 5", ntLead([13, 9, 7, 5, 2])?.r, 5);
eq("lead from QJ1062 → Q", ntLead([12, 11, 10, 6, 2])?.r, 12);
eq("lead from KQ852 rejected", ntLead([13, 12, 8, 5, 2]), null);
eq("lead from KJ1052 rejected", ntLead([13, 11, 10, 5, 2]), null);


// ---- Cards 1, 2, 7: opening --------------------------------------------------
const op = (hand) => openingBidFor(H(hand))?.answer;
eq("16 bal 4♠4♥ → 1H", op("AQ52 KJ63 K4 Q52"), "1H");
eq("16 bal 4♠4♦ → 1S", op("AQ52 K63 KJ63 Q5"), "1S");
eq("13 bal 5♠332 → 1NT", op("AQ852 K63 J4 Q52"), "1N");
eq("12 bal 4432 → 1NT", op("A852 K63 K4 Q852"), "1N");
eq("25 unbalanced with ♣ → 2C", op("A4 A5 AK3 AKQJ85"), "2C");
eq("18 bal → 1 longest (♦)", op("AQ5 KJ6 AJ963 Q5"), "1D");
eq("21 bal → 2NT", op("AQ5 KJ6 AJ93 KQ5"), "2N");
eq("24 bal → 2C", op("AKQ5 KJ6 AJ9 KQ5"), "2C");
eq("Rule of 20 = 19 → pass (9+6+4)", op("K98632 A754 Q4 5"), "P");
eq("Rule of 20 = 20 → 1S (10+6+4)", op("K98632 A754 K4 5"), "1S");
eq("Rule of 20 5-5 → higher ranking 1H", op("4 AJ852 32 KQ963"), "1H");
eq("21 unbalanced → rejected (card 18 not photographed)", op("A4 AKQJ85 AK3 75"), undefined);
eq("21 unbalanced ♣ longest rejected", op("84 A5 AK3 AKQJ85"), undefined);
eq("24 unbalanced → 2C", op("A4 AKQJ85 AKQ 75"), "2C");
eq("good 7-card suit, 8 pts → 3S", op("KQJ9852 5 Q4 852"), "3S");

// ---- Card 5: opener after 1NT ----------------------------------------------
const nt = (hand, resp) => openerAfter1NT(H(hand), resp)?.answer;
eq("1NT-2NT with 12 → pass", nt("A852 K63 K4 Q852", "2N"), "P");
eq("1NT-2NT with 14 → 3NT", nt("A852 K63 Q4 KQ85", "2N"), "3N");
eq("1NT-2NT with 13 rejected", nt("A852 K63 Q4 KJ85", "2N"), undefined);
eq("1NT-2D transfer → 2H", nt("A82 K63 Q42 KJ85", "2D"), "2H");
eq("1NT-2D, 13 with four hearts rejected", nt("A8 K632 Q42 KJ85", "2D"), undefined);
eq("1NT-2H transfer, 13 with 3 spades → 2S", nt("A82 K63 Q42 KJ85", "2H"), "2S");
eq("1NT-2D, max 14 with four hearts → 3H", nt("A8 K632 Q42 KJ85".replace("Q42","K42"), "2D"), "3H");
eq("1NT-2S → 3C", nt("A82 K63 Q42 KJ85", "2S"), "3C");


// ---- Second batch of cards ----------------------------------------------
// Card 22/23: weak twos and threes (the chart's own examples)
eq("KJ9842 → 2S", op("KJ9842 52 Q4 852"), "2S");
eq("A109732 → 2H", op("52 A109732 Q4 852"), "2H");
eq("K76432 diamonds → pass", op("52 Q4 K76432 852"), "P");
eq("AJ7432 clubs → pass", op("52 Q4 852 AJ7432"), "P");
eq("QJ107432 → 3H", op("5 QJ107432 Q4 852"), "3H");
eq("A976432 rejected (chart: 2♦ only if...)", op("5 52 A976432 852"), undefined);
eq("KQJ97432 eight → 4C", op("52 52 2 KQJ97432"), "4C");
eq("2H-? 74 J104 KJ96 A742 → 3H", respondPreempt(H("74 J104 KJ96 A742"), 2, 2)?.answer, "3H");
eq("2H-? A4 J4 AK63 A7432 → 4H", respondPreempt(H("A4 J4 AK63 A7432"), 2, 2)?.answer, "4H");
eq("3H-? 73 J74 A9632 Q42 → 4H", respondPreempt(H("73 J74 A9632 Q42"), 2, 3)?.answer, "4H");
eq("3H-? KQ74 93 KQJ2 QJ9 → pass", respondPreempt(H("KQ74 93 KQJ2 QJ9"), 2, 3)?.answer, "P");
// Conventions p1: LTC
eq("LTC KJ84 Q6 Q9742 96 = 8", losers(H("KJ84 Q6 Q9742 96")), 8);
eq("LTC AQ632 K742 KJ6 3 = 6", losers(H("AQ632 K742 KJ6 3")), 6);
eq("LTC 1S-3S, 6 losers → 4S", openerAfterRaise(H("AQ632 K742 KJ6 3"), 3, "3S")?.answer, "4S");
eq("LTC 1S-2S, 7 losers → pass", openerAfterRaise(H("AQ632 K742 J76 3"), 3, "2S")?.answer, "P");
// Card 21 / Conventions p2: Stayman examples
eq("Stayman reply Q74 9862 KQ10 AJ9 → 2H", nt("Q74 9862 KQ10 AJ9", "2C"), "2H");
eq("Stayman reply both majors → 2H", nt("KJ63 A742 KJ Q86", "2C"), "2H");
eq("Stayman reply KQ75 62 J74 AK64 → 2S", nt("KQ75 62 J74 AK64", "2C"), "2S");
eq("6 AK74 J9652 KQ2 → 2C", responseTo1NT(H("6 AK74 J9652 KQ2"))?.answer, "2C");
eq("... then 2H → 4H", responderSecondBid(H("6 AK74 J9652 KQ2"), "2C", "2H")?.answer, "4H");
eq("AQ74 K63 Q1063 75 → 2C", responseTo1NT(H("AQ74 K63 Q1063 75"))?.answer, "2C");
eq("... then 2H → 2NT", responderSecondBid(H("AQ74 K63 Q1063 75"), "2C", "2H")?.answer, "2N");
eq("weak J632 Q9743 63 92 → 2C", responseTo1NT(H("J632 Q9743 63 92"))?.answer, "2C");
eq("... then 2S → pass", responderSecondBid(H("J632 Q9743 63 92"), "2C", "2S")?.answer, "P");
eq("... or 2D → 2H", responderSecondBid(H("J632 Q9743 63 92"), "2C", "2D")?.answer, "2H");
// Conventions p10: transfers example
eq("AQ742 863 K4 Q103 → 2H", responseTo1NT(H("AQ742 863 K4 Q103"))?.answer, "2H");
eq("... then 2S → 2NT", responderSecondBid(H("AQ742 863 K4 Q103"), "2H", "2S")?.answer, "2N");
eq("opener K86 74 AQ63 AJ42 after 2NT → 4S", openerAfterTransferCont(H("K86 74 AQ63 AJ42"), 3, "2N")?.answer, "4S");
eq("weak six clubs → 2S", responseTo1NT(H("52 862 J3 Q98652"))?.answer, "2S");
eq("5H 4S 12 pts → 2D then 2S", responderSecondBid(H("KJ52 AQ863 J3 52"), "2D", "2H")?.answer, "2S");
// Card 11: take-out double
eq("over 1H, 15 SOS → X", overcall(H("AJ52 3 KQ74 AJ32"), Hh)?.answer, "X");
eq("(1H) X (P), 5 pts 5 spades → 1S", respondTakeout(H("Q8652 52 K73 965"), Hh)?.answer, "1S");
eq("(1H) X (P), 10 pts 5 spades → 2S", respondTakeout(H("Q8652 52 KJ3 A65"), Hh)?.answer, "2S");
eq("(1H) X (P), 14 pts 5 spades → 4S", respondTakeout(H("KQ652 52 AJ3 A65"), Hh)?.answer, "4S");
// Card 12: penalty doubles
eq("(1NT), 17 → X", vs1NT(H("AQ52 K3 KQ74 A32"))?.answer, "X");
eq("1H (2D), KJ94 diamonds 10 pts → X", overOvercall(H("A2 52 KJ94 Q9852"), Hh, "2D")?.answer, "X");
// Cards 17, 19
eq("2C-?, 8 pts five hearts → 2H", respond2C(H("52 KQ852 J73 Q52"))?.answer, "2H");
eq("2C-?, 3 pts → 2D", respond2C(H("52 852 J73 Q9852"))?.answer, "2D");
eq("2C-?, 9 pts five diamonds → 3D", respond2C(H("52 K52 KJ873 Q52"))?.answer, "3D");
eq("2NT-?, 6 with 4 hearts → 3C", respond2NT(H("K52 Q862 J73 952"))?.answer, "3C");
eq("2NT-?, 6 with 5 hearts → 3D", respond2NT(H("K5 Q8652 J73 952"))?.answer, "3D");
eq("2NT-?, 6 no major → 3NT", respond2NT(H("K52 Q86 J73 9852"))?.answer, "3N");
// Card 24: leads
eq("lead v suit, AK → A", suitLead(H("AK73 52 9864 J52"), Hh)?.s, S);
eq("lead v suit, KQ → K", suitLead(H("9873 52 KQ64 J52"), Hh)?.r, 13);
eq("NT lead KJ74 → 4", ntLead([13, 11, 7, 4])?.r, 4);
eq("NT lead AQ963 → 6", ntLead([14, 12, 9, 6, 3])?.r, 6);

// ---- Part 2: bulk generation ------------------------------------------------
const N = Number(process.env.N || 20000);
const t0 = Date.now();
const byType = {}, answers = {};
for (let seed = 1; seed <= N; seed++) {
  const p = makeProblem(seed);
  if (!p) { fails++; console.log("FAIL no problem for seed", seed); continue; }
  byType[p.type] = (byType[p.type] || 0) + 1;
  const all = p.hand ? p.hand.suits.flatMap((rs, s) => rs.map((r) => `${s}:${r}`)) : null;
  if (all && (all.length !== 13 || new Set(all).size !== 13)) { fails++; console.log("FAIL bad hand", seed); }
  if (p.kind === "bid") {
    const legal = legalBids(p.calls);
    if (!legal.includes(p.answer)) { fails++; console.log("FAIL illegal answer", seed, p.calls, p.answer); }
    answers[p.type + " " + p.answer] = (answers[p.type + " " + p.answer] || 0) + 1;
    const again = makeProblem(seed);
    if (again.answer !== p.answer || again.you !== p.you) { fails++; console.log("FAIL not reproducible", seed); }
  } else if (p.kind === "suit") {
    for (const a of p.answers) {
      const [who, r] = a.split(":");
      if (!(who === "Y" ? p.youCards : p.dummyCards).includes(Number(r))) { fails++; console.log("FAIL suit answer", seed, a); }
    }
    const all2 = [...p.youCards, ...p.dummyCards];
    if (new Set(all2).size !== all2.length) { fails++; console.log("FAIL duplicate card", seed); }
  } else {
    for (const a of p.answers) {
      const c = parseCard(a);
      if (!p.hand.suits[c.s].includes(c.r)) { fails++; console.log("FAIL answer not in hand", seed, a); }
    }
    if (!p.answers.includes(p.best)) { fails++; console.log("FAIL best not an answer", seed); }
    // Seats: the opening leader sits on declarer's left; cards already played
    // to the trick come from the seats just before yours, clockwise.
    if (p.type === "leadnt" && p.you !== (p.declarer + 1) % 4) { fails++; console.log("FAIL leader seat", seed); }
    if (p.trick) {
      const seats = p.trick.map((t) => t.seat);
      const ok = seats.every((st, i) => (st + seats.length - i) % 4 === p.you);
      if (!ok) { fails++; console.log("FAIL trick order", seed, seats, p.you); }
      const roleOk = { third: [(p.declarer + 1) % 4, p.dummySeat], second: [p.declarer], cover: [p.dummySeat], fourth: [p.dummySeat, (p.declarer + 3) % 4, p.declarer] }[p.type];
      if (JSON.stringify(roleOk) !== JSON.stringify(seats)) { fails++; console.log("FAIL trick roles", seed, p.type); }
      if (p.dummySeat !== (p.declarer + 2) % 4) { fails++; console.log("FAIL dummy seat", seed); }
      const led = parseCard(p.trick[0].card);
      if (p.follow !== led.s) { fails++; console.log("FAIL follow suit", seed); }
    }
  }
  if (!p.why || !p.card) { fails++; console.log("FAIL missing explanation", seed); }
}
const ms = Date.now() - t0;
console.log(`\nGenerated ${N} problems in ${ms} ms (${(ms / N).toFixed(2)} ms each).`);
console.log("By type:", byType);
console.log(`Types never produced: ${TYPES.map((t) => t.key).filter((k) => !byType[k]).join(", ") || "none"}`);
if (process.env.SHOW) console.log(Object.entries(answers).sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
console.log(fails ? `\n${fails} FAILED, ${passes} rule checks passed` : `\nALL PASS (${passes} rule checks + bulk)`);
process.exit(fails ? 1 : 0);
