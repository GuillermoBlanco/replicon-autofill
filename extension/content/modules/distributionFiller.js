/**
 * distributionFiller.js
 * Fills the "Time Distribution" section of a Replicon timesheet.
 *
 * Strategy:
 *  1. Detect existing rows via Detector.getDistributionRows()
 *  2. Find a row matching the given projectCode (partial name match) OR add a new row
 *  3. For each fillable day column (non-holiday, non-weekend, cell is 0/empty):
 *     a. Click the day cell → wait for inline editor → set hours → confirm
 *  4. Optionally set Activity / Work Location from config
 *
 * Note: The distribution grid shares the same `.day` column elements as the
 * punch table – same skip logic applies (dayOff, holiday).
 */

'use strict';

const DistributionFiller = (() => {

  const DEFAULTS = {
    hoursPerDay: '8.00',
    activity:    '01 Regular Time', // leave empty to skip
    placeOfWork: 'Home',            // leave empty to skip
    formTimeout: 5000,
    stepDelay: 400,
  };

  // ─── Helpers (shared pattern with punchFiller) ────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitFor(predicate, timeout = DEFAULTS.formTimeout, label = '') {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const id = setInterval(() => {
        const result = predicate();
        if (result) { clearInterval(id); resolve(result); }
        else if (Date.now() - start > timeout) {
          clearInterval(id);
          reject(new Error(`Timeout: ${label}`));
        }
      }, 100);
    });
  }

  function setInputValue(input, value) {
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // ─── Row / cell helpers ───────────────────────────────────────────────────

  /**
   * Finds an existing distribution row whose Project/Task text contains projectCode.
   * Returns the row element or null.
   */
  function findRowByProject(projectCode) {
    const rows = Detector.getDistributionRows();
    const lc = projectCode.toLowerCase();
    return rows.find(r => r.projectText.toLowerCase().includes(lc)) || null;
  }

  /**
   * Clicks "+ Add Row" and waits for the new row to appear.
   * Returns the new row element.
   */
  async function addNewRow() {
    const btn = Detector.getAddRowButton();
    if (!btn) throw new Error('Add Row button not found');
    const beforeCount = Detector.getDistributionRows().length;
    btn.click();
    // Wait for a new project row with a selection-needed anchor to appear
    const newRowEl = await waitFor(
      () => {
        const rows = Detector.getDistributionRows();
        if (rows.length <= beforeCount) return null;
        // The new row will have the divDropdownSelectionNeeded class (no project chosen yet)
        const newRow = rows.find(r =>
          r.rowEl.querySelector('a.divDropdown.multiLevelSelector.divDropdownSelectionNeeded') !== null
        );
        return newRow ? newRow.rowEl : null;
      },
      DEFAULTS.formTimeout, 'new distribution row'
    );
    return newRowEl;
  }

  /**
   * Opens the Project/Task combo in a row and searches for projectCode.
   * Selects the first matching option.
   *
   * Live DOM facts (inspected April 2026):
   *  - Visible trigger: <a class="divDropdown multiLevelSelector TaskSelectorSearchFixedWidth …">
   *  - Search input lives in <div class="taskSelectorSearchField hasFocus"> after click
   *  - Results: ul.divDropdownList.divDropdownListTable > li[isdataelement="true"]
   */
  async function selectProject(rowElParam, projectCode) {
    // rowEl may be stale if Knockout re-rendered the row list after insertion —
    // always check isConnected and re-fetch the empty "selection needed" row if so.
    let rowEl = rowElParam;
    if (!rowEl.isConnected) {
      const freshRow = Detector.getDistributionRows()
        .find(r => r.rowEl.querySelector('a.divDropdown.multiLevelSelector.divDropdownSelectionNeeded') !== null);
      if (!freshRow) throw new Error('Task selector anchor not found in row');
      rowEl = freshRow.rowEl;
    }

    // Prefer TaskSelectorSearchFixedWidth (the search-box trigger) over the category dropdown.
    // Fall back to any visible multiLevelSelector anchor.
    const trigger = rowEl.querySelector('a.divDropdown.multiLevelSelector.TaskSelectorSearchFixedWidth') ||
      Array.from(rowEl.querySelectorAll('a.divDropdown.multiLevelSelector')).find(el => el.offsetParent !== null);
    if (!trigger) throw new Error('Task selector anchor not found in row');
    trigger.click();
    await sleep(DEFAULTS.stepDelay);

    // Wait for the search input inside the dropdown to become visible
    const searchInput = await waitFor(
      () => {
        const containers = document.querySelectorAll('.taskSelectorSearchField');
        for (const c of containers) {
          const inp = c.querySelector('input');
          if (inp && inp.offsetParent !== null) return inp;
        }
        return null;
      },
      DEFAULTS.formTimeout, 'project search input'
    );

    setInputValue(searchInput, projectCode);
    await sleep(800); // wait for search results to populate

    // Pick the best result: prefer a starred search item, then any starred item, then first.
    // Recent-list items (taskSelectorRecentRowItem) can be starred but need different handling;
    // prefer taskSelectorSearchAllRowItem entries when available.
    // IMPORTANT: Only consider items inside a VISIBLE panel – there can be multiple stale
    // hidden panels in the DOM from previous dropdown openings that also match selectors.
    // Star indicator: <span class="material-icons">star</span> (vs star_outline).
    const targetResult = await waitFor(
      () => {
        const items = Array.from(document.querySelectorAll(
          'ul.divDropdownList.divDropdownListTable li[isdataelement="true"]'
        )).filter(li => {
          const panel = li.closest('ul.divDropdownList.divDropdownListTable');
          return panel && panel.offsetParent !== null && li.textContent.includes(projectCode);
        });
        if (!items.length) return null;
        // Prefer starred search items (has taskSelectorSearchAllRowItem)
        const starredSearch = items.find(li =>
          li.querySelector('a.taskSelectorSearchAllRowItem') &&
          li.querySelector('span.material-icons')?.textContent.trim() === 'star'
        );
        if (starredSearch) return starredSearch;
        // Fall back to any starred item
        const starred = items.find(li =>
          li.querySelector('span.material-icons')?.textContent.trim() === 'star'
        );
        return starred || items[0];
      },
      DEFAULTS.formTimeout, `project result for "${projectCode}"`
    );
    // Click the inner anchor. Search items use taskSelectorSearchAllRowItem;
    // recent items use taskSelectorRecentRowItem. Fall back to the <li>.
    // IMPORTANT: Knockout's task-selector component requires the full pointer event
    // sequence with real clientX/clientY coordinates. A bare element.click() (which
    // has no coordinates) is silently ignored. Scroll into view first so the element
    // has a non-zero bounding rect, then dispatch pointerdown → mousedown → mouseup
    // → pointerup → click with the element's centre coordinates.
    const clickTarget = targetResult.querySelector('a.taskSelectorSearchAllRowItem') ||
      targetResult.querySelector('a.taskSelectorRecentRowItem') ||
      targetResult;
    clickTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await sleep(120);
    {
      const r   = clickTarget.getBoundingClientRect();
      const cx  = r.left + r.width  / 2;
      const cy  = r.top  + r.height / 2;
      const evt = {
        bubbles: true, cancelable: true, view: window,
        clientX: cx,  clientY: cy,
        screenX: cx + (window.screenX || 0),
        screenY: cy + (window.screenY || 0),
        button: 0, buttons: 1,
      };
      clickTarget.dispatchEvent(new PointerEvent('pointerover',  { ...evt }));
      clickTarget.dispatchEvent(new MouseEvent  ('mouseover',    { ...evt }));
      clickTarget.dispatchEvent(new PointerEvent('pointerdown',  evt));
      clickTarget.dispatchEvent(new MouseEvent  ('mousedown',    evt));
      await sleep(40);
      clickTarget.dispatchEvent(new PointerEvent('pointerup',    evt));
      clickTarget.dispatchEvent(new MouseEvent  ('mouseup',      evt));
      clickTarget.dispatchEvent(new MouseEvent  ('click',        evt));
    }
    await sleep(DEFAULTS.stepDelay);
  }

  /**
   * Checks whether a day cell in a distribution row is empty (value is 0 or blank).
   * The cell contains an <input class="duration"> whose .value holds the hours.
   */
  function isCellEmpty(cellEl) {
    const input = cellEl.querySelector('input.duration');
    if (input) {
      const v = input.value.trim();
      return v === '' || v === '0' || v === '0.00';
    }
    const text = cellEl.textContent.trim();
    return text === '' || text === '0' || text === '0.00' || text === '-';
  }

  /**
   * Checks whether a distribution day cell corresponds to a non-working day.
   * Cells on holidays or weekends typically carry `.dayOff` or `.holiday` on the
   * column header – we check the cell's own class as a fallback.
   */
  function isCellFillable(cellEl) {
    return !cellEl.classList.contains('dayOff') &&
           !cellEl.classList.contains('holiday') &&
           !cellEl.classList.contains('readOnly') &&
           !cellEl.classList.contains('timeOff');
  }

  /**
   * Opens a Replicon dropdown cell and selects the first option whose text
   * includes `optionText`.
   *
   * Handles two Replicon dropdown patterns:
   *  A) Activity / Place of Work  – uses a shared `divDropdownContent` panel
   *     identified by the trigger's `dropdowncontentid` attribute. Options are
   *     `ul.divDropdownList li a`. A satellite search input (id from
   *     `satelliteids`) filters results if no direct match is visible.
   *  B) Project / Task selector   – handled separately in selectProject().
   *
   * @param {Element} triggerEl  – the clickable anchor/button inside the cell
   * @param {string}  optionText – text to search for (partial, case-sensitive)
   * @param {object}  config     – merged config (for timeouts / delays)
   */
  async function selectDropdownOption(triggerEl, optionText, config) {
    const dropdownContentId = triggerEl.getAttribute('dropdowncontentid');
    const satelliteId       = triggerEl.getAttribute('satelliteids');

    triggerEl.click();
    await sleep(config.stepDelay);

    // Wait for the dropdown content panel to become visible
    const ddPanel = await waitFor(
      () => {
        const el = dropdownContentId ? document.getElementById(dropdownContentId) : null;
        return el && el.offsetParent !== null ? el : null;
      },
      config.formTimeout, `dropdown panel for "${optionText}"`
    );

    // Try to find the option directly (no search needed for short lists)
    let option = Array.from(ddPanel.querySelectorAll('ul li a'))
      .find(a => a.textContent.trim().includes(optionText));

    if (!option && satelliteId) {
      // Type into satellite search input to filter
      const sat = document.getElementById(satelliteId);
      if (sat) {
        setInputValue(sat, optionText);
        await sleep(400);
        option = await waitFor(
          () => Array.from(ddPanel.querySelectorAll('ul li a'))
                     .find(a => a.textContent.trim().includes(optionText)) || null,
          config.formTimeout, `dropdown option "${optionText}" after search`
        );
      }
    }

    if (!option) throw new Error(`Option "${optionText}" not found in dropdown`);
    option.click();
    await sleep(config.stepDelay);
  }

  /**
   * Sets Activity and Place of Work dropdowns for a distribution row after it
   * has been located or added.
   *
   * Live DOM facts (April 2026):
   *  - Activity:     td.activity > span > a.divDropdown
   *  - Place of Work: td.extensionField a[aria-label*="Place of Work"]
   *  Both share dropdowncontentid="jncmupkt" and the satellite input "szjfdkvx".
   */
  async function setRowMetadata(rowEl, config, onProgress) {
    if (config.activity) {
      try {
        const trigger = rowEl.querySelector('td.activity a.divDropdown');
        if (trigger) {
          await selectDropdownOption(trigger, config.activity, config);
          onProgress(`  ✔ Activity → "${config.activity}"`);
        } else {
          onProgress(`  ⚠ Activity cell not found – skipped`);
        }
      } catch (err) {
        onProgress(`  ⚠ Activity not set: ${err.message}`);
      }
    }

    if (config.placeOfWork) {
      try {
        const trigger = rowEl.querySelector('a[aria-label*="Place of Work"]');
        if (trigger) {
          await selectDropdownOption(trigger, config.placeOfWork, config);
          onProgress(`  ✔ Place of Work → "${config.placeOfWork}"`);
        } else {
          onProgress(`  ⚠ Place of Work cell not found – skipped`);
        }
      } catch (err) {
        onProgress(`  ⚠ Place of Work not set: ${err.message}`);
      }
    }
  }

  /**
   * Sets hours in a day cell. The cell contains a persistent <input class="duration">
   * (type="text") that is always visible — no click needed to reveal it.
   */
  async function fillDayCell(cellEl, hours) {
    // input.duration is always present in the cell
    const input = cellEl.querySelector('input.duration') ||
                  cellEl.querySelector('input[type="text"], input[type="number"]');
    if (!input) throw new Error('duration input not found in day cell');

    setInputValue(input, hours);
    // Tab to the next cell and blur to ensure Knockout commits the value
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Tab', keyCode: 9, bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await sleep(DEFAULTS.stepDelay / 2);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Fills distribution hours for a given project code across the current week.
   *
   * @param {string}   projectCode  – partial project/task name to search for
   * @param {object}   options      – override defaults
   * @param {function} onProgress   – callback(message: string)
   * @returns {Promise<{filled: number, skipped: number, errors: string[]}>}
   */
  async function fillDistribution(projectCode, options = {}, onProgress = () => {}) {
    const config = { ...DEFAULTS, ...options };
    let filled = 0, skipped = 0;
    const errors = [];

    onProgress(`🔍 Looking for project row: "${projectCode}"`);

    let rowEntry = findRowByProject(projectCode);
    let rowEl;

    if (rowEntry) {
      rowEl = rowEntry.rowEl;
      onProgress(`✔ Found existing row: "${rowEntry.projectText}"`);
    } else {
      onProgress(`➕ No matching row – adding new row…`);
      try {
        rowEl = await addNewRow();
        await selectProject(rowEl, projectCode);
        onProgress(`✔ Project "${projectCode}" selected`);
      } catch (err) {
        errors.push(`Failed to add/find project row: ${err.message}`);
        return { filled, skipped, errors };
      }
    }

    // Set Activity and Place of Work before filling day cells
    await setRowMetadata(rowEl, config, onProgress);

    // Refresh row entry to get current day cells
    const rows = Detector.getDistributionRows();
    rowEntry = rows.find(r => r.rowEl === rowEl) || { dayCells: Array.from(rowEl.querySelectorAll('.day')) };
    const dayCells = rowEntry.dayCells;

    // Align punch days with distribution cells (both are 0-indexed Mon-Sun)
    const punchDays = Detector.getPunchDays();

    for (let i = 0; i < punchDays.length && i < dayCells.length; i++) {
      const pday = punchDays[i];
      const cell = dayCells[i];

      if (pday.isHoliday || pday.isDayOff) {
        onProgress(`⏭ Skipping ${pday.date} (non-working)`);
        skipped++;
        continue;
      }

      if (!isCellFillable(cell)) {
        onProgress(`⏭ Skipping ${pday.date} (cell not fillable)`);
        skipped++;
        continue;
      }

      if (!isCellEmpty(cell)) {
        onProgress(`⏭ Skipping ${pday.date} (already has hours: ${cell.textContent.trim()})`);
        skipped++;
        continue;
      }

      try {
        await fillDayCell(cell, config.hoursPerDay);
        onProgress(`  ✔ ${pday.date} → ${config.hoursPerDay} hrs`);
        filled++;
      } catch (err) {
        const msg = `✘ ${pday.date}: ${err.message}`;
        onProgress(msg);
        errors.push(msg);
      }
    }

    return { filled, skipped, errors };
  }

  return { fillDistribution };
})();
