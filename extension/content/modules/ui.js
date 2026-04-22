/**
 * ui.js
 * Injects a floating panel into the Replicon page that lets the user
 * trigger autofill operations without leaving the browser tab.
 *
 * The panel is intentionally minimal – no external dependencies.
 */

'use strict';

const RepliconUI = (() => {

  const PANEL_ID = 'replicon-autofill-panel';
  let logEl = null;

  // ─── Styles ───────────────────────────────────────────────────────────────

  const CSS = `
    #${PANEL_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      width: 340px;
      background: #fff;
      border: 1.5px solid #3b5bdb;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #222;
      overflow: hidden;
      transition: height 0.2s;
    }
    #${PANEL_ID} .rpa-header {
      background: #3b5bdb;
      color: #fff;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
      user-select: none;
    }
    #${PANEL_ID} .rpa-header span { font-weight: 600; font-size: 14px; }
    #${PANEL_ID} .rpa-toggle {
      background: none; border: none; color: #fff; cursor: pointer;
      font-size: 18px; line-height: 1; padding: 0 2px;
    }
    #${PANEL_ID} .rpa-body { padding: 12px 14px; }
    #${PANEL_ID} .rpa-section { margin-bottom: 12px; }
    #${PANEL_ID} .rpa-section label {
      display: block; font-weight: 600; margin-bottom: 4px; color: #3b5bdb;
    }
    #${PANEL_ID} .rpa-row {
      display: flex; gap: 8px; margin-bottom: 8px; align-items: center;
    }
    #${PANEL_ID} .rpa-row input[type="text"] {
      flex: 1; padding: 5px 8px; border: 1px solid #ced4da;
      border-radius: 5px; font-size: 12px;
    }
    #${PANEL_ID} .rpa-btn {
      padding: 6px 14px; border: none; border-radius: 5px;
      cursor: pointer; font-size: 12px; font-weight: 600;
      white-space: nowrap;
    }
    #${PANEL_ID} .rpa-btn-primary { background: #3b5bdb; color: #fff; }
    #${PANEL_ID} .rpa-btn-primary:hover { background: #2f4bc7; }
    #${PANEL_ID} .rpa-btn-secondary { background: #e9ecef; color: #333; }
    #${PANEL_ID} .rpa-btn-secondary:hover { background: #dee2e6; }
    #${PANEL_ID} .rpa-btn-danger { background: #fa5252; color: #fff; }
    #${PANEL_ID} .rpa-log {
      max-height: 140px; overflow-y: auto; background: #f8f9fa;
      border: 1px solid #dee2e6; border-radius: 5px;
      padding: 6px 8px; font-size: 11px; line-height: 1.6;
      font-family: 'Consolas', monospace;
    }
    #${PANEL_ID} .rpa-log .ok  { color: #2f9e44; }
    #${PANEL_ID} .rpa-log .err { color: #e03131; }
    #${PANEL_ID} .rpa-log .info{ color: #1971c2; }
    #${PANEL_ID} .rpa-status {
      margin-top: 6px; font-size: 11px; color: #868e96; text-align: right;
    }
    #${PANEL_ID} hr { border: none; border-top: 1px solid #e9ecef; margin: 8px 0; }
  `;

  // ─── HTML template ────────────────────────────────────────────────────────

  function buildHTML() {
    const cfg = loadConfig();
    return `
      <div class="rpa-header" id="rpa-drag-handle">
        <span>⏱ Replicon Autofill</span>
        <button class="rpa-toggle" id="rpa-collapse-btn" title="Collapse">▼</button>
      </div>
      <div class="rpa-body" id="rpa-body">

        <div class="rpa-section">
          <label>🕐 Time Punches</label>
          <div class="rpa-row">
            <input type="text" id="rpa-in-time"  value="${cfg.inTime}"  placeholder="IN  e.g. 8:00 am" />
            <input type="text" id="rpa-out-time" value="${cfg.outTime}" placeholder="OUT e.g. 4:00 pm" />
          </div>
          <div class="rpa-row">
            <button class="rpa-btn rpa-btn-primary" id="rpa-fill-punches">Fill Punches</button>
            <small style="color:#868e96">Skips holidays &amp; filled days</small>
          </div>
        </div>

        <hr/>

        <div class="rpa-section">
          <label>📋 Time Distribution</label>
          <div class="rpa-row">
            <input type="text" id="rpa-project-code" value="${cfg.projectCode}" placeholder="Project / task name…" />
            <input type="text" id="rpa-hours" value="${cfg.hoursPerDay}" placeholder="hrs" style="width:52px;flex:none" />
          </div>
          <div class="rpa-row">
            <input type="text" id="rpa-activity" value="${cfg.activity}" placeholder="Activity (e.g. 01 Regular Time)" />
          </div>
          <div class="rpa-row">
            <input type="text" id="rpa-place-of-work" value="${cfg.placeOfWork}" placeholder="Place of Work (e.g. Home)" />
          </div>
          <div class="rpa-row">
            <button class="rpa-btn rpa-btn-primary" id="rpa-fill-dist">Fill Distribution</button>
            <small style="color:#868e96">Skips non-zero cells</small>
          </div>
        </div>

        <hr/>

        <div class="rpa-section">
          <label>🚀 Fill All</label>
          <div class="rpa-row">
            <button class="rpa-btn rpa-btn-primary" id="rpa-fill-all" style="width:100%">
              Fill Punches + Distribution
            </button>
          </div>
        </div>

        <hr/>
        <div id="rpa-log" class="rpa-log"></div>
        <div class="rpa-status" id="rpa-status">Ready — ${Detector.getPeriodLabel()}</div>
      </div>
    `;
  }

  // ─── Log helper ───────────────────────────────────────────────────────────

  function log(msg, type = 'info') {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = type;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog() {
    if (logEl) logEl.innerHTML = '';
  }

  function setStatus(msg) {
    const el = document.getElementById('rpa-status');
    if (el) el.textContent = msg;
  }

  // ─── Config persistence ───────────────────────────────────────────────────

  const STORAGE_KEY = 'replicon_autofill_config';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch (_) {}
    return defaultConfig();
  }

  function defaultConfig() {
    return {
      inTime: '8:00 am', outTime: '4:00 pm',
      projectCode: '', hoursPerDay: '8.00',
      activity: '01 Regular Time', placeOfWork: 'Home',
    };
  }

  function saveConfig() {
    const cfg = {
      inTime:      document.getElementById('rpa-in-time')?.value       || '8:00 am',
      outTime:     document.getElementById('rpa-out-time')?.value      || '4:00 pm',
      projectCode: document.getElementById('rpa-project-code')?.value  || '',
      hoursPerDay: document.getElementById('rpa-hours')?.value         || '8.00',
      activity:    document.getElementById('rpa-activity')?.value      || '',
      placeOfWork: document.getElementById('rpa-place-of-work')?.value || '',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return cfg;
  }

  // ─── Drag to reposition ───────────────────────────────────────────────────

  function makeDraggable(panelEl) {
    const handle = document.getElementById('rpa-drag-handle');
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panelEl.style.left   = (e.clientX - ox) + 'px';
      panelEl.style.top    = (e.clientY - oy) + 'px';
      panelEl.style.right  = 'auto';
      panelEl.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ─── Button handlers ──────────────────────────────────────────────────────

  function disableButtons(disabled) {
    ['rpa-fill-punches', 'rpa-fill-dist', 'rpa-fill-all'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = disabled;
    });
  }

  async function handleFillPunches() {
    clearLog();
    const cfg = saveConfig();
    disableButtons(true);
    setStatus('Filling punches…');
    log('▶ Starting punch fill…', 'info');

    try {
      const result = await PunchFiller.fillWeek(
        { inTime: cfg.inTime, outTime: cfg.outTime },
        msg => log(msg, msg.startsWith('✘') ? 'err' : msg.startsWith('⏭') ? 'info' : 'ok')
      );
      log(`Done: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors`, 'ok');
      setStatus(`Punches: ${result.filled} filled`);
    } catch (err) {
      log(`Fatal: ${err.message}`, 'err');
    } finally {
      disableButtons(false);
    }
  }

  async function handleFillDist() {
    clearLog();
    const cfg = saveConfig();
    if (!cfg.projectCode) { log('⚠ Enter a project code first', 'err'); return; }
    disableButtons(true);
    setStatus('Filling distribution…');
    log(`▶ Filling distribution for "${cfg.projectCode}"…`, 'info');

    try {
      const result = await DistributionFiller.fillDistribution(
        cfg.projectCode,
        { hoursPerDay: cfg.hoursPerDay, activity: cfg.activity, placeOfWork: cfg.placeOfWork },
        msg => log(msg, msg.startsWith('✘') ? 'err' : msg.startsWith('⏭') ? 'info' : 'ok')
      );
      result.errors.forEach(e => log(`✘ ${e}`, 'err'));
      log(`Done: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors`, result.errors.length ? 'err' : 'ok');
      setStatus(`Distribution: ${result.filled} filled`);
    } catch (err) {
      log(`Fatal: ${err.message}`, 'err');
    } finally {
      disableButtons(false);
    }
  }

  async function handleFillAll() {
    clearLog();
    const cfg = saveConfig();
    disableButtons(true);
    log('▶ Fill All: punches + distribution', 'info');

    try {
      const pr = await PunchFiller.fillWeek(
        { inTime: cfg.inTime, outTime: cfg.outTime },
        msg => log(msg, msg.startsWith('✘') ? 'err' : msg.startsWith('⏭') ? 'info' : 'ok')
      );
      log(`Punches: ${pr.filled} filled, ${pr.skipped} skipped`, 'ok');

      if (cfg.projectCode) {
        const dr = await DistributionFiller.fillDistribution(
          cfg.projectCode,
          { hoursPerDay: cfg.hoursPerDay, activity: cfg.activity, placeOfWork: cfg.placeOfWork },
          msg => log(msg, msg.startsWith('✘') ? 'err' : msg.startsWith('⏭') ? 'info' : 'ok')
        );
        log(`Distribution: ${dr.filled} filled, ${dr.skipped} skipped`, 'ok');
      } else {
        log('ℹ No project code – skipping distribution', 'info');
      }
      setStatus('All done ✔');
    } catch (err) {
      log(`Fatal: ${err.message}`, 'err');
    } finally {
      disableButtons(false);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    if (document.getElementById(PANEL_ID)) return; // already injected
    if (!Detector.isTimesheetPage()) return;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Create panel
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = buildHTML();
    document.body.appendChild(panel);

    logEl = document.getElementById('rpa-log');

    // Collapse / expand
    document.getElementById('rpa-collapse-btn').addEventListener('click', () => {
      const body = document.getElementById('rpa-body');
      const btn  = document.getElementById('rpa-collapse-btn');
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      btn.textContent = collapsed ? '▼' : '▲';
    });

    // Wire buttons
    document.getElementById('rpa-fill-punches').addEventListener('click', handleFillPunches);
    document.getElementById('rpa-fill-dist').addEventListener('click', handleFillDist);
    document.getElementById('rpa-fill-all').addEventListener('click', handleFillAll);

    makeDraggable(panel);

    log(`Page detected: ${Detector.getPeriodLabel()}`, 'info');
  }

  return { init };
})();
