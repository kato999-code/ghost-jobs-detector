/*
 * Ghost Jobs Detector — content.js (v0.2.0 — multi-platform)
 * Manifest V3 content script for universal job-board ghost detection.
 *
 * Supported platforms (via unified platform router):
 *   - LinkedIn          (linkedin.com/jobs/*)
 *   - Indeed            (indeed.com)
 *   - ZipRecruiter      (ziprecruiter.com/jobs*)
 *   - Glassdoor         (glassdoor.com)
 *   - JobStreet (SG)    (jobstreet.com.sg)
 *   - MyCareersFuture   (mycareersfuture.gov.sg)
 *
 * Architecture:
 *   1. Platform router reads window.location.hostname → resolves a SITE_CONFIG.
 *   2. Each config holds site-specific selector dicts + URL matchers.
 *   3. Standardized output pipeline: every platform yields { jobTitle, companyName,
 *      descriptionText } regardless of DOM structure.
 *   4. UI injector prepends the theme-aware Ghost Risk card into the active
 *      platform's description container, with polling + dedup + optional chaining.
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
  let currentPlatform = null;

  const log = (...args) => console.log(LOG_PREFIX, LOG_STYLE, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, LOG_STYLE, ...args);

  // ---------------------------------------------------------------------------
  // PLATFORM CONFIGURATIONS — site-specific selector dictionaries
  // Each config: { id, name, hostMatch, urlMatch, selectors }
  // selectors: { descriptionPanel[], jobTitle[], company[], descriptionText[], jobCardRow[] }
  // ---------------------------------------------------------------------------
  const PLATFORM_CONFIGS = {
    linkedin: {
      id: "linkedin",
      name: "LinkedIn",
      hostMatch: /(^|\.)linkedin\.com$/,
      urlMatch: /linkedin\.com\/jobs\/(view|collections|search)/,
      selectors: {
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
        jobCardRow: [
          ".jobs-search-results__list-item",
          ".job-card-container",
          ".job-card-job-posting-card-wrapper",
          "[data-job-id]",
        ],
      },
    },

    indeed: {
      id: "indeed",
      name: "Indeed",
      hostMatch: /(^|\.)indeed\.com$/,
      urlMatch: /indeed\.com\/(viewjob|jobs|companies)/,
      selectors: {
        descriptionPanel: [
          "#jobDescriptionText",
          ".jobsearch-JobComponent-description",
          "#jobBody",
          "#rawjob-description",
          ".jobsearch-ViewJobLayout-jobDisplay",
        ],
        jobTitle: [
          ".jobsearch-JobInfoHeader-title",
          "h1.jobsearch-JobInfoHeader-title",
          ".icl-JobResultJobTitle",
          "h1.jobtitle",
          "h3.jobsearch-JobInfoHeader-title",
        ],
        company: [
          ".jobsearch-CompanyReviewContainer + div a",
          ".jobsearch-InlineCompanyRatingLink div",
          ".jobsearch-CompanyInfoContainer a",
          "[data-company-name='true']",
          ".company",
        ],
        descriptionText: [
          "#jobDescriptionText",
          ".jobsearch-JobComponent-description",
          "#jobBody",
          "#rawjob-description",
        ],
        jobCardRow: [
          ".result",
          ".jobsearch-SerpJobCard",
          ".cardOutline",
          "[data-jk]",
          "a.tapItem",
        ],
      },
    },

    ziprecruiter: {
      id: "ziprecruiter",
      name: "ZipRecruiter",
      hostMatch: /(^|\.)ziprecruiter\.com$/,
      urlMatch: /ziprecruiter\.com\/(jobs|c\/)/,
      selectors: {
        descriptionPanel: [
          "[data-testid='job-description-section']",
          ".job_description_content",
          "#job-description",
          ".job_details_section",
          ".mop-body",
        ],
        jobTitle: [
          "h1.job_title",
          "[data-testid='job-title']",
          ".job-title",
          "h1.t_job_title",
        ],
        company: [
          ".company_name a",
          "[data-testid='company-name']",
          ".company-name",
          ".employer_name",
        ],
        descriptionText: [
          "[data-testid='job-description-section']",
          ".job_description_content",
          "#job-description",
          ".job_details_section",
        ],
        jobCardRow: [
          ".job_result",
          "[data-testid='job-list-item']",
          ".job-listing",
          "article.job",
        ],
      },
    },

    glassdoor: {
      id: "glassdoor",
      name: "Glassdoor",
      hostMatch: /(^|\.)glassdoor\.com$/,
      urlMatch: /glassdoor\.com\/(job-listing|job)/,
      selectors: {
        descriptionPanel: [
          "[data-test='jobDescriptionContainer']",
          ".jobDescriptionContent",
          "#JobDescriptionContainer",
          ".jobDesc",
          "#jobDescription",
        ],
        jobTitle: [
          "[data-test='job-title']",
          ".job-title",
          "h1.jobTitle",
          "h1",
        ],
        company: [
          "[data-test='employer-name']",
          ".employerName",
          ".job-header .employer-name",
        ],
        descriptionText: [
          "[data-test='jobDescriptionContainer']",
          ".jobDescriptionContent",
          "#JobDescriptionContainer",
          ".jobDesc",
        ],
        jobCardRow: [
          "[data-test='job-link']",
          ".react-job-listing",
          ".jobCard",
          "li.jl",
        ],
      },
    },

    jobstreet: {
      id: "jobstreet",
      name: "JobStreet (SG)",
      hostMatch: /(^|\.)jobstreet\.com\.sg$/,
      urlMatch: /jobstreet\.com\.sg\/(job|jobs|employer)/,
      selectors: {
        descriptionPanel: [
          "[data-automation='jobDescription']",
          "#job-description",
          ".job-description",
          "#jobAdDetails",
          "div[data-automation='jobAdDetails']",
        ],
        jobTitle: [
          "[data-automation='job-detail-title']",
          "h1.job-title",
          "h1[data-automation='jobTitle']",
          "h1",
        ],
        company: [
          "[data-automation='advertiser-name']",
          ".company-name",
          "span[data-automation='companyName']",
        ],
        descriptionText: [
          "[data-automation='jobDescription']",
          "#job-description",
          ".job-description",
          "#jobAdDetails",
        ],
        jobCardRow: [
          "[data-automation='jobCard']",
          "article.job-card",
          ".job-card",
          "[data-card-type='up']",
        ],
      },
    },

    mycareersfuture: {
      id: "mycareersfuture",
      name: "MyCareersFuture (SG)",
      hostMatch: /(^|\.)mycareersfuture\.gov\.sg$/,
      urlMatch: /mycareersfuture\.gov\.sg\/job\//,
      selectors: {
        descriptionPanel: [
          "#job_description",
          "#job-description",
          ".job-description",
          "[data-testid='job-description']",
          "#main-content",
        ],
        jobTitle: [
          "h1#job_title",
          "h1[data-testid='job-title']",
          ".job-title",
          "h1",
        ],
        company: [
          "#company_name",
          "[data-testid='company-name']",
          ".company-name",
          "p#company_name",
        ],
        descriptionText: [
          "#job_description",
          "#job-description",
          ".job-description",
          "[data-testid='job-description']",
        ],
        jobCardRow: [
          "[data-testid='job-card']",
          ".job-card",
          "div.SearchResultsPage_job_card__",
          "a.job-card",
        ],
      },
    },
  };

  // ---------------------------------------------------------------------------
  // PLATFORM ROUTER — resolves the active site config from window.location
  // ---------------------------------------------------------------------------
  function detectPlatform() {
    const host = window.location.hostname;
    const href = window.location.href;
    for (const key of Object.keys(PLATFORM_CONFIGS)) {
      const cfg = PLATFORM_CONFIGS[key];
      if (cfg.hostMatch.test(host) && (!cfg.urlMatch || cfg.urlMatch.test(href))) {
        return cfg;
      }
    }
    // Fallback: host match only (let the URL gate be handled elsewhere)
    for (const key of Object.keys(PLATFORM_CONFIGS)) {
      const cfg = PLATFORM_CONFIGS[key];
      if (cfg.hostMatch.test(host)) return cfg;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Theme detection — match native dark / light theme of any platform
  // ---------------------------------------------------------------------------
  function detectTheme() {
    const htmlTheme = document.documentElement.getAttribute("data-theme") || "";
    if (htmlTheme.toLowerCase().includes("dark")) return "dark";

    const explicit = document.documentElement.getAttribute("data-color-scheme");
    if (explicit === "dark") return "dark";
    if (explicit === "light") return "light";

    // Also check <meta name="color-scheme">
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      const c = meta.getAttribute("content") || "";
      if (c.includes("dark")) return "dark";
      if (c.includes("light")) return "light";
    }

    // Fallback: sample computed background of the app root / body.
    const probe = document.querySelector("body, #app, #root, [class*='app'], main");
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
  // DOM helpers (with safe optional chaining — never throw on null)
  // ---------------------------------------------------------------------------
  function queryFirst(selectorList, root = document) {
    if (!selectorList || !selectorList.length) return null;
    for (const sel of selectorList) {
      try {
        const el = root.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
        // Some platforms use position:fixed panels (offsetParent null but visible)
        if (el && el.getClientRects?.().length > 0) return el;
      } catch {
        /* invalid selector on this page — skip silently */
      }
    }
    return null;
  }

  function cleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------------------
  // STANDARDIZED EXTRACTION — uniform { jobTitle, companyName, descriptionText }
  // Uses the active platform's selector dictionary.
  // ---------------------------------------------------------------------------
  function extractJobData(platform) {
    if (!platform) return null;
    const s = platform.selectors;

    const titleEl = queryFirst(s.jobTitle);
    const companyEl = queryFirst(s.company);
    const descEl = queryFirst(s.descriptionText);

    const jobTitle = cleanText(titleEl?.textContent || titleEl?.innerText || "");
    const companyName = cleanText(companyEl?.textContent || companyEl?.innerText || "");
    const descriptionText = cleanText(descEl?.textContent || descEl?.innerText || "");

    const url = location.href;
    const jobIdMatch = url.match(/\/(?:viewjob|jobs?|job|c)\/?([a-zA-Z0-9_-]+)/);
    const jobId = jobIdMatch ? jobIdMatch[1] : url;

    return {
      platform: platform.id,
      platformName: platform.name,
      jobId,
      jobTitle,
      companyName,
      descriptionText,
      descriptionLength: descriptionText.length,
      url,
      extractedAt: new Date().toISOString(),
      ready: jobTitle.length > 0 && companyName.length > 0 && descriptionText.length >= 20,
    };
  }

  // Poll for fully-rendered job data (all platforms render text containers async).
  // Checks every 100ms up to 30 retries; resolves with job or partial on timeout.
  function waitForJobData(platform, { interval = 100, maxRetries = 30 } = {}) {
    return new Promise((resolve) => {
      let attempts = 0;
      const tick = () => {
        const job = extractJobData(platform);
        if (!job) return resolve(null);
        if (job.ready) return resolve(job);
        attempts += 1;
        if (attempts >= maxRetries) {
          warn(`[${platform.name}] Job data not ready after ${maxRetries} retries — using partial data.`, job);
          return resolve(job);
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------------------
  // Click tracking on job listings (cross-platform)
  // ---------------------------------------------------------------------------
  function attachClickTracking(platform) {
    if (!platform) return;
    const rowSelectors = platform.selectors.jobCardRow || [];
    if (!rowSelectors.length) return;

    document.addEventListener(
      "click",
      (e) => {
        const row = e.target.closest(rowSelectors.join(","));
        if (!row) return;

        const jobId =
          row.getAttribute("data-job-id") ||
          row.getAttribute("data-jk") ||
          row.getAttribute("data-id") ||
          row
            .querySelector("a[href*='/job'], a[href*='/viewjob'], a[href*='/jobs/view/']")
            ?.getAttribute("href")
            ?.match(/\/(?:job|viewjob|jobs\/view)\/?([a-zA-Z0-9_-]+)/)?.[1] ||
          "unknown";

        log(`🖱️  [${platform.name}] Job listing clicked →`, { jobId, preview: cleanText(row.innerText).slice(0, 80) });

        // Most platforms swap the detail panel via SPA; re-evaluate shortly after.
        setTimeout(() => handleJobViewChange(), 450);
        setTimeout(() => handleJobViewChange(), 1000);
      },
      true
    );
    log(`Click tracking attached to ${platform.name} job listings.`);
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

  function isJobViewUrl(platform) {
    if (!platform) return false;
    if (!platform.urlMatch) return true; // if no URL gate, treat host match as sufficient
    return platform.urlMatch.test(location.href);
  }

  // ---------------------------------------------------------------------------
  // MOCK backend — simulates an async API call (500ms) returning the signature
  // scoring formula payload. Uniform across all platforms.
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
    const t = (seed += 0x6d2b79f5);
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Simulates a backend API call to the Ghost Jobs scoring service.
   * Uniform across all platforms. @param {object} job @returns {Promise<object>}
   */
  async function fetchGhostScore(job) {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(500); // simulated network latency

    const seed = hashString(`${job.platform}|${job.companyName}|${job.jobTitle}|${job.descriptionText.slice(0, 200)}`);

    const textDnaMatchRisk = Math.round(15 + deterministicPseudo(seed) * 80);

    const desync = deterministicPseudo(seed + 7);
    const crossPlatformDesyncStatus = {
      status: desync > 0.66 ? "DESYNCED" : desync > 0.33 ? "PARTIAL_SYNC" : "SYNCED",
      confidence: Math.round(40 + deterministicPseudo(seed + 11) * 60),
      daysStale: Math.floor(deterministicPseudo(seed + 13) * 120),
      platformsChecked: ["LinkedIn", "Indeed", "Glassdoor", "Company Careers", "ZipRecruiter"],
    };

    const salaryScore = deterministicPseudo(seed + 19);
    const salaryPresent = /salary|compensation|\$\d|k\/yr|per year|monthly|annum/i.test(job.descriptionText);
    const legalSalaryTransparency = {
      compliant: salaryPresent ? salaryScore > 0.3 : salaryScore > 0.75,
      disclosurePresent: salaryPresent,
      jurisdiction: navigator.language?.includes("US") ? "US-STATE-LAW" : "EU-PAY-TRANSPARENCY",
      penaltyRiskLevel: salaryPresent ? (salaryScore > 0.7 ? "LOW" : "MEDIUM") : "HIGH",
    };

    const ghostRisk = Math.round(
      Math.min(
        99,
        textDnaMatchRisk * 0.5 +
          (crossPlatformDesyncStatus.status === "DESYNCED" ? 85 : crossPlatformDesyncStatus.status === "PARTIAL_SYNC" ? 45 : 12) * 0.3 +
          (legalSalaryTransparency.compliant ? 10 : 70) * 0.2
      )
    );

    return {
      meta: {
        jobId: job.jobId,
        platform: job.platform,
        platformName: job.platformName,
        analyzedAt: new Date().toISOString(),
        engineVersion: "0.2.0-mock",
        latencyMs: 500,
        mock: true,
      },
      signatureFormula: {
        textDnaMatchRisk,
        crossPlatformDesynchronizationStatus: crossPlatformDesyncStatus,
        legalSalaryTransparency,
      },
      ghostRisk,
      verdict: ghostRisk >= 70 ? "HIGH_RISK_GHOST" : ghostRisk >= 40 ? "SUSPICIOUS" : "LIKELY_REAL",
    };
  }

  // ---------------------------------------------------------------------------
  // UI Injection — clean, modern, theme-aware card widget (cross-platform)
  // ---------------------------------------------------------------------------
  function ensureStyles() {
    if (document.getElementById("gjd-styles")) return;
    const link = document.createElement("link");
    link.id = "gjd-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("styles.css");
    document.head?.appendChild(link);
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
            stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 60 60)"
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
    const desyncPct = desync.status === "DESYNCED" ? 90 : desync.status === "PARTIAL_SYNC" ? 50 : 15;
    const salaryPct = salary.compliant ? 25 : 80;
    const desyncAccent = desync.status === "DESYNCED" ? "#ef4444" : desync.status === "PARTIAL_SYNC" ? "#f59e0b" : "#10b981";
    const salaryAccent = salary.compliant ? "#10b981" : "#ef4444";

    return `
      <section id="${CARD_ID}" class="gjd-card" data-theme="${theme}" data-platform="${job.platform}">
        <header class="gjd-card-header">
          <div class="gjd-brand">
            <span class="gjd-logo">👻</span>
            <div>
              <div class="gjd-brand-title">Ghost Jobs Detector</div>
              <div class="gjd-brand-sub">${job.platformName} · Signature Formula ${score.meta.mock ? "· Mock Engine" : ""}</div>
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
            ${buildMetricRow({ name: "Text DNA Match Risk", value: `${score.signatureFormula.textDnaMatchRisk}%`, barPct: score.signatureFormula.textDnaMatchRisk, detail: "Lexical fingerprint vs. known ghost-post templates", accent: riskColor(score.signatureFormula.textDnaMatchRisk).stroke })}
            ${buildMetricRow({ name: "Cross-Platform Desync Status", value: `${desync.status} · ${desyncPct}%`, barPct: desyncPct, detail: `${desync.platformsChecked.length} platforms checked · ${desync.daysStale}d stale · ${desync.confidence}% confidence`, accent: desyncAccent })}
            ${buildMetricRow({ name: "Salary Transparency Compliance", value: `${salary.compliant ? "Compliant" : "Non-Compliant"} · ${salaryPct}%`, barPct: salaryPct, detail: `${salary.jurisdiction} · disclosure ${salary.disclosurePresent ? "present" : "absent"} · penalty risk: ${salary.penaltyRiskLevel}`, accent: salaryAccent })}
          </div>
        </div>

        <footer class="gjd-card-footer">
          <span class="gjd-footer-job" title="${escapeHtml(job.companyName + " — " + job.jobTitle)}">
            ${escapeHtml(job.companyName)} · ${escapeHtml(job.jobTitle)}
          </span>
          <span class="gjd-footer-meta">v${score.meta.engineVersion} · ${new Date(score.meta.analyzedAt).toLocaleTimeString()}</span>
        </footer>
      </section>
    `;
  }

  function escapeHtml(s) {
    const amp = "&#" + 38 + ";";
    const lt = "&#" + 60 + ";";
    const gt = "&#" + 62 + ";";
    const quot = "&#" + 34 + ";";
    const apos = "&#" + 39 + ";";
    const map = { "&": amp, "<": lt, ">": gt, '"': quot, "'": apos };
    return String(s).replace(/[&<>"']/g, (c) => map[c]);
  }

  // Resolve the best available injection anchor for the active platform.
  function findInjectionTarget(platform) {
    if (!platform) return null;
    const candidates = [
      ...platform.selectors.descriptionPanel,
      ...platform.selectors.descriptionText,
    ];
    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (el && (el.offsetParent !== null || el.getClientRects?.().length > 0)) {
          return { el, selector: sel };
        }
      } catch {
        /* skip invalid selector */
      }
    }
    return null;
  }

  function targetHasCard(target) {
    if (!target) return false;
    return !!(
      target.querySelector(`#${CARD_ID}`) ||
      target.querySelector(`[${PROCESSED_ATTR}]`) ||
      document.getElementById(CARD_ID)
    );
  }

  function waitForInjectionTarget(platform, { timeout = 4000, interval = 150 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const found = findInjectionTarget(platform);
        if (found) return resolve(found);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function injectCard(job, score, targetOverride) {
    const theme = detectTheme();
    ensureStyles();

    document.getElementById(CARD_ID)?.remove();
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((n) => n.remove());

    const target = targetOverride || findInjectionTarget(currentPlatform);
    if (!target) {
      warn(`[${job.platformName}] Target container not found! Tried cascade:`, currentPlatform.selectors.descriptionPanel);
      return false;
    }

    if (targetHasCard(target)) {
      log(`[${job.platformName}] Card already present in`, target.selector, "— skipping duplicate injection.");
      return true;
    }

    const container = document.createElement("div");
    container.className = "gjd-root";
    container.setAttribute(PROCESSED_ATTR, "true");
    container.innerHTML = buildCard(job, score, theme);

    // Prepend cleanly inside the top of the resolved container.
    target.el.insertBefore(container, target.el.firstChild);

    log(`✅ [${job.platformName}] Ghost Risk card injected into`, target.selector, { theme, score });
    return true;
  }

  function showLoading(job, targetOverride) {
    const theme = detectTheme();
    ensureStyles();
    document.getElementById(CARD_ID)?.remove();
    document.querySelectorAll(`[${PROCESSED_ATTR}].gjd-loading`)?.forEach((n) => n.remove());

    const target = targetOverride || findInjectionTarget(currentPlatform);
    if (!target) return;

    const container = document.createElement("div");
    container.className = "gjd-root";
    container.setAttribute(PROCESSED_ATTR, "true");
    container.innerHTML = `
      <section id="${CARD_ID}" class="gjd-card gjd-loading" data-theme="${theme}" data-platform="${job.platform}">
        <div class="gjd-card-header">
          <div class="gjd-brand">
            <span class="gjd-logo gjd-pulse">👻</span>
            <div>
              <div class="gjd-brand-title">Ghost Jobs Detector</div>
              <div class="gjd-brand-sub">${job.platformName} · Analyzing posting…</div>
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
  // Orchestration — unified pipeline across all platforms
  // ---------------------------------------------------------------------------
  async function handleJobViewChange() {
    const platform = currentPlatform;
    if (!platform) return;
    if (!isJobViewUrl(platform)) return;
    if (isInjecting) return;

    // Quick early signature check to avoid re-running for the same view.
    const earlyJob = extractJobData(platform);
    if (earlyJob) {
      const earlySig = `${platform.id}|${earlyJob.jobId}|${earlyJob.jobTitle}|${earlyJob.descriptionLength}`;
      if (earlySig === lastJobSignature) return;
    }

    isInjecting = true;

    try {
      // 1) Wait for job text containers to gracefully appear (poll every 100ms, ≤30 retries).
      const job = await waitForJobData(platform, { interval: 100, maxRetries: 30 });
      if (!job) {
        isInjecting = false;
        return;
      }
      const signature = `${platform.id}|${job.jobId}|${job.jobTitle}|${job.descriptionLength}`;
      if (signature === lastJobSignature) return;
      lastJobSignature = signature;

      log(`🔎 [${platform.name}] Job view change detected →`, job);

      // 2) Wait for a valid injection anchor to appear.
      const target = await waitForInjectionTarget(platform, { timeout: 4000, interval: 150 });
      if (!target) {
        warn(`[${platform.name}] Target container not found after 4s polling. Tried cascade:`, platform.selectors.descriptionPanel);
        return;
      }

      // 3) Dedup: bail if a card already stands inside the resolved block.
      if (targetHasCard(target)) {
        log(`[${platform.name}] Card already present in`, target.selector, "— skipping.");
        return;
      }

      // 4) Show loading skeleton while the mock backend "thinks".
      showLoading(job, target);

      // 5) Run the mock scoring algorithm.
      const score = await fetchGhostScore(job);
      if (signature !== lastJobSignature) return; // view swapped out mid-flight

      // 6) Inject the UI card widget element.
      injectCard(job, score, target);
    } catch (err) {
      warn(`[${platform?.name}] handleJobViewChange error:`, err);
    } finally {
      isInjecting = false;
    }
  }

  function init() {
    currentPlatform = detectPlatform();
    if (!currentPlatform) {
      log("ℹ️ No supported job platform detected on this page — content script idle.");
      return;
    }
    log(`🚀 [${currentPlatform.name}] Content script loaded.`, { host: location.hostname, url: location.href });
    patchHistoryMethods();
    attachClickTracking(currentPlatform);

    // Observe DOM mutations to catch SPA-rendered panels the history hook misses.
    const observer = new MutationObserver(() => {
      if (isJobViewUrl(currentPlatform) && !document.getElementById(CARD_ID)) {
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