/**
 * punchFiller.js
 * Fills time punches for all "fillable" days in the current timesheet week.
 *
 * Strategy:
 *  1. Detect days via Detector.getPunchDays()
 *  2. Skip holidays, weekends, already-filled days
 *  3. For each missing day:
 *     a. Click "+ Add Punch" → wait for edit form → set IN time → Save
 *     b. Click "+ Add Punch" again → set OUT time → Save
 *  4. Report results
 *
 * Design: sequential async (Replicon's form is modal – one at a time).
 */

'use strict';

const PunchFiller = (() => {

  const DEFAULTS = {
    inTime: '8:00 am',
    outTime: '4:00 pm',
    formTimeout: 8000,  // ms to wait for form to appear/disappear
    stepDelay: 500,     // ms between UI interactions
    postSaveDelay: 900, // ms after form closes – lets Knockout finish re-rendering
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Waits until `predicate()` returns truthy, polling every 100ms.
   * Rejects after `timeout` ms.
   */
  function waitFor(predicate, timeout = DEFAULTS.formTimeout, label = '') {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const result = predicate();
        if (result) {
          clearInterval(interval);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for: ${label}`));
        }
      }, 100);
    });
  }

  /**
   * Returns the TIME <input> inside the punch form overlay, or null.
   * Selects by CSS class "time" + attribute punchform (not exact class= match).
   * The Date input has class "date" and also punchform="1" — we must not match it.
   */
  function getPunchForm() {
    // input.time matches elements whose class list contains "time"
    const timeInput = document.querySelector('input.time[punchform]');
    return (timeInput && timeInput.offsetParent !== null) ? timeInput : null;
  }

  /** Waits for the punch form to appear and returns the time input. */
  function waitForForm() {
    return waitFor(getPunchForm, DEFAULTS.formTimeout, 'punch form to open');
  }

  /** Waits for the punch form to disappear. */
  function waitForFormClose() {
    return waitFor(() => !getPunchForm(), DEFAULTS.formTimeout, 'punch form to close');
  }

  /**
   * Sets a text input's value in a way Knockout's bindings will accept.
   * Retries up to 3 times in case Knockout's initial bind overwrites the value.
   */
  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (let attempt = 0; attempt < 3; attempt++) {
      input.focus();
      input.click();
      nativeSetter.call(input, value);
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'm' }));
      if (input.value === value) break;
      // Value was overwritten by Knockout — wait one tick and retry
    }
    if (input.value !== value) {
      console.warn(`[RepliconAutofill] setInputValue: value stuck as "${input.value}" instead of "${value}"`);
    }
  }

  /**
   * Selects the IN / BREAK / OUT type in the punch form.
   * IMPORTANT: search is scoped to the form container to avoid accidentally
   * clicking ⚠ Out badges or other "OUT"-labelled elements behind the modal.
   */
  function selectPunchType(typeLabel) {
    const target = typeLabel.trim().toUpperCase();
    const isVisible = el => el.offsetParent !== null;
    const container = getPunchFormContainer();

    // Strategy 1: scoped — any element inside the form whose trimmed text matches
    const CANDIDATES = 'button, a, span, li, div[role="button"], label';
    const byText = Array.from(container.querySelectorAll(CANDIDATES))
      .find(el => isVisible(el) && el.textContent.trim().toUpperCase() === target);

    if (byText) {
      byText.click();
      byText.dispatchEvent(new Event('change', { bubbles: true }));
      byText.dispatchEvent(new Event('input',  { bubbles: true }));
      return true;
    }

    // Strategy 2: scoped radio inputs
    const radio = Array.from(container.querySelectorAll('input[type="radio"]'))
      .filter(isVisible)
      .find(r => {
        const lbl = container.querySelector(`label[for="${r.id}"]`);
        const lblText = lbl ? lbl.textContent.trim().toUpperCase() : '';
        return lblText === target || r.value.toUpperCase().includes(target);
      });

    if (radio && !radio.checked) {
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.dispatchEvent(new Event('input',  { bubbles: true }));
      return true;
    }
    if (radio) return true;

    console.warn(`[RepliconAutofill] Could not find "${typeLabel}" button in form container. Container HTML:`, container.innerHTML.slice(0, 500));
    return false;
  }

  /**
   * Finds the form's parent container by walking up from the TIME input.
   */
  function getPunchFormContainer() {
    const timeInput = document.querySelector('input.time[punchform]');
    if (!timeInput) return document.body;
    let el = timeInput.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!el || el === document.body) break;
      if (el.offsetHeight > 60) return el;
      el = el.parentElement;
    }
    return document.body;
  }

  /** Clicks the Save / Add button inside the punch form. */
  function clickSave() {
    const container = getPunchFormContainer();

    // Texts Replicon uses for the confirm action (varies by locale / form type)
    const ACTION_TEXTS = ['save', 'add', 'ok', 'submit', 'apply', 'done'];

    const isVisible = el => el.offsetParent !== null;

    // 1. button[punchform] attribute (same attribute on the time input)
    const byAttr = container.querySelector('button[punchform]') ||
                   document.querySelector('button[punchform]');
    if (byAttr && isVisible(byAttr)) { byAttr.click(); return true; }

    // 2. input[type=submit] (some Replicon builds use this)
    const submitInput = Array.from(container.querySelectorAll('input[type="submit"], input[type="button"]'))
      .find(isVisible);
    if (submitInput) { submitInput.click(); return true; }

    // 3. Any <button> / <a> whose visible text matches known action words — scoped to container first
    const allBtns = [
      ...Array.from(container.querySelectorAll('button, a.button, a[role="button"]')),
      ...Array.from(document.querySelectorAll('button, a.button, a[role="button"]')),
    ];
    const seen = new Set();
    const dedupedBtns = allBtns.filter(b => {
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });

    const byText = dedupedBtns.find(b => {
      const txt = b.textContent.trim().toLowerCase();
      return isVisible(b) && ACTION_TEXTS.some(a => txt === a);
    });
    if (byText) { byText.click(); return true; }

    // 4. button[type=submit] anywhere that is visible
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]'))
      .find(isVisible);
    if (submitBtn) { submitBtn.click(); return true; }

    // 5. Keyboard fallback — press Enter on the focused time input
    const timeInput = document.querySelector('input.time[punchform]');
    if (timeInput) {
      timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      timeInput.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
      // We can't tell if this worked — return true and let waitForFormClose detect failure
      return true;
    }

    // Diagnostics: log every visible button to help identify the real selector
    const visible = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]'))
      .filter(isVisible)
      .map(b => `<${b.tagName.toLowerCase()} class="${b.className}" type="${b.type || ''}">${b.textContent.trim()}</${b.tagName.toLowerCase()}>`);
    console.warn('[RepliconAutofill] Save button not found. Visible buttons:', visible);
    return false;
  }

  // ─── Core punch logic ─────────────────────────────────────────────────────

  /**
   * Adds a single punch (IN or OUT) for a given day.
   * @param {object} dayInfo  – DayInfo object from Detector.getPunchDays() (needs y, m, d, addPunchEl)
   * @param {string} time     – e.g. "8:00 am"
   * @param {string} type     – "IN" | "OUT" | "BREAK"
   */
  async function addPunch(dayInfo, time, type) {
    // Wait until the addPunchLink for this specific day is present and visible.
    // After saving the IN punch, Knockout re-renders the punch row — the link
    // may be briefly detached/replaced during that transition.
    let liveLink = null;
    await waitFor(
      () => {
        const fresh = Detector.getPunchDays().find(
          fd => fd.d === dayInfo.d && fd.m === dayInfo.m
        );
        if (fresh && fresh.addPunchEl && fresh.addPunchEl.offsetParent !== null) {
          liveLink = fresh.addPunchEl;
          return true;
        }
        return false;
      },
      DEFAULTS.formTimeout,
      `addPunchLink for ${dayInfo.m}/${dayInfo.d} to be ready`
    );

    // Prefer Replicon's internal API — works even when the DOM link is mid-render.
    const api = window.Replicon &&
      window.Replicon.Darkwater &&
      window.Replicon.Darkwater.Timesheet &&
      window.Replicon.Darkwater.Timesheet.Widgets &&
      window.Replicon.Darkwater.Timesheet.Widgets.TimePairPunch;

    if (api && dayInfo.y != null) {
      api.Add(liveLink, { y: dayInfo.y, m: dayInfo.m, d: dayInfo.d });
    } else {
      liveLink.click();
    }

    const timeInput = await waitForForm();
    await sleep(DEFAULTS.stepDelay);

    // Set type FIRST — clicking a type button can trigger a Knockout update
    // that clears the time field, so we must select type before writing time.
    selectPunchType(type);
    await sleep(DEFAULTS.stepDelay);

    // Now set the time value into the correct TIME input (not the Date input)
    setInputValue(timeInput, time);
    await sleep(DEFAULTS.stepDelay);

    // Verify the value actually stuck; retry once if Knockout still cleared it
    if (timeInput.value !== time) {
      await sleep(200);
      setInputValue(timeInput, time);
      await sleep(DEFAULTS.stepDelay);
    }
    console.log(`[RepliconAutofill] ${type} — time field: "${timeInput.value}" (expected "${time}")`);

    // Save
    if (!clickSave()) throw new Error('Could not find Save/Add button');
    await waitForFormClose();
    await sleep(DEFAULTS.postSaveDelay);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Fills punches for all missing days in the current week.
   * @param {object} options  – override default times
   * @param {function} onProgress – callback(message: string)
   * @returns {Promise<{filled: number, skipped: number, errors: string[]}>}
   */
  async function fillWeek(options = {}, onProgress = () => {}) {
    const config = { ...DEFAULTS, ...options };
    const days = Detector.getPunchDays();
    let filled = 0, skipped = 0;
    const errors = [];

    for (const day of days) {
      if (!day.shouldFill) {
        const reason = day.isHoliday ? 'holiday' : day.isDayOff ? 'day off' : 'already filled';
        onProgress(`⏭ Skipping ${day.date} (${reason})`);
        skipped++;
        continue;
      }

      try {
        onProgress(`⏳ Filling ${day.date}…`);

        // Re-query each iteration — Knockout may have replaced DOM elements
        const freshDays = Detector.getPunchDays();
        const freshDay  = freshDays.find(fd => fd.d === day.d && fd.m === day.m);
        if (!freshDay) throw new Error('Day not found after re-query');

        await addPunch(freshDay, config.inTime,  'IN');
        onProgress(`  ✔ ${day.date} IN  ${config.inTime}`);

        // Re-query again after IN punch — DOM will have re-rendered
        const afterIn  = Detector.getPunchDays();
        const dayAfter = afterIn.find(fd => fd.d === day.d && fd.m === day.m);
        // dayAfter.addPunchEl may be null if DOM hasn't stabilised yet; the
        // API path in addPunch only needs y/m/d which are stable value types.
        if (!dayAfter) throw new Error('Day not found after IN punch');

        await addPunch(dayAfter, config.outTime, 'OUT');
        onProgress(`  ✔ ${day.date} OUT ${config.outTime}`);

        filled++;
      } catch (err) {
        const msg = `✘ ${day.date}: ${err.message}`;
        onProgress(msg);
        errors.push(msg);
        // Try to close any stray form
        const cancelBtn = document.querySelector('button[data-bind*="onCancelClick"]') ||
          Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel' && b.offsetParent);
        if (cancelBtn) cancelBtn.click();
        await sleep(500);
      }
    }

    return { filled, skipped, errors };
  }

  return { fillWeek };
})();
