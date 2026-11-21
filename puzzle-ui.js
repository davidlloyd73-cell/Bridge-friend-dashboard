// =============================================================================
// puzzle-ui.js — draws the hub's "Bridge problem" window from bridge-puzzle.js.
// One problem at a time: answer it (a bid from the bidding box, or a card from
// your hand), see whether you were right and why, then "Next problem".
//
// hub.html?p=<number> opens that problem number, so anyone can say "problem
// 4821 looks wrong" and it can be reproduced exactly.
// =============================================================================

import {
  makeProblem, legalBids, bidText, parseCard, cardId, rankStr, SYM, SEAT_NAME,
} from "./bridge-puzzle.js?v=20261121g";

const STORE = "bridgePuzzleStreak";
const RED = new Set([1, 2]); // diamonds, hearts

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** A call or card label with a red suit symbol where needed. */
function label(text, strain) {
  const span = h("span", RED.has(strain) ? "pz-red" : null, text);
  return span;
}
function callNode(call) {
  if (call === "P") return h("span", "pz-pass", "Pass");
  if (call === "X") return h("span", "pz-dbl", "Dbl");
  const strain = "CDHSN".indexOf(call[1]);
  return label(bidText(call), strain);
}

// ---- Streak (this device only; storage can be unavailable) ----------------
function readStreak() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { run: 0, best: 0, right: 0, tried: 0 }; }
  catch { return { run: 0, best: 0, right: 0, tried: 0 }; }
}
function saveStreak(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ } }

// ---- Pieces -----------------------------------------------------------------
const who = (p, seat) => (seat === p.you ? "You" : seat === (p.you + 2) % 4 ? "Partner" : seat === p.dummySeat ? "Dummy" : "");

function auctionTable(p) {
  const t = h("table", "pz-auction");
  const head = h("tr");
  for (let seat = 0; seat < 4; seat++) {
    const th = h("th");
    th.appendChild(h("span", "pz-seat", SEAT_NAME[seat]));
    const tag = who(p, seat);
    if (tag) th.appendChild(h("span", "pz-who", tag));
    if (seat === p.dealer) th.appendChild(h("span", "pz-dealer", "Dealer"));
    if (seat === p.you) th.classList.add("pz-me");
    head.appendChild(th);
  }
  const thead = h("thead"); thead.appendChild(head); t.appendChild(thead);
  const body = h("tbody");
  const cells = Array(p.dealer).fill(null).concat(p.calls);
  if (p.kind === "bid") cells.push("?");
  for (let i = 0; i < cells.length; i += 4) {
    const tr = h("tr");
    for (let j = 0; j < 4; j++) {
      const td = h("td");
      const c = cells[i + j];
      if (c === "?") { td.className = "pz-ask"; td.textContent = "?"; }
      else if (c) td.appendChild(callNode(c));
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  t.appendChild(body);
  return t;
}

/** A hand by suit. In a card-play problem the cards are buttons. */
function handBlock(title, hand, opts = {}) {
  const box = h("div", "pz-hand");
  box.appendChild(h("div", "pz-hand-title", `${title} · ${hand.hcp} pts`));
  [3, 2, 1, 0].forEach((s) => {
    const row = h("div", "pz-suit");
    row.appendChild(label(SYM[s], s)).classList.add("pz-sym");
    const cards = h("span", "pz-cards");
    if (!hand.suits[s].length) cards.appendChild(h("span", "pz-void", "—"));
    hand.suits[s].forEach((r) => {
      if (opts.onPick) {
        const b = h("button", "pz-card" + (RED.has(s) ? " pz-red" : ""), rankStr(r));
        b.type = "button";
        b.dataset.card = cardId(s, r);
        b.setAttribute("aria-label", `${rankStr(r)} of ${["clubs", "diamonds", "hearts", "spades"][s]}`);
        if (opts.follow !== undefined && s !== opts.follow) b.disabled = true; // must follow suit
        b.addEventListener("click", () => opts.onPick(cardId(s, r)));
        cards.appendChild(b);
      } else {
        cards.appendChild(h("span", "pz-rank", rankStr(r)));
      }
    });
    row.appendChild(cards);
    box.appendChild(row);
  });
  return box;
}

/** Declarer problems: just the one suit, dummy above you, every card tappable. */
function suitBlock(p, onPick) {
  const box = h("div", "pz-suitplay");
  [["Dummy (North)", p.dummyCards, "D"], ["You (South)", p.youCards, "Y"]].forEach(([title, cards, who]) => {
    const row = h("div", "pz-hand");
    row.appendChild(h("div", "pz-hand-title", title));
    const line = h("div", "pz-suit");
    line.appendChild(label(SYM[p.suit], p.suit)).classList.add("pz-sym");
    const wrap = h("span", "pz-cards");
    cards.forEach((r) => {
      const b = h("button", "pz-card" + (RED.has(p.suit) ? " pz-red" : ""), rankStr(r));
      b.type = "button";
      b.dataset.card = `${who}:${r}`;
      b.setAttribute("aria-label", `${rankStr(r)} from ${who === "Y" ? "your hand" : "dummy"}`);
      b.addEventListener("click", () => onPick(`${who}:${r}`));
      wrap.appendChild(b);
    });
    line.appendChild(wrap);
    row.appendChild(line);
    box.appendChild(row);
  });
  return box;
}

function biddingBox(p, onPick) {
  const legal = new Set(legalBids(p.calls));
  const box = h("div", "pz-box");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Bidding box");
  for (let level = 1; level <= 7; level++) {
    const row = h("div", "pz-box-row");
    let any = false;
    for (let s = 0; s <= 4; s++) {
      const call = `${level}${"CDHSN"[s]}`;
      const b = h("button", "pz-bid");
      b.type = "button";
      b.dataset.call = call;
      b.appendChild(label(`${level}${SYM[s]}`, s));
      if (!legal.has(call)) b.disabled = true; else any = true;
      b.addEventListener("click", () => onPick(call));
      row.appendChild(b);
    }
    if (any) box.appendChild(row);
  }
  const row = h("div", "pz-box-calls");
  const pass = h("button", "pz-bid pz-bid-pass", "Pass");
  pass.type = "button";
  pass.dataset.call = "P";
  pass.addEventListener("click", () => onPick("P"));
  row.appendChild(pass);
  const dbl = h("button", "pz-bid pz-bid-dbl", "Double");
  dbl.type = "button";
  dbl.dataset.call = "X";
  if (!legal.has("X")) dbl.disabled = true;
  dbl.addEventListener("click", () => onPick("X"));
  row.appendChild(dbl);
  box.appendChild(row);
  return box;
}

function answerText(p, a) {
  if (p.kind === "bid") return bidText(a);
  if (p.kind === "choice") return `${a} points`;
  if (p.kind === "suit") {
    const [who, r] = a.split(":");
    return `${SYM[p.suit]}${rankStr(Number(r))} from ${who === "Y" ? "your hand" : "dummy"}`;
  }
  const c = parseCard(a);
  return `${SYM[c.s]}${rankStr(c.r)}`;
}

// ---- The window ----------------------------------------------------------------
export function initPuzzle(host, meta) {
  if (!host) return;
  const fromUrl = Number(new URLSearchParams(location.search).get("p"));
  show(Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : newSeed());

  function newSeed() { return 1 + Math.floor(Math.random() * 999999); }

  function show(seed) {
    const p = makeProblem(seed);
    host.textContent = "";
    if (!p) { host.appendChild(h("p", "muted", "Couldn't deal a problem. Try again.")); return; }
    if (meta) meta.textContent = `Problem ${seed} · ${p.tag}`;

    const q = h("p", "pz-question", p.kind === "bid" ? "What do you bid?" : p.question);
    host.appendChild(q);

    if (p.contract) host.appendChild(h("p", "pz-contract", `Contract: ${p.contract}. You are ${p.kind === "suit" ? "declarer" : SEAT_NAME[p.you]}.`));
    if (p.calls) host.appendChild(auctionTable(p));

    let answered = false;
    const pickCard = (id) => answer(id);
    if (p.kind === "choice") {
      const opts = h("div", "pz-options");
      p.options.forEach((o) => {
        const b = h("button", "pz-opt", `${o} points`);
        b.type = "button";
        b.dataset.opt = o;
        b.addEventListener("click", () => answer(o));
        opts.appendChild(b);
      });
      host.appendChild(opts);
    } else if (p.kind === "suit") {
      host.appendChild(suitBlock(p, pickCard));
    } else {
      const hands = h("div", "pz-hands");
      if (p.dummyHand) hands.appendChild(handBlock(`Dummy (${SEAT_NAME[p.dummySeat]})`, p.dummyHand));
      hands.appendChild(handBlock(`Your hand (${SEAT_NAME[p.you]})`, p.hand,
        p.kind === "play" ? { onPick: pickCard, follow: p.follow } : {}));
      host.appendChild(hands);
    }

    if (p.trick) {
      const tr = h("p", "pz-trick");
      tr.appendChild(document.createTextNode("This trick: "));
      p.trick.forEach((t, i) => {
        const c = parseCard(t.card);
        if (i) tr.appendChild(document.createTextNode(", "));
        const role = t.seat === p.dummySeat ? " (dummy)" : t.seat === p.declarer ? " (declarer)" : t.seat === (p.you + 2) % 4 ? " (partner)" : "";
        tr.appendChild(document.createTextNode(`${SEAT_NAME[t.seat]}${role} `));
        tr.appendChild(label(`${SYM[c.s]}${rankStr(c.r)}`, c.s));
      });
      tr.appendChild(document.createTextNode(", you ?"));
      host.appendChild(tr);
    }

    if (p.kind === "bid") host.appendChild(biddingBox(p, (c) => answer(c)));
    else if (p.kind !== "choice") host.appendChild(h("p", "pz-hint muted", p.kind === "suit" ? "Tap the card you'd play first, from either hand." : p.follow !== undefined ? "Tap a card in your hand (you must follow suit)." : "Tap a card in your hand."));

    const fb = h("div", "pz-feedback");
    fb.setAttribute("aria-live", "polite");
    host.appendChild(fb);

    function answer(choice) {
      if (answered) return;
      answered = true;
      const right = p.answers.includes(choice);
      const st = readStreak();
      st.tried += 1;
      if (right) { st.right += 1; st.run += 1; st.best = Math.max(st.best, st.run); } else st.run = 0;
      saveStreak(st);

      host.querySelectorAll("button.pz-bid, button.pz-card, button.pz-opt").forEach((b) => {
        const v = b.dataset.call || b.dataset.card || b.dataset.opt;
        if (v === choice) b.classList.add(right ? "pz-right" : "pz-wrong");
        if (v === p.best) b.classList.add("pz-right");
        b.disabled = true;
      });

      fb.textContent = "";
      fb.className = "pz-feedback " + (right ? "is-right" : "is-wrong");
      const verdict = right
        ? (p.answers.length > 1 && choice !== p.best ? `✓ Right (${answerText(p, p.best)} is the usual card).` : "✓ Right.")
        : `✗ Not this time: the answer is ${answerText(p, p.best)}.`;
      fb.appendChild(h("p", "pz-verdict", verdict));
      fb.appendChild(h("p", "pz-why", p.why));
      fb.appendChild(h("p", "pz-source", p.card + (/^(Card \d|Conventions)/.test(p.card) ? " (Andrew Robson flip chart)" : "")));
      const row = h("div", "pz-next-row");
      const next = h("button", "pz-next", "Next problem →");
      next.type = "button";
      next.addEventListener("click", () => show(newSeed()));
      row.appendChild(next);
      row.appendChild(h("span", "pz-streak muted", `Streak ${st.run} · best ${st.best} · ${st.right}/${st.tried} right on this device`));
      fb.appendChild(row);
      next.focus({ preventScroll: true });
    }
  }
}
