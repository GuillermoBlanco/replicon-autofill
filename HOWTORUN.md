# How to Run

Two delivery options are available. Choose the one that fits your workflow.

---

## Option A — Chrome Extension (recommended for regular use)

### 1. Prerequisites

- Google Chrome (or any Chromium browser)
- Node.js ≥ 18 (only needed if you want to build the bookmarklet; not required for the extension)

### 2. Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the `extension/` folder inside this repository
5. A clock icon appears in the Chrome toolbar — the extension is active

### 3. Use it

1. Go to `https://eu3.replicon.com/Capgemini/my/timesheet/` and **log in via SSO**
2. Navigate to the week you want to fill
3. A **floating panel** appears automatically in the bottom-right corner of the page
4. Fill in the configuration fields:

   | Field | Example | Notes |
   |---|---|---|
   | IN time | `8:00 am` | 12-hour format with `am` / `pm` |
   | OUT time | `4:00 pm` | |
   | Project | `Capgemini Internal` | Partial name — case-insensitive |
   | Hrs/day | `8.00` | Decimal, e.g. `7.50` for 7h30 |

5. Press the desired action:

   | Button | What it does |
   |---|---|
   | **Fill Punches** | Adds IN + OUT punches for every missing workday |
   | **Fill Distribution** | Fills hours for the matched project row |
   | **Fill All** | Runs both actions sequentially |

6. Watch the log area in the panel for per-day progress and any errors

> Settings are saved automatically. They persist between browser sessions.

### 4. Navigate to a different week

The panel re-initialises automatically when you change the week using Replicon's navigation arrows (SPA navigation is detected via MutationObserver).

---

## Option B — Bookmarklet (quick one-off use, no install)

### 1. Build the bookmarklet URL

```bash
cd C:\Users\guiblanc\Repositories\replicon-autofill
npm install
npm run build:bookmarklet
```

This creates `dist/bookmarklet.url.txt` containing the full `javascript:...` URL.

### 2. Add to Chrome bookmarks

1. Show the bookmarks bar: `Ctrl+Shift+B`
2. Right-click anywhere on the bar → **Add page**
3. Set the **Name** to `Replicon Autofill`
4. Paste the entire content of `dist/bookmarklet.url.txt` as the **URL**
5. Save

### 3. Use it

1. Log in to Replicon and navigate to the target week
2. Click the `Replicon Autofill` bookmark — the floating panel appears
3. Configure and click the action buttons (same as the extension)

> Clicking the bookmark again while the panel is visible toggles it off/on.

### 4. Quick console alternative (no build needed)

If you don't want to install Node.js or build anything:

1. Open `bookmarklet/bookmarklet.js` in any text editor
2. Copy the entire contents
3. Open Chrome DevTools on the authenticated Replicon timesheet page (`F12` → **Console** tab)
4. Paste and press **Enter**
5. The floating panel appears

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Panel does not appear | Extension not loaded or content script blocked | Reload the extension; check `chrome://extensions` for errors |
| "Not a timesheet page" in console | URL doesn't match `*/my/timesheet*` | Navigate to the timesheet first |
| Punch saved but wrong time | Time string format wrong | Use exact format: `8:00 am` (space before am/pm) |
| Distribution fill skips all cells | Project name not found | Check partial name; open DevTools and run `document.querySelector('td.project-label').textContent` to see the real label |
| Fill hangs after one punch | Replicon modal did not close | Refresh the page and try again; the punch was likely saved |
| Selectors stop working after a Replicon update | Replicon changed their DOM | Update selectors in `extension/content/modules/detector.js` |
