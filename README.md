# 👻 Ghost Jobs Detector

A **Manifest V3 Chrome Extension** that acts as a visual sandbox for detecting ghost job listings on LinkedIn. It injects a clean, modern, theme-aware analytics card into LinkedIn job detail pages, displaying our signature scoring formula components alongside an aggregated **Ghost Risk %** gauge.

> ⚠️ **Frontend sandbox only.** All scoring data is mocked via an internal async function that simulates a 500 ms backend call. No real backend, API, or Next.js server is deployed yet.

---

## ✨ Features

- **LinkedIn job listing click tracking** — detects clicks on job cards in `/jobs/view/*`, `/jobs/collections/*`, and `/jobs/search/*`.
- **Automatic data extraction** — reads **Company Name**, **Job Title**, and **Job Description** text from the active LinkedIn job description panel.
- **SPA navigation aware** — patches `history.pushState`/`replaceState` + a `MutationObserver` so the card re-injects on every job view change.
- **Internal async mock backend** — simulates a 500 ms API latency, then returns a structured JSON payload with the signature formula.
- **Signature scoring formula components:**
  - **Text DNA Match Risk** — lexical fingerprint vs. known ghost-post templates.
  - **Cross-Platform Desynchronization Status** — consistency of posting age/metadata across platforms.
  - **Legal Salary Transparency Compliance** — regional salary-disclosure mandate adherence.
- **Aggregated Ghost Risk % gauge** — weighted blend of the three components, rendered as an animated SVG ring.
- **Theme-aware UI** — auto-detects LinkedIn's native dark/light theme and matches surface colors, borders, and typography.
- **Loading skeleton** — shimmer animation while the mock backend "thinks".

---

## 📁 Project Structure

```
ghost-jobs-detector/
├── manifest.json              # MV3 manifest
├── content.js                 # Content script: tracking, extraction, mock backend, UI injection
├── styles.css                 # Theme-aware card styles (.gjd-* namespaced)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── generate-icons.js      # Dependency-free Node PNG icon generator
└── README.md
```

---

## 🚀 Load the Unpacked Extension Locally

1. **Download / clone this repo** to a local folder, e.g.:
   ```bash
   git clone https://github.com/<your-user>/ghost-jobs-detector.git
   cd ghost-jobs-detector
   ```
   (If you already have the folder, skip cloning — just open it.)

2. **Open Chrome** (or any Chromium browser: Edge, Brave, Arc) and navigate to:
   ```
   chrome://extensions
   ```

3. **Enable Developer Mode** — toggle the switch in the top-right corner of the extensions page.

4. **Load Unpacked** — click the **"Load unpacked"** button (top-left), then select the `ghost-jobs-detector` folder (the one containing `manifest.json`).

5. **Pin it** (optional) — click the puzzle-piece icon in Chrome's toolbar and pin **Ghost Jobs Detector** for quick access.

6. **Test it** — open a LinkedIn job page:
   - Go to [https://www.linkedin.com/jobs](https://www.linkedin.com/jobs)
   - Click any job listing in the search results, **or** open a direct `/jobs/view/<id>` URL.
   - The Ghost Jobs Detector card will prepend inside the top of the job description panel, show a brief loading skeleton, then display the full analysis with the Ghost Risk gauge.

7. **Reload after edits** — if you change any source files, return to `chrome://extensions` and click the **↻ reload** icon on the Ghost Jobs Detector card. Hard-refresh the LinkedIn tab with `Cmd+Shift+R` (mac) / `Ctrl+Shift+R` (win).

### 🧪 Verifying It Works

- Open **DevTools → Console** on a LinkedIn job page; you should see logs prefixed with `[Ghost Jobs Detector]`.
- The card appears at the top of the job description panel (right-hand detail view).
- Navigating between job listings via clicks or the back/forward buttons re-triggers analysis with a fresh score (scores are deterministic per job, so the same posting always yields the same mocked score).

---

## 🧠 The Mock Scoring Payload

The internal `fetchGhostScore(job)` function returns this structure (after a 500 ms delay):

```jsonc
{
  "meta": {
    "jobId": "4012345678",
    "analyzedAt": "2026-06-29T04:00:00.000Z",
    "engineVersion": "0.1.0-mock",
    "latencyMs": 500,
    "mock": true
  },
  "signatureFormula": {
    "textDnaMatchRisk": 73,                 // 0–100
    "crossPlatformDesynchronizationStatus": {
      "status": "DESYNCED",                 // SYNCED | PARTIAL_SYNC | DESYNCED
      "confidence": 88,                     // 0–100
      "daysStale": 47,
      "platformsChecked": ["LinkedIn", "Company Careers", "Indeed", "Glassdoor"]
    },
    "legalSalaryTransparency": {
      "compliant": false,
      "disclosurePresent": false,
      "jurisdiction": "US-STATE-LAW",
      "penaltyRiskLevel": "HIGH"            // LOW | MEDIUM | HIGH
    }
  },
  "ghostRisk": 71,                          // 0–100 aggregated
  "verdict": "HIGH_RISK_GHOST"              // HIGH_RISK_GHOST | SUSPICIOUS | LIKELY_REAL
}
```

The aggregated **Ghost Risk %** is a weighted blend: `TextDNA × 0.5 + Desync × 0.3 + Salary × 0.2`.

---

## 🎨 Theme Support

The card auto-detects LinkedIn's theme via:
1. `<html data-theme="dark">`
2. `<html data-color-scheme="...">`
3. Computed background luminance of the app root
4. `prefers-color-scheme` media query (fallback)

All styles are scoped under the `.gjd-*` namespace and use CSS custom properties, so they never collide with LinkedIn's own stylesheets.

---

## 🔧 Regenerating Icons

Icons are committed, but you can regenerate them anytime:

```bash
node scripts/generate-icons.js
```

This is a zero-dependency Node script (uses only built-in `zlib`) that renders a purple gradient tile with a stylized ghost mark at 16/48/128 px.

---

## 🗺️ Roadmap (Not Yet Implemented)

- [ ] Real backend API (Next.js route handlers / serverless) replacing the mock
- [ ] Persistent job history & analytics dashboard
- [ ] True cross-platform posting sync checks
- [ ] Real Text-DNA model (NLP lexical fingerprinting)
- [ ] Salary transparency jurisdiction database

---

## 📜 License

MIT — built by Casey for the Ghost Jobs Detector venture.