// Tests for bridge-puzzle.js. Run from the repo root:  node scripts/test_puzzle.mjs
// Part 1 checks the rules against the flip chart's own examples and hand-built
// cases. Part 2 generates thousands of problems and checks they're well formed.
import {
  makeHand, sqot, responseToSuit, responseTo1NT, overcall, responseToOvercall,
  responseTo1NTOvercall, ntLead, makeProblem, legalBids, parseCard, TYPES,
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
eq("1NT, 5 hearts weak → 2H", responseTo1NT(H("52 Q8642 J73 952"))?.answer, "2H");
eq("1NT, 11 balanced no major → 2NT", responseTo1NT(H("K52 Q86 A732 Q52"))?.answer, "2N");
eq("1NT, 13 with five spades → 3S", responseTo1NT(H("AQ863 K6 K73 Q52"))?.answer, "3S");
eq("1NT, 13 with six hearts → 4H", responseTo1NT(H("52 AQ8632 K73 KJ"))?.answer, "4H");
eq("1NT, 14 no 4-card major → 3NT", responseTo1NT(H("K52 Q86 AK73 J52"))?.answer, "3N");
eq("1NT, weak with 5 clubs rejected (Stayman)", responseTo1NT(H("52 864 J73 Q9852")), null);
eq("1NT, 11 with 4 spades rejected (Stayman)", responseTo1NT(H("K952 Q86 A73 Q52")), null);

// ---- Card 8: 1NT overcall and responses --------------------------------
eq("over 1D, 16 bal with AJ5 → 1NT", overcall(H("KQ5 A963 AJ5 J52"), D)?.answer, "1N");
eq("over 1D, 16 bal with K5 doubleton rejected", overcall(H("KQ53 A963 K5 J52"), D), null);
eq("partner 1NT ovc, 5 pts 5 hearts → 2H", responseTo1NTOvercall(H("52 QJ862 J73 952"), C)?.answer, "2H");
eq("partner 1NT ovc, 8 bal → 2NT", responseTo1NTOvercall(H("K52 Q86 J732 Q52"), C)?.answer, "2N");

// ---- Opening leads vs NT ----------------------------------------------------
eq("lead from KQJ73 → K", ntLead([13, 12, 11, 7, 3])?.r, 13);
eq("lead from K9752 → 5", ntLead([13, 9, 7, 5, 2])?.r, 5);
eq("lead from QJ1062 → Q", ntLead([12, 11, 10, 6, 2])?.r, 12);
eq("lead from KQ852 rejected", ntLead([13, 12, 8, 5, 2]), null);
eq("lead from KJ1052 rejected", ntLead([13, 11, 10, 5, 2]), null);

// ---- Part 2: bulk generation ------------------------------------------------
const N = Number(process.env.N || 20000);
const t0 = Date.now();
const byType = {}, answers = {};
for (let seed = 1; seed <= N; seed++) {
  const p = makeProblem(seed);
  if (!p) { fails++; console.log("FAIL no problem for seed", seed); continue; }
  byType[p.type] = (byType[p.type] || 0) + 1;
  const all = p.hand.suits.flatMap((rs, s) => rs.map((r) => `${s}:${r}`));
  if (all.length !== 13 || new Set(all).size !== 13) { fails++; console.log("FAIL bad hand", seed); }
  if (p.kind === "bid") {
    const legal = legalBids(p.calls);
    if (!legal.includes(p.answer)) { fails++; console.log("FAIL illegal answer", seed, p.calls, p.answer); }
    answers[p.type + " " + p.answer] = (answers[p.type + " " + p.answer] || 0) + 1;
    const again = makeProblem(seed);
    if (again.answer !== p.answer || again.you !== p.you) { fails++; console.log("FAIL not reproducible", seed); }
  } else {
    for (const a of p.answers) {
      const c = parseCard(a);
      if (!p.hand.suits[c.s].includes(c.r)) { fails++; console.log("FAIL answer not in hand", seed, a); }
    }
    if (!p.answers.includes(p.best)) { fails++; console.log("FAIL best not an answer", seed); }
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
