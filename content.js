/*
 * Ghost Jobs Detector — content.js
 * Manifest V3 content script for LinkedIn job pages (/jobs/view/*, /jobs/collections/*, /jobs/search/*)
 *
 * Responsibilities:
 *  1. Detect navigation to job detail views (LinkedIn is a SPA → patch history methods + observe DOM).
 *  2. Track clicks on job listings and extract Company Name, Job Title, Job Description text.
 *  3. Call an internal async MOCK backend (500ms) that returns the signature scoring payload.
 *  4. Inject a clean, modern, theme-aware card widget at the top of the job description panel.
 *
 * This is a VISUAL SANDBOX: all scoring data is mocked. No real backend is contacted.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration & state
  // ---------------------------------------------------------------------------
  const LOG_PREFIX = "%c[Ghost Jobs Detector]";
  const LOG_STYLE = "color:#7c3aed;font-weight:bold;";
  const CARD_ID = "gjd-ghost-risk-card";
  const PROCESSED_ATTR = "data-gjd-processed";
  let lastJobSignature = "";
  let isInjecting = false;

  const log = (...args) => console.log(LOG_PREFIX, LOG_STYLE, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, LOG_STYLE, ...args);

  // ---------------------------------------------------------------------------
  // Theme detection — match LinkedIn's native dark / light theme
  // ---------------------------------------------------------------------------
  function detectTheme() {
    // LinkedIn sets theme via <html data-theme="..."> or body background.
    const htmlTheme = document.documentElement.getAttribute("data-theme") || "";
    if (htmlTheme.toLowerCase().includes("dark")) return "dark";

    const explicit = document.documentElement.getAttribute("data-color-scheme");
    if (explicit === "dark") return "dark";
    if (explicit === "light") return "light";

    // Fallback: sample computed background of the app root.
    const probe = document.querySelector(".application-outlet, #extended-nav, body");
    if (probe) {
      const bg = window.getComputedStyle(probe).backgroundColor || "";
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5 ? "dark" : "light";
      }
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // ---------------------------------------------------------------------------
  // Data extraction — reads Company Name, Job Title, Job Description from the
  // active LinkedIn job description panel layout.
  // ---------------------------------------------------------------------------
  const SELECTORS = {
    // Robust cascade of injection anchors — any one of these structural
    // containers is sufficient. Ordered from most-specific to broadest fallback.
    descriptionPanel: [
      ".jobs-description__container",
      "#job-details",
      ".jobs-description__content",
      ".jobs-description-content",
      ".jobs-box__html-content",
      "div.jobs-description",
      "article.jobs-description",
      ".job-details-jobs-unified-top-card",
    ],
    jobTitle: [
      ".job-details-jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__job-title",
      ".t-24.t-bold.inline",
      "h1.topcard__title",
      "h1.job-details-jobs-unified-top-card__job-title",
    ],
    company: [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
      ".job-details-people-who-applied__company-name",
    ],
    descriptionText: [
      ".jobs-description__content .jobs-description__content",
      ".jobs-description__content",
      ".jobs-box__html-content",
      ".jobs-description-content",
    ],
  };

  function queryFirst(selectorList, root = document) {
    for (const sel of selectorList) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function extractJobData() {
    const titleEl = queryFirst(SELECTORS.jobTitle);
    const companyEl = queryFirst(SELECTORS.company);
    const descEl = queryFirst(SELECTORS.descriptionText);

    const jobTitle = cleanText(titleEl?.innerText || "");
    const companyName = cleanText(companyEl?.innerText || "");
    const jobDescription = cleanText(descEl?.innerText || "");

    const url = location.href;
    const jobIdMatch = url.match(/\/jobs\/(?:view|collections|search)\/?(\d+)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : url;

    return {
      jobId,
      jobTitle: jobTitle || "(title not found)",
      companyName: companyName || "(company not found)",
      jobDescription: jobDescription || "(description not found)",
      descriptionLength: jobDescription.length,
      url,
      extractedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Click tracking on job listings
  // ---------------------------------------------------------------------------
  function attachClickTracking() {
    document.addEventListener(
      "click",
      (e) => {
        // Walk up to find a job-listing row.
        const row = e.target.closest(
          [
            ".jobs-search-results__list-item",
            ".job-card-container",
            ".job-card-job-posting-card-wrapper",
            "li.jobs-search-results__list-item",
            "[data-job-id]",
          ].join(",")
        );
        if (!row) return;

        const jobId =
          row.getAttribute("data-job-id") ||
          row
            .querySelector("a[href*='/jobs/view/']")
            ?.getAttribute("href")
            ?.match(/\/jobs\/view\/(\d+)/)?.[1] ||
          "unknown";

        log("🖱️  Job listing clicked →", { jobId, preview: cleanText(row.innerText).slice(0, 80) });

        // LinkedIn swaps the detail panel via SPA; re-evaluate shortly after.
        setTimeout(() => handleJobViewChange(), 450);
        setTimeout(() => handleJobViewChange(), 1000);
      },
      true
    );
    log("Click tracking attached to job listings.");
  }

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------
  function patchHistoryMethods() {
    const wrap = (type) => {
      const orig = history[type];
      history[type] = function (...args) {
        const rv = orig.apply(this, args);
        window.dispatchEvent(new CustomEvent("gjd:locationchange", { detail: { type } }));
        return rv;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () =>
      window.dispatchEvent(new CustomEvent("gjd:locationchange", { detail: { type: "popstate" } }))
    );
    window.addEventListener("gjd:locationchange", () => setTimeout(handleJobViewChange, 300));
    log("History methods patched for SPA navigation.");
  }

  function isJobViewUrl(url = location.href) {
    return /linkedin\.com\/jobs\/(view|collections|search)/.test(url);
  }

  // ---------------------------------------------------------------------------
  // MOCK backend — simulates an async API call (500ms) returning the signature
  // scoring formula payload. Replaces the future real backend for the sandbox.
  // ---------------------------------------------------------------------------
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  function deterministicPseudo(seed) {
    // Mulberry32 PRNG seeded by job signature hash → stable mock scores.
    const t = (seed += 0x6d2b79f5);
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Simulates a backend API call to the Ghost Jobs scoring service.
   * @param {{jobTitle:string, companyName:string, jobDescription:string}} job
   * @returns {Promise<object>} structured scoring payload
   */
  async function fetchGhostScore(job) {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(500); // simulated network latency

    const seed = hashString(`${job.companyName}|${job.jobTitle}|${job.jobDescription.slice(0, 200)}`);

    // --- Text DNA Match Risk (0–100) ---
    // How closely the JD's lexical fingerprint matches known ghost-post templates.
    const textDnaMatchRisk = Math.round(15 + deterministicPseudo(seed) * 80); // 15–95

    // --- Cross-Platform Desynchronization Status ---
    // Is the posting's age/metadata inconsistent across platforms?
    const desync = deterministicPseudo(seed + 7);
    const crossPlatformDesyncStatus = {
      status: desync > 0.66 ? "DESYNCED" : desync > 0.33 ? "PARTIAL_SYNC" : "SYNCED",
      confidence: Math.round(40 + deterministicPseudo(seed + 11) * 60),
      daysStale: Math.floor(deterministicPseudo(seed + 13) * 120),
      platformsChecked: ["LinkedIn", "Company Careers", "Indeed", "Glassdoor"],
    };

    // --- Legal Salary Transparency Compliance ---
    // Whether the posting satisfies regional salary-disclosure mandates.
    const salaryScore = deterministicPseudo(seed + 19);
    const salaryPresent = /salary|compensation|\$\d|k\/yr|per year/i.test(job.jobDescription);
    const legalSalaryTransparency = {
      compliant: salaryPresent ? salaryScore > 0.3 : salaryScore > 0.75,
      disclosurePresent: salaryPresent,
      jurisdiction: navigator.language?.includes("US") ? "US-STATE-LAW" : "EU-PAY-TRANSPARENCY",
      penaltyRiskLevel: salaryPresent ? (salaryScore > 0.7 ? "LOW" : "MEDIUM") : "HIGH",
    };

    // --- Aggregated Ghost Risk % ---
    // Weighted blend of the three signature components.
    const ghostRisk = Math.round(
      Math.min(
        99,
        textDnaMatchRisk * 0.5 +
          (crossPlatformDesyncStatus.status === "DESYNCED"
            ? 85
            : crossPlatformDesyncStatus.status === "PARTIAL_SYNC"
            ? 45
            : 12) *
            0.3 +
          (legalSalaryTransparency.compliant ? 10 : 70) * 0.2
      )
    );

    return {
      meta: {
        jobId: job.jobId,
        analyzedAt: new Date().toISOString(),
        engineVersion: "0.1.0-mock",
        latencyMs: 500,
        mock: true,
      },
      signatureFormula: {
        textDnaMatchRisk, // 0–100
        crossPlatformDesynchronizationStatus: crossPlatformDesyncStatus, // object
        legalSalaryTransparency, // object
      },
      ghostRisk, // 0–100 aggregated
      verdict:
        ghostRisk >= 70 ? "HIGH_RISK_GHOST" : ghostRisk >= 40 ? "SUSPICIOUS" : "LIKELY_REAL",
    };
  }

  // ---------------------------------------------------------------------------
  // UI Injection — clean, modern, theme-aware card widget
  // ---------------------------------------------------------------------------
  function ensureStyles(theme) {
    if (document.getElementById("gjd-styles")) return;
    const link = document.createElement("link");
    link.id = "gjd-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("styles.css");
    document.head.appendChild(link);
  }

  function riskColor(risk) {
    if (risk >= 70) return { stroke: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "High Risk" };
    if (risk >= 40) return { stroke: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "Suspicious" };
    return { stroke: "#10b981", bg: "rgba(16,185,129,0.12)", label: "Likely Real" };
  }

  function buildGauge(risk, theme) {
    const { stroke } = riskColor(risk);
    const r = 52;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - risk / 100);
    const trackColor = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

    return `
      <div class="gjd-gauge-wrap">
        <svg class="gjd-gauge" viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="${trackColor}" stroke-width="10"/>
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="${stroke}" stroke-width="10"
            stroke-linecap="round"
            stroke-dasharray="${circ.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
            transform="rotate(-90 60 60)"
            style="transition:stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)"/>
          <text x="60" y="56" text-anchor="middle" class="gjd-gauge-pct" fill="${stroke}">${risk}%</text>
          <text x="60" y="76" text-anchor="middle" class="gjd-gauge-sub" fill="currentColor">Ghost Risk</text>
        </svg>
      </div>
    `;
  }

  function buildMetricRow({ name, value, barPct, detail, accent }) {
    const pct = Math.max(0, Math.min(100, Math.round(barPct)));
    return `
      <div class="gjd-metric">
        <div class="gjd-metric-head">
          <span class="gjd-metric-name">${name}</span>
          <span class="gjd-metric-value" style="color:${accent}">${value}</span>
        </div>
        <div class="gjd-metric-bar">
          <div class="gjd-metric-fill" style="width:${pct}%;background:${accent}"></div>
        </div>
        ${detail ? `<div class="gjd-metric-detail">${detail}</div>` : ""}
      </div>
    `;
  }

  function buildCard(job, score, theme) {
    const { stroke, bg, label } = riskColor(score.ghostRisk);
    const desync = score.signatureFormula.crossPlatformDesynchronizationStatus;
    const salary = score.signatureFormula.legalSalaryTransparency;
    const desyncPct =
      desync.status === "DESYNCED" ? 90 : desync.status === "PARTIAL_SYNC" ? 50 : 15;
    const salaryPct = salary.compliant ? 25 : 80;

    const desyncAccent = desync.status === "DESYNCED" ? "#ef4444" : desync.status === "PARTIAL_SYNC" ? "#f59e0b" : "#10b981";
    const salaryAccent = salary.compliant ? "#10b981" : "#ef4444";

    return `
      <section id="${CARD_ID}" class="gjd-card" data-theme="${theme}">
        <header class="gjd-card-header">
          <div class="gjd-brand">
            <span class="gjd-logo">👻</span>
            <div>
              <div class="gjd-brand-title">Ghost Jobs Detector</div>
              <div class="gjd-brand-sub">Signature Formula Analysis ${score.meta.mock ? "· Mock Engine" : ""}</div>
            </div>
          </div>
          <span class="gjd-verdict" style="background:${bg};color:${stroke};border-color:${stroke}">${label}</span>
        </header>

        <div class="gjd-card-body">
          <div class="gjd-gauge-col">
            ${buildGauge(score.ghostRisk, theme)}
            <div class="gjd-gauge-label" style="color:${stroke}">${label}</div>
          </div>

          <div class="gjd-metrics-col">
            ${buildMetricRow({
              name: "Text DNA Match Risk",
              value: `${score.signatureFormula.textDnaMatchRisk}%`,
              barPct: score.signatureFormula.textDnaMatchRisk,
              detail: "Lexical fingerprint vs. known ghost-post templates",
              accent: riskColor(score.signatureFormula.textDnaMatchRisk).stroke,
            })}
            ${buildMetricRow({
              name: "Cross-Platform Desync Status",
              value: `${desync.status} · ${desyncPct}%`,
              barPct: desyncPct,
              detail: `${desync.platformsChecked.length} platforms checked · ${desync.daysStale}d stale · ${desync.confidence}% confidence`,
              accent: desyncAccent,
            })}
            ${buildMetricRow({
              name: "Salary Transparency Compliance",
              value: `${salary.compliant ? "Compliant" : "Non-Compliant"} · ${salaryPct}%`,
              barPct: salaryPct,
              detail: `${salary.jurisdiction} · disclosure ${salary.disclosurePresent ? "present" : "absent"} · penalty risk: ${salary.penaltyRiskLevel}`,
              accent: salaryAccent,
            })}
          </div>
        </div>

        <footer class="gjd-card-footer">
          <span class="gjd-footer-job" title="${escapeHtml(job.companyName + " — " + job.jobTitle)}">
            ${escapeHtml(job.companyName)} · ${escapeHtml(job.jobTitle)}
          </span>
          <span class="gjd-footer-meta">v${score.meta.engineVersion} · analyzed ${new Date(score.meta.analyzedAt).toLocaleTimeString()}</span>
        </footer>
      </section>
    `;
  }

  function escapeHtml(s) {
    // Built from char codes to avoid literal HTML entities being decoded by formatters.
    const amp = "&#" + 38 + ";";
    const lt = "&#" + 60 + ";";
    const gt = "&#" + 62 + ";";
    const quot = "&#" + 34 + ";";
    const apos = "&#" + 39 + ";";
    const map = { "&": amp, "<": lt, ">": gt, '"': quot, "'": apos };
    return String(s).replace(/[&<>"']/g, (c) => map[c]);
  }

  // Resolve the best available injection anchor using the full cascade.
  // Tries every selector across both the panel + text lists, plus broad fallbacks.
  function findInjectionTarget() {
    const candidates = [
      ...SELECTORS.descriptionPanel,
      ...SELECTORS.descriptionText,
      ".jobs-search__right-rail",
      ".jobs-search-two-pane__job-details",
      ".job-view-layout",
      "#main-content",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return { el, selector: sel };
      }
    }
    return null;
  }

  // Dedup guard: returns true if a widget already lives inside the target block.
  function targetHasCard(target) {
    if (!target) return false;
    return !!(
      target.querySelector(`#${CARD_ID}`) ||
      target.querySelector(`[${PROCESSED_ATTR}]`) ||
      document.getElementById(CARD_ID)
    );
  }

  // Wait for an injection target to appear (SPA renders async).
  // Resolves with { el, selector } or null after timeout.
  function waitForInjectionTarget({ timeout = 4000, interval = 150 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const found = findInjectionTarget();
        if (found) return resolve(found);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function injectCard(job, score, targetOverride) {
    const theme = detectTheme();
    ensureStyles(theme);

    // Remove any prior card anywhere so we never double-inject on SPA nav.
    document.getElementById(CARD_ID)?.remove();
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((n) => n.remove());

    const target = targetOverride || findInjectionTarget();
    if (!target) {
      warn(
        "Target container not found! Tried cascade:",
        SELECTORS.descriptionPanel,
        "→ no structural anchor matched this LinkedIn layout."
      );
      return false;
    }

    // Gracefully avoid duplicate injection if a widget already stands inside the block.
    if (targetHasCard(target)) {
      log("Card already present in target — skipping duplicate injection.", target.selector);
      return true;
    }

    const container = document.createElement("div");
    container.className = "gjd-root";
    container.setAttribute(PROCESSED_ATTR, "true");
    container.innerHTML = buildCard(job, score, theme);

    // Prepend cleanly inside the top of the resolved container.
    target.el.insertBefore(container, target.el.firstChild);

    log("✅ Ghost Risk card injected into", target.selector, { theme, score });
    return true;
  }

  function showLoading(job, targetOverride) {
    const theme = detectTheme();
    ensureStyles(theme);
    document.getElementById(CARD_ID)?.remove();
    document.querySelectorAll(`[${PROCESSED_ATTR}].gjd-loading`)?.forEach((n) => n.remove());

    const target = targetOverride || findInjectionTarget();
    if (!target) return; // silently wait; the polling loop will retry.

    const container = document.createElement("div");
    container.className = "gjd-root";
    container.setAttribute(PROCESSED_ATTR, "true");
    container.innerHTML = `
      <section id="${CARD_ID}" class="gjd-card gjd-loading" data-theme="${theme}">
        <div class="gjd-card-header">
          <div class="gjd-brand">
            <span class="gjd-logo gjd-pulse">👻</span>
            <div>
              <div class="gjd-brand-title">Ghost Jobs Detector</div>
              <div class="gjd-brand-sub">Analyzing posting…</div>
            </div>
          </div>
        </div>
        <div class="gjd-skeleton-row"></div>
        <div class="gjd-skeleton-row short"></div>
        <div class="gjd-skeleton-row"></div>
      </section>
    `;
    target.el.insertBefore(container, target.el.firstChild);
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------
  async function handleJobViewChange() {
    if (!isJobViewUrl()) return;
    if (isInjecting) return;

    const job = extractJobData();
    const signature = `${job.jobId}|${job.jobTitle}|${job.descriptionLength}`;
    if (signature === lastJobSignature) return; // already processed this exact view
    if (job.jobDescription.length < 20) return; // panel not fully rendered yet

    isInjecting = true;
    lastJobSignature = signature;

    log("🔎 Job view change detected →", job);

    // Wait (poll) for a valid injection anchor to appear before doing anything.
    const target = await waitForInjectionTarget({ timeout: 4000, interval: 150 });
    if (!target) {
      warn(
        "Target container not found after 4s polling. Tried cascade:",
        SELECTORS.descriptionPanel
      );
      isInjecting = false;
      return;
    }

    // If a card already stands inside the resolved block, bail gracefully.
    if (targetHasCard(target)) {
      log("Card already present in", target.selector, "— skipping.");
      isInjecting = false;
      return;
    }

    showLoading(job, target);

    try {
      const score = await fetchGhostScore(job);
      // Ensure the view hasn't been swapped out during the async wait.
      if (signature !== lastJobSignature) {
        isInjecting = false;
        return;
      }
      injectCard(job, score, target);
    } catch (err) {
      warn("Scoring failed:", err);
    } finally {
      isInjecting = false;
    }
  }

  function init() {
    log("🚀 Content script loaded on LinkedIn jobs page.");
    patchHistoryMethods();
    attachClickTracking();

    // Observe DOM mutations to catch SPA-rendered panels the history hook misses.
    const observer = new MutationObserver(() => {
      if (isJobViewUrl() && !document.getElementById(CARD_ID)) {
        handleJobViewChange();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run in case we land directly on a job view.
    setTimeout(handleJobViewChange, 800);
  }

  // Defer init until body exists.
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();