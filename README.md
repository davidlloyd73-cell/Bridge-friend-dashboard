# Bridge Friends — Live Dashboard

A single-page, self-refreshing scoreboard for our 4-player virtual bridge game
(**David, Vivienne, Hamish, Caroline**). It reads **live** from the Google Sheet
that your Google Form feeds, and re-renders itself automatically — once it's
live you never have to touch it.

**Live URL (after you turn on GitHub Pages):**
👉 https://davidlloyd73-cell.github.io/Bridge-friend-dashboard/

- No build step, no server, no frameworks — just static HTML/CSS/JS.
- Polls the sheet every 60 seconds and only re-draws when something changed.
- Two line charts (all-time race + 2026 race) via Chart.js from a CDN.

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
| `index.html` | Page structure + the Chart.js CDN tag. |
| `styles.css` | All styling. The four **player colours** are defined once at the top as CSS variables. |
| `app.js`     | Fetches the sheet, parses it defensively, computes all the stats, renders, and runs the 60-second polling loop. |
| `config.js`  | **The file you edit.** API key, sheet ID, range, refresh interval, form link. |
| `README.md`  | This file. |

### Player colours
David = **blue**, Vivienne = **green**, Hamish = **orange**, Caroline =
**purple**. To change them, edit the `--c-*` variables at the top of
`styles.css` **and** the matching hex values in the `COLORS` object near the top
of `app.js` (charts read the hex directly).

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
