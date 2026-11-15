// =============================================================================
// commentator.js — "State of play": a cartoon owl who reads out where the night
// stands. Who won the last hand, who is leading tonight, and who is allowed to
// whinge (dealt the fewest high card points).
//
// Two halves. buildCommentary() is pure — model in, sentences out — so it can
// be tested alone. initCommentator() is the DOM half: it draws the owl, shows
// each sentence in a speech bubble and reads it aloud with the browser's own
// speech synthesis. No network, no key, no AI service: every word is worked out
// here from the scores already on the page. Where a browser cannot speak, the
// bubble steps through the same sentences in silence.
// =============================================================================

import { PLAYERS, fmtNum } from "./data.js?v=20261115b";

const SUIT_WORDS = {
  clubs: "clubs", diamonds: "diamonds", hearts: "hearts", spades: "spades",
  "no trumps": "no trumps", notrumps: "no trumps", nt: "no trumps",
};
const LEVEL_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"];
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];

/** "David", "David and Vivienne", "David, Vivienne and Hamish". */
function names(list) {
  if (list.length <= 1) return list[0] || "";
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

/** The contract in words, so it reads aloud properly: "four hearts doubled". */
function contractWords(h) {
  const suit = SUIT_WORDS[String(h.suit).toLowerCase()] || String(h.suit).toLowerCase();
  const d = String(h.doubled || "").toLowerCase();
  const mark = d.startsWith("redouble") ? " redoubled" : d.startsWith("double") ? " doubled" : "";
  return `${LEVEL_WORDS[h.level] || h.level} ${suit}${mark}`;
}

/** Who won the last hand, and how. */
function lastHandLine(h) {
  const declSide = [h.declarer, h.partner].filter((p) => p && p !== "?");
  const defSide = h.defenders && h.defenders.length ? names(h.defenders) : "the defenders";
  const intro = `The last hand, number ${h.handNo}:`;

  if (!h.hasContract) {
    if (h.declScore > 0 && h.declScore >= h.defScore) return `${intro} ${names(declSide)} took ${fmtNum(h.declScore)} each.`;
    if (h.defScore > 0) return `${intro} ${defSide} took ${fmtNum(h.defScore)} each.`;
    return `${intro} nobody scored.`;
  }

  const who = h.partner ? `${h.declarer}, with ${h.partner},` : h.declarer;
  const bid = `${who} bid ${contractWords(h)}`;
  if (h.resultDiff >= 0) {
    const over = h.resultDiff === 0 ? "made it exactly"
      : `made it with ${COUNT_WORDS[h.resultDiff] || h.resultDiff} overtrick${h.resultDiff === 1 ? "" : "s"}`;
    return `${intro} ${bid} and ${over}, for ${fmtNum(h.declScore)} each.`;
  }
  const down = -h.resultDiff;
  const collected = h.defScore > 0 ? `, so ${defSide} collected ${fmtNum(h.defScore)} each` : "";
  return `${intro} ${bid} and went ${COUNT_WORDS[down] || down} down${collected}.`;
}

/** Tonight's order: the leader and the margin, then everyone else. */
function leaderLines(s, when) {
  const ranked = [...PLAYERS].sort((a, b) => s.perPlayer[b] - s.perPlayer[a] || PLAYERS.indexOf(a) - PLAYERS.indexOf(b));
  const top = s.perPlayer[ranked[0]];
  const leaders = ranked.filter((p) => s.perPlayer[p] === top);
  const rest = ranked.filter((p) => s.perPlayer[p] !== top);
  const lines = [];

  if (top <= 0 && leaders.length === PLAYERS.length) return [`Nobody has scored ${when} yet.`];
  if (leaders.length === PLAYERS.length) return [`All four are level ${when}, on ${fmtNum(top)}.`];

  if (leaders.length > 1) {
    lines.push(`${names(leaders)} are level at the top ${when}, on ${fmtNum(top)}.`);
  } else {
    const gap = top - s.perPlayer[rest[0]];
    lines.push(`${leaders[0]} leads ${when} on ${fmtNum(top)}, ${fmtNum(gap)} clear of ${rest[0]}.`);
  }
  // With a sole leader the runner-up was just named, but not their score.
  const tail = rest.map((p) => `${p} on ${fmtNum(s.perPlayer[p])}`);
  if (tail.length) lines.push(`Then ${names(tail)}.`);
  return lines;
}

/** The Whinge Factor: fewest HCP dealt may complain; most dealt may not. */
function whingeLines(m, s) {
  const hcp = m.hcpSession || {};
  const logged = PLAYERS.filter((p) => hcp[p] && hcp[p].hands > 0);
  if (logged.length < PLAYERS.length) {
    return ["Not everybody's high card points are logged, so nobody is allowed to whinge. Yet."];
  }
  const sums = PLAYERS.map((p) => hcp[p].sum);
  const low = Math.min(...sums), high = Math.max(...sums);
  if (low === high) return ["The cards have been shared out perfectly evenly, so nobody is allowed to whinge."];

  const poor = PLAYERS.filter((p) => hcp[p].sum === low);
  const rich = PLAYERS.filter((p) => hcp[p].sum === high);
  const avg = (p) => hcp[p].avg.toFixed(1);
  const top = Math.max(...PLAYERS.map((p) => s.perPlayer[p]));
  const leading = (p) => s.perPlayer[p] === top && top > 0;
  const lines = [];

  let line = `Allowed to whinge: ${names(poor)}, dealt just ${fmtNum(low)} high card points` +
    (poor.length > 1 ? " each" : `, an average of ${avg(poor[0])} a hand against a fair share of 10`) + ".";
  if (poor.length === 1 && leading(poor[0])) line += " Although leading on those cards, so nobody will listen.";
  lines.push(line);

  let brag = `${names(rich)} ${rich.length > 1 ? "have" : "has"} had the best cards, with ${fmtNum(high)}`;
  brag += rich.some(leading) ? ", so the lead is no great surprise." : `, and ${rich.length > 1 ? "have" : "has"} no excuse whatsoever.`;
  lines.push(brag);
  return lines;
}

/**
 * The whole bulletin, one sentence per entry. Written to be heard as much as
 * read: contracts and counts in words, no symbols.
 */
export function buildCommentary(m, now = Date.now()) {
  const s = m && m.latestSession;
  if (!s) return ["There is nothing to report. Nobody has played a hand yet."];

  const hands = (m.latestSessionHands || []).length;
  // "Tonight" only while the session is fresh; otherwise name its date.
  const live = now - (s.lastTsMs || 0) < 12 * 3600 * 1000;
  const when = live ? "tonight" : "on the night";
  const lines = [];

  lines.push(live
    ? `Good evening. Here is the state of play after ${hands} hand${hands === 1 ? "" : "s"}.`
    : `Hello. Nobody is playing just now, so here is how the last session finished: ${s.label}, ${hands} hand${hands === 1 ? "" : "s"}.`);
  if (m.latestHand) lines.push(lastHandLine(m.latestHand));
  lines.push(...leaderLines(s, when));
  lines.push(...whingeLines(m, s));
  lines.push(live ? "That is the state of play. Back to the cards." : "That is all. Deal the next one.");
  return lines;
}

// ---------------------------------------------------------------------------
// The owl. Drawn here rather than loaded, so there is nothing extra to fetch.
// Colours come from the page's own tokens (see .commentator in styles.css).
// Built in parts — head, brows, lids, pupils, jaw, wings — so each can move.
// ---------------------------------------------------------------------------
const OWL_SVG = `
<svg class="owl" viewBox="0 0 140 150" role="img" aria-label="The Kibitzer, a cartoon owl in a bow tie">
  <ellipse class="owl-shadow" cx="70" cy="144" rx="34" ry="4"/>
  <g class="owl-all">
    <path class="owl-feet" d="M52 134 l-7 8 h7 l2 -5 l2 5 h7 l-7 -8 Z M84 134 l-7 8 h7 l2 -5 l2 5 h7 l-7 -8 Z"/>
    <path class="owl-wing owl-wing-l" d="M32 78 C14 88 12 114 26 128 C36 114 40 94 32 78 Z"/>
    <path class="owl-wing owl-wing-r" d="M108 78 C126 88 128 114 114 128 C104 114 100 94 108 78 Z"/>
    <ellipse class="owl-body" cx="70" cy="98" rx="40" ry="40"/>
    <ellipse class="owl-belly" cx="70" cy="106" rx="25" ry="28"/>
    <g class="owl-head">
      <path class="owl-body" d="M36 32 L28 4 L58 20 Z M104 32 L112 4 L82 20 Z"/>
      <ellipse class="owl-body" cx="70" cy="50" rx="42" ry="36"/>
      <circle class="owl-eye" cx="52" cy="48" r="16"/><circle class="owl-eye" cx="88" cy="48" r="16"/>
      <g class="owl-pupils"><circle cx="54" cy="49" r="7"/><circle cx="86" cy="49" r="7"/></g>
      <g class="owl-glint"><circle cx="56" cy="46" r="2.3"/><circle cx="88" cy="46" r="2.3"/></g>
      <g class="owl-lids"><rect x="35" y="31" width="34" height="34" rx="16"/><rect x="71" y="31" width="34" height="34" rx="16"/></g>
      <path class="owl-brow owl-brow-l" d="M38 29 L62 27"/><path class="owl-brow owl-brow-r" d="M102 29 L78 27"/>
      <path class="owl-mouth" d="M61 66 L79 66 L70 79 Z"/>
      <path class="owl-jaw" d="M61 66 L79 66 L70 79 Z"/>
      <path class="owl-beak" d="M59 61 L81 61 L70 75 Z"/>
    </g>
    <path class="owl-bow" d="M70 88 L54 80 L54 96 Z M70 88 L86 80 L86 96 Z"/><circle class="owl-knot" cx="70" cy="88" r="4"/>
  </g>
</svg>`;

/** A British voice if the device has one, else whatever speaks English. */
function pickVoice(synth) {
  const voices = synth.getVoices() || [];
  return voices.find((v) => /^en[-_]GB/i.test(v.lang) && v.localService) ||
    voices.find((v) => /^en[-_]GB/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) || null;
}

/** How the owl should look while saying a sentence. */
function moodOf(line) {
  if (/whinge|nobody will listen/i.test(line)) return "glum";
  if (/\bleads\b|level at the top|made it|collected|best cards/i.test(line)) return "cheer";
  return "";
}

/**
 * Wire the button to the owl.
 *   button   — the "State of play" button
 *   host     — the (hidden) element the owl and bubble are drawn into
 *   getModel — returns the model currently on screen, or null before first load
 */
export function initCommentator({ button, host, getModel }) {
  if (!button || !host) return;
  const synth = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window ? window.speechSynthesis : null;
  const LABEL = button.textContent;
  let run = 0;          // bumped on every start/stop, so stale callbacks do nothing
  let timer = null;
  let chatter = null;   // the interval that works the beak
  let quiet = null;     // closes the beak at the end of a silent caption
  let side = 0;         // which wing gestures next

  host.innerHTML = `
    <div class="commentator-figure">${OWL_SVG}<span class="commentator-name">The Kibitzer</span></div>
    <div class="commentator-bubble">
      <p class="commentator-text"></p>
      <p class="commentator-step muted small"></p>
    </div>
    <button class="commentator-close" type="button" aria-label="Close the commentator">×</button>`;
  const text = host.querySelector(".commentator-text");
  const step = host.querySelector(".commentator-step");
  const bubble = host.querySelector(".commentator-bubble");
  if (synth) synth.getVoices(); // some browsers only load the list once asked

  // ---- The beak. Driven from here rather than by a CSS loop, so it only
  // moves while a sentence is actually being said and shuts between them.
  const beak = (open) => host.style.setProperty("--beak", String(open));
  function mouthOn() {
    mouthOff();
    host.classList.add("speaking");
    let n = 0;
    chatter = setInterval(() => {
      n += 1;
      // Mostly open-shut syllables, with the odd held-shut beat for a breath.
      beak(n % 2 ? 0.35 + Math.random() * 0.65 : Math.random() < 0.3 ? 0 : 0.15 + Math.random() * 0.25);
    }, 95);
  }
  function mouthOff() {
    clearInterval(chatter); chatter = null;
    clearTimeout(quiet);
    host.classList.remove("speaking");
    beak(0);
  }

  function show(lines, i) {
    text.textContent = lines[i];
    step.textContent = `${i + 1} of ${lines.length}`;
    // A new sentence: change expression and gesture with alternate wings.
    host.classList.remove("mood-cheer", "mood-glum", "wave-l", "wave-r");
    const mood = moodOf(lines[i]);
    if (mood) host.classList.add("mood-" + mood);
    void host.offsetWidth;                       // restart the wave animation
    host.classList.add((side ^= 1) ? "wave-l" : "wave-r");
  }

  function finish(id) {
    if (id !== run) return;
    mouthOff();
    host.classList.remove("talking", "mood-cheer", "mood-glum", "wave-l", "wave-r");
    button.textContent = LABEL;
    step.textContent = "Press the button to hear it again.";
  }

  /** Silent version: step the bubble through at reading pace, beak still going. */
  function captionsOnly(lines, id, i = 0) {
    if (id !== run) return;
    if (i >= lines.length) return finish(id);
    bubble.setAttribute("aria-live", "polite");
    show(lines, i);
    const talkMs = 600 + lines[i].length * 55;
    mouthOn();
    quiet = setTimeout(() => { if (id === run) mouthOff(); }, talkMs);
    timer = setTimeout(() => captionsOnly(lines, id, i + 1), talkMs + 800);
  }

  function speak(lines, id) {
    const voice = pickVoice(synth);
    let started = false;
    bubble.removeAttribute("aria-live"); // it is being spoken; don't say it twice
    // Queue every sentence now, inside the click: phones only allow speech
    // that begins from a tap, and short utterances avoid Chrome's habit of
    // cutting off a long one.
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-GB";
      u.rate = 1; u.pitch = 1.1;
      u.onstart = () => { if (id === run) { started = true; show(lines, i); mouthOn(); } };
      // Where the browser reports word boundaries, shut the beak on each one,
      // which keeps it roughly in step with the words.
      u.onboundary = () => { if (id === run) beak(0); };
      u.onend = () => { if (id !== run) return; mouthOff(); if (i === lines.length - 1) finish(id); };
      u.onerror = () => { if (id === run && !started) { run += 1; captionsOnly(lines, run); } };
      synth.speak(u);
    });
    // Muted device, blocked audio, or no voices installed: don't sit in silence.
    timer = setTimeout(() => {
      if (id !== run || started) return;
      synth.cancel();
      run += 1;
      captionsOnly(lines, run);
    }, 3000);
  }

  function stop() {
    run += 1;
    clearTimeout(timer);
    if (synth) synth.cancel();
    mouthOff();
    host.classList.remove("talking", "mood-cheer", "mood-glum", "wave-l", "wave-r");
    button.textContent = LABEL;
  }

  function start() {
    const m = getModel();
    if (!m) return;
    stop();
    const id = run;
    const lines = buildCommentary(m);
    host.hidden = false;
    host.classList.add("talking");
    button.textContent = "⏹ Stop";
    show(lines, 0);
    if (synth) speak(lines, id); else captionsOnly(lines, id);
    host.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  button.addEventListener("click", () => (host.classList.contains("talking") ? stop() : start()));
  host.querySelector(".commentator-close").addEventListener("click", () => { stop(); host.hidden = true; });
  // Speech would otherwise carry on after leaving the page.
  window.addEventListener("pagehide", stop);
}
