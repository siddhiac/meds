# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A client-side PWA medication/health tracker called "Meds". No build step, no server, no dependencies to install — open `index.html` in a browser. All files are served as static assets.

## Running the App

```bash
# Any static file server works. Quickest:
python3 -m http.server 8080
# Then open http://localhost:8080
```

No build, no compile, no `npm install`. Edit files and reload.

## Architecture

### Files
- `index.html` — all HTML structure including every modal
- `app.js` — all application logic (~4900 lines, two classes)
- `styles.css` — all styles including theme variants
- `styles_profile.css` — profile modal styles
- `translations.js` — i18n dictionary for 45 languages (exports `const TRANSLATIONS`)
- `peerjs.min.js` / `qrcode.min.js` — vendored locally (not CDN)
- `sounds/` — alarm MP3s (alarm_01.mp3 … alarm_10.mp3)
- `manifest.json` — PWA manifest

### Two Classes in app.js

**`P2PSync`** (lines 2–741): WebRTC sync over PeerJS. One device is "host", others are "peers". Sync is full-state push on connect plus change broadcasts. Uses `localStorage` keys `p2p_device_id`, `p2p_sync_state`, `p2p_trusted_devices`. Custom PeerJS server can be configured (see `PEERJS_SERVER_SETUP.md`).

**`HealthTracker`** (lines 742–end): All app logic. Instantiated as `window.tracker`. Key methods:
- `initializeApp()` — loads data from localStorage into `this.medications`, `this.appointments`, `this.logs`
- `init()` — attaches all DOM event listeners (called once after profile is selected)
- `switchTab(tab)` — handles tab navigation and rebuilds header actions
- `render*()` methods — `renderMedications()`, `renderAppointments()`, `renderLogs()`, `renderWeeklyView()`, `renderApptCard()`, `renderLogCard()` — all generate innerHTML from current data
- `save*()` methods — `saveMedications()`, `saveAppointments()`, `saveLogs()` — write to `localStorage`

### Data Model

All data is per-profile. Each profile gets a `profileData_<id>` key in localStorage containing `{ medications, appointments, logs }`. Profile list is in `healthProfiles`. Active profile is in `activeProfileId`.

Global (non-profile) localStorage keys: `language`, `theme`, `trackingPreferences`, `metricPreferences`, `timeOfDay_*`, `alarm_*`.

Medication object shape:
```js
{ id, name, dosage, schedule: { frequency, days?, startDate?, durationType?, duration?, endDate?, bottleDoses? }, timesOfDay: ['Morning'|'Afternoon'|'Evening'|'Bedtime'], notes, critical, alarmEnabled }
```

Log object shape: `{ id, datetime, temperature?, bpSystolic?, bpDiastolic?, heartRate?, glucose?, weight?, steps?, oxygenation?, sleep?, notes? }`

### i18n System

`translations.js` exports `const TRANSLATIONS` — a flat object keyed by language code (`en`, `es`, `zh`, `zh-TW`, `ko`, …45 total). Each language has nested keys: `tab`, `header`, `settings`, `medListModal`, `medModal`, `asNeededModal`, `apptModal`, `appointments`, `metrics`, `logModal`, `weeklyView`, `schedule`, `days`, `timeOfDay`, `morningCheck`.

- `this.t('some.key')` — resolves dot-separated key, falls back to English, then returns the key string if not found
- `applyTranslations()` — sets `textContent` on all `[data-i18n]` elements, `placeholder` on `[data-i18n-placeholder]`, `title` on `[data-i18n-title]`
- Dynamic strings (rendered via `innerHTML`) must call `this.t()` directly — `data-i18n` attributes only work for static HTML
- When adding keys to all 45 languages, use a Python script (avoids shell Unicode escaping issues). Insert in reverse document order to preserve offsets.

### Theme System

Six themes: `clean` (default), `dark`, `warm`, `contrast`, `material`, `soft`. Applied as `data-theme="<name>"` on `<html>`. CSS custom properties on `:root` define the clean theme; each `[data-theme="x"]` block overrides them. Persisted in `localStorage` as `theme`.

`#weeklyViewModal` and `#metricsPrintModal` always render in clean theme via CSS overrides at the end of `styles.css`.

### Alarm System

`initializeAlarmSystem()` sets a 30-second interval checking `checkForAlarms()`. Each time-of-day slot (Morning/Afternoon/Evening/Bedtime) has a configurable time and sound file. Alarms fire if meds are present at that time and haven't been acknowledged.

## Key Patterns

**Adding a new translated string**: add `data-i18n="section.key"` in HTML for static text, or `this.t('section.key')` in JS for dynamic text, then add the key to all 45 languages in `translations.js` (Python script preferred for bulk edits).

**Adding a new metric**: update `metricPreferences` default, add to `logModal` HTML, `saveLog()`, `renderLogCard()`, `generateMetricsFilterOptions()`, `openPrintModal()`, and all translation blocks.

**Locale-aware formatting**: always use `this.language` as the locale argument — never hardcode `'en-US'`. Use `Intl` API for day/date display rather than translation keys where possible.
