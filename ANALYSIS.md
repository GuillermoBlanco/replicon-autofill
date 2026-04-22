# Technical Analysis

## Context

**Target:** Replicon Timesheet SPA  
**URL pattern:** `https://eu3.replicon.com/Capgemini/my/timesheet/YYYY-M-D`  
**Frontend framework:** Knockout.js (reactive data bindings)  
**Authentication:** Capgemini SAML SSO — no credentials handled by this tool; scripts run post-login on the already-authenticated page.

---

## DOM Analysis: Time Punches

### Week layout

The timesheet renders one `.day` element per calendar day. The first 7 `.day` elements that contain an `a.addPunchLink` correspond to Mon–Sun of the displayed week.

```
.day                          ← one per day
  a.addPunchLink              ← click to add a new punch
  .timePunch                  ← present only if the day already has punches
  .holidayIndicator           ← present on public holidays
  .timeOffType                ← present on approved time-off days
  .dayOff                     ← class added for weekends (Sat/Sun)
```

### Punch editor

Clicking `a.addPunchLink` triggers:

```javascript
Replicon.Darkwater.Timesheet.Widgets.TimePairPunch.Add(this, {"y":2026,"m":4,"d":8})
```

This opens a modal overlay with:

| Selector | Role |
|---|---|
| `input[class="time"][punchform="1"]` | Time entry (12-hour e.g. `8:00 am`) |
| `input[name="inOutType"][value="IN"]` | Radio — punch type IN |
| `input[name="inOutType"][value="OUT"]` | Radio — punch type OUT |
| `button` containing "Save" | Submit the punch |

**Critical finding:** Replicon uses Knockout.js data bindings. Setting `input.value = x` directly does not notify the viewmodel. The correct approach is to use the native setter and dispatch `input` + `change` events:

```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
nativeSetter.call(input, '8:00 am');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

### Fill decision logic

```
For each day (Mon → Sun):
  SKIP  if .dayOff class present          (weekend)
  SKIP  if .holidayIndicator present      (public holiday)
  SKIP  if .timeOffType present           (time off / non-billable)
  SKIP  if .timePunch children exist      (already filled)
  FILL  otherwise: add IN punch, then OUT punch
```

Punches are filled **sequentially** because the editor is a modal overlay — only one punch can be entered at a time.

---

## DOM Analysis: Time Distribution

The distribution table sits below the punch section. Rows map to project/task assignments.

```
table.timesheet-distribution
  tr.timeline-row                      ← one per project/task
    td.project-label                   ← project name text
    td.day-cell (×7)                   ← one per day
      input.duration                   ← visible after clicking the cell
        aria-label="Timeline N DayName DateNum"
```

A `+ Add Row` button (`a.addTimelineRowBtn`) opens a multi-level project/task selector. Once a row is added and the project is assigned, `input.duration` fields become available.

### Fill decision logic

```
Find row whose label text contains projectCode (case-insensitive partial match)
For each day cell:
  SKIP  if the corresponding day is a weekend / holiday (mirrors punch logic)
  SKIP  if cell already has non-zero hours
  FILL  click cell → wait for input.duration → set value → dispatch Tab
```

---

## Architecture Decisions

### Chrome Extension vs. Bookmarklet

| Concern | Chrome Extension | Bookmarklet |
|---|---|---|
| Persistence | Settings in `chrome.storage.local` | None (UI re-created each click) |
| Ease of use | One-click toolbar icon | Bookmark bar click |
| Installation | Requires loading unpacked (dev mode) | Copy/paste URL |
| SPA re-injection | Content script auto-reruns on navigation | Manual re-click |

Both formats use the same underlying modules (`detector.js`, `punchFiller.js`, `distributionFiller.js`, `ui.js`). The bookmarklet inlines them all into a single IIFE.

### Modular design

```
detector.js          Pure DOM inspection — no side effects
punchFiller.js       Uses Detector; orchestrates punch fill sequence
distributionFiller.js  Uses Detector; orchestrates distribution fill
ui.js                Renders the floating panel; calls Filler modules
content.js           Entry point: waits for DOM, inits UI, handles SPA re-init
```

Each module exposes a single namespace object (`Detector`, `PunchFiller`, `DistributionFiller`, `RepliconUI`) to avoid global pollution.

### Timing and waits

All async waits use polling (`setInterval`) rather than `setTimeout` chains or `MutationObserver` to keep the code simple and debuggable. Each poll has a configurable timeout (default 5–10 s) after which a descriptive error is logged.

---

## Known Limitations

- **"Add Row" project search** — the multi-level selector that opens on `+ Add Row` has dynamic search inputs that proved difficult to automate reliably. Current recommendation: add the row manually, then run "Fill Distribution".
- **Submit timesheet** — not automated. The "Submit for Approval" button can be targeted with `button[ref=e82]` if needed.
- **DOM fragility** — all selectors are based on the DOM observed in April 2026. If Replicon updates their frontend, selectors in `detector.js` may need updating.
