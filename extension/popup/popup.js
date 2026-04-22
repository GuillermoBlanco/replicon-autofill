/**
 * popup.js — Extension popup controller
 *
 * The popup cannot directly call content script functions,
 * so it uses chrome.tabs.sendMessage to delegate actions to content.js,
 * which owns PunchFiller / DistributionFiller / Detector.
 */

'use strict';

const STORAGE_KEY = 'replicon_autofill_config';

const $ = id => document.getElementById(id);

// ─── Persist config via chrome.storage.local ─────────────────────────────────

function loadConfig(cb) {
  chrome.storage.local.get(STORAGE_KEY, data => {
    const cfg = data[STORAGE_KEY] || {};
    $('in-time').value      = cfg.inTime      || '8:00 am';
    $('out-time').value     = cfg.outTime     || '4:00 pm';
    $('project-code').value = cfg.projectCode || '';
    $('hours').value        = cfg.hoursPerDay || '8.00';
    if (cb) cb(cfg);
  });
}

function saveConfig() {
  const cfg = {
    inTime:      $('in-time').value.trim(),
    outTime:     $('out-time').value.trim(),
    projectCode: $('project-code').value.trim(),
    hoursPerDay: $('hours').value.trim(),
  };
  chrome.storage.local.set({ [STORAGE_KEY]: cfg });
  return cfg;
}

// ─── Status helper ────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  const el = $('status-bar');
  el.textContent = msg;
  el.style.color = isError ? '#e03131' : '#868e96';
}

// ─── Send action to content script ───────────────────────────────────────────

async function sendAction(action, payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('replicon.com')) {
    setStatus('⚠ Not on Replicon – navigate to a timesheet first', true);
    return;
  }

  const cfg = saveConfig();

  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { action, cfg, ...payload }, response => {
      if (chrome.runtime.lastError) {
        setStatus('Content script not ready. Reload the timesheet page.', true);
      } else if (response) {
        setStatus(response.message || 'Done ✔');
      }
      resolve(response);
    });
  });
}

// ─── Button wiring ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  $('btn-fill-punches').addEventListener('click', async () => {
    setStatus('Filling punches…');
    await sendAction('FILL_PUNCHES');
  });

  $('btn-fill-dist').addEventListener('click', async () => {
    const project = $('project-code').value.trim();
    if (!project) { setStatus('⚠ Enter a project code', true); return; }
    setStatus('Filling distribution…');
    await sendAction('FILL_DISTRIBUTION');
  });

  $('btn-fill-all').addEventListener('click', async () => {
    setStatus('Running full fill…');
    await sendAction('FILL_ALL');
  });

  // Auto-save fields on change
  ['in-time', 'out-time', 'project-code', 'hours'].forEach(id => {
    $(id).addEventListener('change', saveConfig);
  });
});
