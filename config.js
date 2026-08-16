// =============================================================================
// config.js  —  EDIT THIS FILE (it's the only one you normally need to touch)
// =============================================================================
//
// 1) PASTE YOUR GOOGLE SHEETS API KEY BELOW (replace PASTE_YOUR_API_KEY_HERE).
//
//    How to get one (full step-by-step is in README.md):
//      • https://console.cloud.google.com/  → create a project
//      • APIs & Services → Library → "Google Sheets API" → Enable
//      • APIs & Services → Credentials → Create credentials → API key
//      • Copy the key and paste it between the quotes below.
//
// 2) SECURITY REMINDER (please do this):
//    A Sheets API key in a static website IS VISIBLE to anyone who visits the
//    page. That is ACCEPTABLE here because the sheet only holds non-sensitive
//    bridge scores. To limit abuse of the key anyway:
//      • In Google Cloud → Credentials → "Edit API key":
//          - Under "API restrictions": restrict the key to **Google Sheets API** only.
//          - (Optional) Under "Application restrictions" → "HTTP referrers",
//            add your GitHub Pages domain so only your site can use the key, e.g.
//                https://davidlloyd73-cell.github.io/*
//
// 3) MAKE THE SHEET READABLE BY THE KEY:
//    An API key can only read sheets shared as "Anyone with the link → Viewer".
//    In the Sheet: Share → General access → "Anyone with the link" → Viewer.
//
// =============================================================================

export const CONFIG = {
  // The Google Sheet that is fed by the Google Form (4 submissions per hand).
  SHEET_ID: "1QdWqUcw3ykjQVaY7kCdEtVthWS5ACqNi3TuXTMRpm5w",

  // <-- YOUR API KEY (restrict it to the Google Sheets API in Google Cloud):
  API_KEY: "AIzaSyDg1fLon3J9D7eStEx4Bz0nCQvENN-QCR8",

  // The raw form-data tab and the columns to read. Do NOT point this at a
  // pivot/dashboard tab — those can be restructured. A:L is the raw form data.
  // The tab is named "Form responses 1" (note: it must be URL-encoded when
  // building the request; app.js handles that for you).
  RANGE: "Form responses 1!A:L",

  // How often (milliseconds) to re-check the sheet for new hands. 60000 = 60s.
  REFRESH_MS: 60000,

  // Give up on a request after this long (milliseconds) and report it.
  //
  // A stalled request is NOT an error: fetch() simply never settles, so without
  // this the page waits forever showing "Loading…" and looks like it has
  // crashed. Google can leave a spreadsheet unresponsive for minutes at a time
  // (heavy edits, a big paste, or a blip at their end) while the rest of the
  // Sheets API answers normally. Capping the wait turns that into a visible
  // "couldn't reach the sheet, retrying" with the usual backoff behind it.
  // A healthy read of the full sheet takes well under a second.
  FETCH_TIMEOUT_MS: 15000,

  // Footer "Add a hand" button links here.
  FORM_URL: "https://forms.gle/CbhLPMDwWYKDZpAr8",

  // The four fixed players. Anything else is bucketed into "Unknown".
  PLAYERS: ["David", "Vivienne", "Hamish", "Caroline"],

  // ---------------------------------------------------------------------------
  // THE CURRENT ROUND (the "Race to 50,000").
  //
  // Everything round-scoped — the standings cards/table, the round chart and the
  // whole race page — is derived from these three values. Nothing anywhere is
  // tied to a calendar year, so starting a fresh round is a one-line edit here:
  //   • LABEL  — shown in headings, column headers and footnotes ("Round 3").
  //   • START  — dd/mm/yyyy, INCLUSIVE. The first session of the round; sessions
  //              dated on or after this day count, everything earlier does not.
  //   • TARGET — points needed to win the round.
  // The all-time totals and the all-time chart are unaffected by this block.
  // ---------------------------------------------------------------------------
  ROUND: {
    LABEL: "Round 2",
    START: "10/07/2026",
    TARGET: 50000,
  },
};
