# Bridge Friends — Live Dashboard

A single-page, self-refreshing scoreboard for our 4-player virtual bridge game
(**David, Vivienne, Hamish, Caroline**). It reads **live** from the Google Sheet
that your Google Form feeds, and re-renders itself automatically — once it's
live you never have to touch it.

**Live URL (after you turn on GitHub Pages):**
👉 https://davidlloyd73-cell.github.io/Bridge-friend-dashboard/

- No build step, no server, no frameworks — just static HTML/CSS/JS.
- Polls the sheet every 60 seconds and only re-draws when something changed.
- Two line charts (all-time race + current-round race) via Chart.js from a CDN.
- Click either chart to magnify it: the panel widens and doubles in height, and
  the view narrows to the last 10 sessions on an axis fitted to those scores —
  which is what actually separates four players finishing close together.
  Click again (or press Escape) to go back.

---

## 🟢 One-time setup (David does this once)

You only need to do **three** things. Steps 1–2 are in Google; step 3 is on GitHub.

### 1. Get a Google Sheets API key

1. Go to **https://console.cloud.google.com/** and sign in.
2. Top bar → **Select a project** → **New Project** → give it any name (e.g.
   "Bridge Dashboard") → **Create**. Make sure that project is selected.
3. Left menu → **APIs & Services → Library**. Search **"Google Sheets API"**,
   click it, then click **Enable**.
4. Left menu → **APIs & Services → Credentials** → **+ Create credentials** →
   **API key**. A key like `AIzaSy...` appears. **Copy it.**
5. (Recommended) Click **Edit API key** on that key:
   - **API restrictions** → choose **Restrict key** → tick **Google Sheets API** → **Save**.
   - (Optional, extra safety) **Application restrictions → HTTP referrers** →
     add `https://davidlloyd73-cell.github.io/*` so only your site can use the key.

### 2. Paste the key into `config.js`

Open **`config.js`** in this repo (GitHub lets you edit it in the browser:
open the file → pencil icon). Find this line:

```js
API_KEY: "PASTE_YOUR_API_KEY_HERE",
```

Replace `PASTE_YOUR_API_KEY_HERE` with your key (keep the quotes), then commit.
That's the **only** value you normally ever need to change.

### 3. Make the sheet readable by the key

An API key can only read a sheet that's shared publicly for viewing. In the
Google Sheet:

> **Share** → under **General access** choose **"Anyone with the link"** →
> set the role to **Viewer** → **Done**.

(It's scores only, so this is fine.)

### 4. Turn on GitHub Pages

In this GitHub repository:

1. Click **Settings** (top of the repo).
2. In the left sidebar click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, pick **`main`** and folder **`/ (root)`** → click **Save**.
5. Wait ~1 minute, then refresh the Pages settings page. It will show:
   **"Your site is live at https://davidlloyd73-cell.github.io/Bridge-friend-dashboard/"**

Open that URL — the dashboard is live. 🎉

---

## ✅ Test checklist (do this once after it's live)

1. Open the live URL on your phone and on a computer. You should see totals,
   the latest hand, the standings table, and two charts.
2. Open the Google Form (**https://forms.gle/CbhLPMDwWYKDZpAr8**) and submit a
   **test hand** (any player, any score).
3. Wait up to ~2 minutes (the page checks every 60s). The new hand should
   appear in **Latest hand** and the totals should tick up — **without you
   refreshing the page**. You can also click **↻ Refresh now** to force it.
4. (Optional) Open the browser's developer **Console** (F12). On first load the
   page prints a verification report: total rows, number of sessions, each
   player's grand total, and the latest hand. Use it to sanity-check the data.
5. If you submitted a junk test row, delete that row in the sheet; it'll vanish
   from the dashboard on the next refresh.

---

## 🧰 How the live update works (plain English)

- Every 60 seconds the page quietly asks Google for the contents of the
  **`Form responses 1`** tab (columns **A:L** — the raw form data).
- It compares the new data to the last data it saw (row count + newest
  timestamp). If nothing changed, it does nothing. If something changed, it
  recomputes every total and redraws the charts.
- If the internet hiccups or Google is briefly unreachable, the page keeps
  showing the **last good data**, shows a small "couldn't reach the sheet,
  retrying…" note, and backs off politely before trying again.

---

## 📁 Files

| File         | What it is |
|--------------|------------|
| `index.html` | Page structure (the Bridge dashboard; `hub.html` is the news hub) + the Chart.js CDN tag. |
| `styles.css` | Dashboard styling. Imports `tokens.css`; declares no colours of its own. |
| `bridge-puzzle.js` | The hub's **Bridge problem** window: deals a random hand and works out the answer from Andrew Robson's flip chart (cards 1–17, 19–26, plus the Conventions flipper's Losing Trick Count, Stayman, Weak Twos, Transfers and Coping with Intervention pages). House agreements: Acol 12–14 1NT, **Three Weak Twos** (so 20–22 unbalanced opens one of a suit; card 18's strong twos aren't used), **transfers** over 1NT/2NT, card 3's points line for raises, LTC for opener after a raise. Bidding, defence (leads, 2nd/3rd/4th hand, covering) and declarer "which card first?" problems. Hands the chart doesn't clearly settle are thrown away and re-dealt. Also signalling (card 26) and a doubled-scoring quiz (card 13). Pure logic, no page code. |
| `puzzle-ui.js` / `puzzle.css` | Draws that window: auction grid (N E S W, dealer and "You" marked), your hand by suit, a bidding box with only legal bids or clickable cards, then right/wrong with the reason and **Next problem**. `hub.html?p=<number>` reopens a problem by its number. |
| `scripts/test_puzzle.mjs` | Tests for the problems: the flip chart's own examples plus 20,000 generated problems. Run `node scripts/test_puzzle.mjs` after changing a rule. |
| `nightcheck.js` | **Tonight's check** at the top of the Tonight tab: slips in the current session's entries, so they can be fixed while everyone's still at the table. "Fix" (changes the scores): a missing or doubled entry, a mistyped hand number (with a suggested correction, e.g. 696 → 896), or points that don't pair up (partners score the same; only one side scores). "Check": partners disagree on the contract or tricks. Hands still being entered (last entry under 4 minutes ago) are left alone; the panel disappears 18 hours after the session. A new "Fix" pops up a notice too. |
| `art/` | Cartoon artwork made for this site with OpenAI's image model (21 Nov 2026): the Bridge page banner (`banner-*.webp`, hidden inside the hub's window), the Kibitzer owl badge on the hub's Bridge problem box (`kibitzer-256.webp`), and the trophy shown on the Race page when a round is won (`trophy-512.webp`). Originals are in David's Downloads. |
| `switch.css` | The big **♠ Bridge \| 📰 Hub** switch at the top of `index.html` and `hub.html`. The page you're on is lit gold; tap the other half to go there. It hides itself when the dashboard is shown inside the hub's Bridge window, so you never see two. |
| `tokens.css` | **All design tokens** — the navy/teal/gold palette, player colours, shadow, radius and the three font stacks. Shared by both pages; edit a colour here and both follow. |
| `app.js`     | Fetches the sheet, parses it defensively, computes all the stats, renders, and runs the 60-second polling loop. |
| `config.js`  | **The file you edit.** API key, sheet ID, range, refresh interval, form link, the current **round**, and when one **night** of play ends. |
| `data.js`    | Shared fetch/parse/compute — used by both `app.js` and `race.js` so the two pages can't disagree. |
| `commentator.js` | The **🎙 State of play** button on the Tonight tab: a cartoon owl ("The Kibitzer") reads out who won the last hand, who leads tonight and who is allowed to whinge (fewest HCP dealt). Uses the browser's built-in speech — no key, no AI service, nothing leaves the page; if the device can't speak, the speech bubble steps through the same sentences silently. The owl is animated: its beak moves only while a sentence is being said, a wing lifts at each new sentence, and it looks pleased for good news and glum for the whinge. With "reduce motion" switched on, the swaying and waving stop but the beak and expressions stay. |
| `race.html` / `race.js` / `race.css` | The live "Race to 50,000" page. |
| `README.md`  | This file. |

### 🏆 Who wins the round, and when the next one starts

House rules (agreed 21 Nov 2026):

1. **First to reach the target wins**, on the exact hand it happens. Someone
   who overtakes later that night doesn't take it away.
2. **The round runs to the end of that night.** Every hand that night still
   counts towards the round's final standings.
3. **The next round starts by itself** with the next night that has hands:
   "Round 2" becomes "Round 3", with the same target. Nobody needs to edit
   `config.js`.

How "first" is decided:

- Hands are taken in the order they were played: by night, then by when the
  hand was first logged on the form (so a mistyped hand number can't reorder
  them), then by hand number.
- All four entries for a hand count together, so partners who cross on the
  same hand aren't split by who filled in the form first. If two players cross
  on the same hand, the higher total wins, and an exact tie is a shared win.
- A hand played after midnight still belongs to the evening it started (see
  *Sessions that run past midnight*), so it never opens a new round on its own.

This is all worked out in one place, `data.js` (`findFinish` and
`rollRounds`), which gives every page `model.finish` (the current round's
winner, if any), `model.pastRounds` (each finished round's winner, winning
hand and final standings) and the current `ROUND`. The race page (banner and
**Honours** list), the dashboard headline, the 50,000 milestone, the
celebration toasts and the WhatsApp recap all read those, so they can't
disagree. The browser console on the race page lists every finished round.

### 🏁 Starting a new round

The race is **not** tied to a calendar year. Everything round-scoped — the round
standings cards and table, the round chart, and the whole race page — comes from
one block in `config.js`:

```js
ROUND: {
  LABEL: "Round 2",        // shown in headings, column headers and footnotes
  START: "10/07/2026",     // dd/mm/yyyy, INCLUSIVE — the first session of the round
  TARGET: 50000,           // points needed to win
  AUTO_NEXT: true,         // start the next round by itself once this one is won
},
```

You normally **don't** need to touch this: each round starts by itself (see
above), and `START` only has to mark where the counting begins. Edit it by
hand only to change the target, rename the rounds, or restart the counting
from a particular night (set `AUTO_NEXT: false` to turn the automatic rounds
off). If you do, change those values — nothing else. All-time
totals and the all-time chart are unaffected. Open the browser console
afterwards: a **"round scoping verification"** group prints each player's round
total next to the raw column-L sum, plus the list of sessions in the round, so
you can confirm the new start date took effect.

(The `<h1>` and `<title>` on `race.html` still say "Race to 50,000" — if you ever
change `TARGET`, edit those two lines by hand.)

### 🌙 Sessions that run past midnight

A session is a **night** of bridge, not a calendar day. When play carries on past
midnight the form's date rolls over with the clock, which used to split one
evening into two sessions — two rows on the standings, two points on the chart,
and "This session" resetting to a single hand at 00:01.

One value in `config.js` decides where one night ends and the next begins:

```js
SESSION: {
  NIGHT_ENDS_AT_HOUR: 5,   // 0-23, local time
},
```

At `5`, a hand logged at 01:30 on Sunday belongs to **Saturday** night's session;
one logged at 05:30 starts Sunday's own session. Set it to `0` for plain calendar
days (the old behaviour).

A hand only moves back a day when **both** of these hold, so this can never
quietly relabel something else:

* its submission time (column A) says it was played in the small hours of the
  very day the form's date box (column B) names — that agreement is exactly what
  the midnight rollover looks like; **and**
* the evening before actually has hands to join.

So a hand typed in the next afternoon stays on the date you gave it, a hand
played at 23:50 but submitted at 00:05 was never split in the first place, and a
game that genuinely begins after midnight keeps its own date.

The merged session is shown under the evening it **started**, with a note saying
when it finished ("ran to 01:35 the next morning") so the second date isn't
silently missing. The browser console's **"round scoping verification"** group
lists every session that ran past midnight, the form dates it merged, and its
last hand's time.

One consequence worth knowing: a round boundary now cuts between whole nights.
If `ROUND.START` is a Monday and you played Sunday evening into the small hours
of Monday, those small-hours hands belong to Sunday's session and sit **outside**
the round — where before they would have counted. The verification group flags it
if the round's first session isn't the date you configured.

### ♻️ Cache-busting

Both HTML files load their scripts with a `?v=` query, `app.js`/`race.js`/`data.js`
carry the **same** query on their `./data.js` and `./config.js` imports, and
`styles.css`/`race.css` carry it on their `@import` of `tokens.css`. When you
change anything, bump that value **everywhere** — each of those is a separate
fetch, so bumping only the `<script>` tags would leave browsers running a cached
`data.js` (where most of the logic lives) or a cached `tokens.css` (where every
colour lives). The hub (`hub.html`) uses the same value on its own files, and
both `index.html` and `hub.html` load `switch.css` with it. Thirty-two places in
total, counting `hub.html`'s `puzzle.css` and `puzzle-ui.js` and that file's
import of `bridge-puzzle.js`; grep for the current value to find them.

### Player colours
David = **blue**, Vivienne = **green**, Hamish = **orange**, Caroline =
**purple**. To change them, edit the `--c-*` variables at the top of
`tokens.css` (`--c-david` … `--c-unknown`) **and** the matching hex values in the
`COLORS` object near the top of `data.js` — Chart.js draws to canvas and cannot
read a CSS custom property, so those two lists are kept in step by hand.

---

## 🖥️ Running it locally (optional, for tinkering)

Because `app.js` uses ES modules, open it through a tiny web server rather than
double-clicking the file:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

You'll still need a valid API key in `config.js` for data to load.

---

## 🔐 A note on the API key

The key lives in `config.js`, which is part of a public static site, so anyone
who views the page can read it. **That's acceptable here** because the sheet
only contains non-sensitive bridge scores, and the sheet is shared read-only.
Restricting the key to the Google Sheets API (step 1.5) means a copied key can't
be used for anything else, and the optional HTTP-referrer restriction means it
only works from your own site.
