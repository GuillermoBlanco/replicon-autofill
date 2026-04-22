/**
 * detector.js
 * Analyses the current Replicon timesheet DOM and returns a structured
 * description of every day: whether it is fillable, already has punches, etc.
 */

'use strict';

const Detector = (() => {

  /**
   * Returns true when we are on a Replicon timesheet page.
   */
  function isTimesheetPage() {
    return /\/my\/timesheet\//.test(window.location.pathname);
  }

  /**
   * Reads the active timesheet period label, e.g. "April 6, 2026 - April 12, 2026"
   */
  function getPeriodLabel() {
    const el = document.querySelector('.timesheetPeriodSelect');
    return el ? el.textContent.trim() : '';
  }

  /**
   * Inspects the PUNCH section days only.
   * The first group of .day elements that carry an addPunchLink (or are part of
   * the top punch table) covers Mon-Sun of the selected week.
   *
   * Returns an array of DayInfo objects:
   * {
   *   index        : number   (0-6, Mon=0)
   *   date         : string   ("April 7, 2026")
   *   y, m, d      : number   parsed from addPunch onclick
   *   isHoliday    : boolean
   *   isDayOff     : boolean  (weekend)
   *   hasPunches   : boolean
   *   punchCount   : number
   *   addPunchEl   : HTMLElement | null
   *   shouldFill   : boolean  (!isHoliday && !isDayOff && !hasPunches)
   * }
   */
  function getPunchDays() {
    // Punch section days are the ones with an addPunchLink – limit to first 7
    const allDays = Array.from(document.querySelectorAll('.day'));
    const punchDays = allDays.filter(d => d.querySelector('a.addPunchLink'));

    return punchDays.slice(0, 7).map((day, index) => {
      const addLink = day.querySelector('a.addPunchLink');
      const onclickStr = (addLink && addLink.getAttribute('onclick')) || '';
      const dateMatch = onclickStr.match(/"y":(\d+),"m":(\d+),"d":(\d+)/);
      const y = dateMatch ? parseInt(dateMatch[1]) : null;
      const m = dateMatch ? parseInt(dateMatch[2]) : null;
      const d = dateMatch ? parseInt(dateMatch[3]) : null;

      const isHoliday = !!day.querySelector('.holidayIndicator, .timeOffType');
      const isDayOff  = day.classList.contains('dayOff');
      const punches   = day.querySelectorAll('.timePunch');
      const hasPunches = punches.length > 0;

      // Try to read date text from the parent row header
      const dateEl = day.closest('tr')
        ? day.closest('tr').querySelector('td:first-child')
        : null;
      const dateText = dateEl ? dateEl.textContent.trim().replace(/\s+/g, ' ') : `${y}-${m}-${d}`;

      return {
        index,
        date: dateText,
        y, m, d,
        isHoliday,
        isDayOff,
        hasPunches,
        punchCount: punches.length,
        addPunchEl: addLink,
        shouldFill: !isHoliday && !isDayOff && !hasPunches,
      };
    });
  }

  /**
   * Returns the list of distribution timeline rows currently in the grid.
   * Each entry:
   * {
   *   rowEl        : HTMLElement
   *   projectText  : string
   *   taskText     : string
   *   dayCells     : HTMLElement[]   (Mon-Sun)
   * }
   */
  function getDistributionRows() {
    const grid = document.querySelector('.dataGrid.dateGrid');
    if (!grid) return [];

    // Only keep rows that are real project/task entries:
    // - not totalRow / addRowWrapper / timeOff / actionRow
    // - have a task-selector anchor (divDropdown multiLevelSelector) in the task cell
    const bodyRows = Array.from(grid.querySelectorAll('tbody tr')).filter(r =>
      !r.classList.contains('totalRow') &&
      !r.classList.contains('addRowWrapper') &&
      !r.classList.contains('actionRow') &&
      !r.classList.contains('timeOff') &&
      !r.classList.contains('dynamicColSpanRow') &&
      r.querySelector('a.divDropdown.multiLevelSelector') !== null
    );

    return bodyRows.map(row => {
      const taskCell = row.querySelector('.task, .taskFixedWidth');
      const dayCells = Array.from(row.querySelectorAll('.day'));
      return {
        rowEl: row,
        projectText: taskCell ? taskCell.textContent.trim() : '',
        dayCells,
      };
    });
  }

  /**
   * Finds the "+ Add Row" button for the distribution table.
   */
  function getAddRowButton() {
    return document.querySelector('#add-new-timeline') ||
      document.querySelector('a[aria-label*="Add New TimeLine"]') ||
      document.querySelector('[onclick*="AddNewTimeLine"], [onclick*="addNewTimeLine"]') ||
      Array.from(document.querySelectorAll('button, a')).find(b => /^\+\s*Add Row$/i.test(b.textContent.trim()));
  }

  return { isTimesheetPage, getPeriodLabel, getPunchDays, getDistributionRows, getAddRowButton };
})();
