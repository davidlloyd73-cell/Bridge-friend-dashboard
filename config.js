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

  // <-- PASTE YOUR API KEY HERE (keep the quotes):
  API_KEY: "PASTE_YOUR_API_KEY_HERE",

  // The raw form-data tab and the columns to read. Do NOT point this at a
  // pivot/dashboard tab — those can be restructured. A:L is the raw form data.
  // The tab is named "Form responses 1" (note: it must be URL-encoded when
  // building the request; app.js handles that for you).
  RANGE: "Form responses 1!A:L",

  // How often (milliseconds) to re-check the sheet for new hands. 60000 = 60s.
  REFRESH_MS: 60000,

  // Footer "Add a hand" button links here.
  FORM_URL: "https://forms.gle/CbhLPMDwWYKDZpAr8",

  // The four fixed players. Anything else is bucketed into "Unknown".
  PLAYERS: ["David", "Vivienne", "Hamish", "Caroline"],
};
