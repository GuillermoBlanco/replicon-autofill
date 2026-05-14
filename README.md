# Replicon Autofill

Auto-fill **time punches** and **time distribution** on Replicon timesheets.  
Skips holidays, weekends, and already-filled days.

Available as two delivery formats:

| Format | Best for |
|---|---|
| **Chrome Extension** | Daily use – popup UI, settings persist across visits |
| **Bookmarklet** | Quick one-off use – no install required |

---

## Chrome Extension (recommended)

<img width="466" height="235" alt="image" src="https://github.com/user-attachments/assets/07f06503-55f3-43ba-93b4-11842996cbb7" />

### Install (unpacked / developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. A clock icon appears in your toolbar

### Usage

1. Navigate to your Replicon timesheet and **log in** (SAML or user+pass)
2. Click the extension icon → configure times and project
3. Press **Fill Punches**, **Fill Distribution**, or **Fill All**

The panel also **auto-injects** into the page as a draggable floating widget
(bottom-right corner) so you don't need to open the popup every time.

### Configuration (popup or floating panel)

| Field | Example | Notes |
|---|---|---|
| IN time | `8:00 am` | 12-hour format with `am/pm` |
| OUT time | `4:00 pm` | |
| Project | `Capgemini Internal` | Partial name match – case insensitive |
| Hrs/day | `8.00` | Decimal format |

Settings are saved to `localStorage` (per Replicon domain) automatically.

---

## Bookmarklet

### Build

```bash
npm install
npm run build:bookmarklet
# → dist/bookmarklet.url.txt contains the javascript: URL
```

### Install

1. Show the bookmarks bar in Chrome (`Ctrl+Shift+B`)
2. Right-click → **Add page** → paste the content of `dist/bookmarklet.url.txt` as the URL
3. Name it `Replicon Autofill`

### Usage

1. Open the Replicon timesheet and authenticate
2. Click the bookmark → the floating panel appears
3. Use the panel exactly like the extension popup

> **Note:** If `dist/bookmarklet.url.txt` does not yet exist, copy the raw
> contents of `bookmarklet/bookmarklet.js` into the browser console on the
> timesheet page to run it directly.

---

## Project Structure

```
replicon-autofill/
├── extension/
│   ├── manifest.json              Chrome MV3 manifest
│   ├── icons/                     16 / 48 / 128 px PNG icons
│   ├── popup/
│   │   ├── popup.html             Extension popup UI
│   │   ├── popup.css
│   │   └── popup.js               Popup controller (sends messages to content)
│   └── content/
│       ├── content.js             Entry point + chrome.runtime message router
│       └── modules/
│           ├── detector.js        DOM inspection (days, holidays, cells)
│           ├── punchFiller.js     Fills IN/OUT punches sequentially
│           ├── distributionFiller.js  Fills time distribution hours
│           └── ui.js              Floating panel UI (draggable, collapsible)
├── bookmarklet/
│   └── bookmarklet.js             Standalone readable source (all modules inlined)
├── scripts/
│   └── build-bookmarklet.js       Minify + wrap for bookmark URL
└── package.json
```

---

## How it works

### Punch filling logic

```
For each day Mon–Sun:
  skip  → isHoliday (.holidayIndicator / .timeOffType present)
  skip  → isDayOff  (.dayOff class)
  skip  → hasPunches (existing .timePunch children)
  fill  → click .addPunchLink
           wait for input[punchform="1"]
           type IN time → select IN radio → click Save
           click .addPunchLink again
           type OUT time → select OUT radio → click Save
```

### Distribution filling logic

```
Find row whose Project/Task text contains projectCode (case-insensitive)
For each day cell in that row:
  skip  → non-working day (mirrors punch logic)
  skip  → cell already has non-zero hours
  fill  → click cell → wait for inline input → type hours → Tab
```

---

## Extending

The modules are designed to be independent and easy to extend:

- **Add break punches**: pass `type: 'BREAK'` to `PunchFiller`'s `addPunch`
- **Multiple projects**: call `DistributionFiller.fillDistribution()` once per project code
- **Different schedules per day**: modify `Detector.getPunchDays()` to attach per-day time overrides
- **Submit timesheet**: add a `submitTimesheet()` function that clicks the "Submit for Approval" button (`button[ref=e82]`)

---

## Caveats

- Replicon's DOM is rendered by Knockout.js — the code uses native input value setters
  and dispatches synthetic events to trigger Knockout's change detection.
- The form interactions are **sequential with delays** because Replicon's punch editor
  is a modal overlay that only allows one punch at a time.
- If Replicon updates their DOM structure, update the selectors in `detector.js`.
