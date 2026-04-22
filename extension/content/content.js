/**
 * content.js — Chrome Extension content script entry point
 *
 * Loaded on every page matching the Replicon host (see manifest.json).
 * Waits for the timesheet DOM to be ready before injecting the UI panel.
 *
 * Module load order (each module attaches to window scope via IIFE):
 *   detector.js  →  punchFiller.js  →  distributionFiller.js  →  ui.js
 * (The manifest declares them all as content_scripts in that order.)
 */

'use strict';

(function bootstrap() {
  // Give the SPA time to render its initial view
  const MAX_WAIT  = 10_000;  // 10 s
  const POLL_MS   = 300;
  const START     = Date.now();

  function tryInit() {
    // Wait until the punch section is rendered
    const punchSection = document.querySelector('.day');
    if (punchSection) {
      RepliconUI.init();
      return;
    }
    if (Date.now() - START < MAX_WAIT) {
      setTimeout(tryInit, POLL_MS);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

  // ─── Message listener (from popup) ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const cfg = msg.cfg || {};

    const progressLines = [];
    const collect = line => progressLines.push(line);

    if (msg.action === 'FILL_PUNCHES') {
      PunchFiller.fillWeek({ inTime: cfg.inTime, outTime: cfg.outTime }, collect)
        .then(r => sendResponse({ message: `Punches: ${r.filled} filled, ${r.skipped} skipped`, log: progressLines }))
        .catch(e => sendResponse({ message: `Error: ${e.message}`, log: progressLines }));
      return true; // async
    }

    if (msg.action === 'FILL_DISTRIBUTION') {
      DistributionFiller.fillDistribution(cfg.projectCode, { hoursPerDay: cfg.hoursPerDay }, collect)
        .then(r => sendResponse({ message: `Distribution: ${r.filled} filled, ${r.skipped} skipped`, log: progressLines }))
        .catch(e => sendResponse({ message: `Error: ${e.message}`, log: progressLines }));
      return true;
    }

    if (msg.action === 'FILL_ALL') {
      (async () => {
        const pr = await PunchFiller.fillWeek({ inTime: cfg.inTime, outTime: cfg.outTime }, collect);
        let dr = { filled: 0, skipped: 0, errors: [] };
        if (cfg.projectCode) {
          dr = await DistributionFiller.fillDistribution(cfg.projectCode, { hoursPerDay: cfg.hoursPerDay }, collect);
        }
        sendResponse({
          message: `Punches: ${pr.filled} filled | Distribution: ${dr.filled} filled`,
          log: progressLines
        });
      })().catch(e => sendResponse({ message: `Error: ${e.message}` }));
      return true;
    }
  });

  // Re-init on SPA navigation (Replicon uses pushState)
  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(tryInit, 800);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
