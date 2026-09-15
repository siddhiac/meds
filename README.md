# Meds Tracker

A private, offline-first health tracker for medications, appointments, and health metrics. Runs entirely in the browser — no server, no account, no data leaves your device.

## Features

- **Medications** — schedule by time of day (Morning / Afternoon / Evening / Bedtime), frequency (daily, every other day, specific days), and duration (ongoing, weeks, months, end date, or bottle count). Check off doses as taken with one tap. Hover over a taken time to edit it.
- **Weekly view** — see the full week's medication schedule at a glance, printable.
- **Appointments** — track doctor visits, infusions, lab work, procedures. Filter upcoming vs. past, mark complete. *(Hidden by default — enable in Settings.)*
- **Health metrics** — log temperature, blood pressure, heart rate, blood glucose, weight, steps, oxygenation, sleep, and notes. Filter by metric and date range, printable report.
- **Multiple profiles** — separate data sets for different people on the same device.
- **P2P sync** — real-time sync between devices over WebRTC (no server required for data; uses PeerJS for signaling). Host generates a QR code; peers scan to join.
- **Alarms** — configurable per time-of-day slot with custom sounds.
- **45 languages** — full UI translation. Locale-aware date/time formatting throughout.
- **7 themes** — Auto (light by day, dark by night), Clean, Dark, Warm, High Contrast, Material, Soft.
- **PWA** — installable to home screen, works offline after first load.

## Data & Privacy

All data is stored in your browser's `localStorage`. Nothing is transmitted anywhere except the optional P2P sync (which sends data directly to the other device, not to a server).

**Export / Import** — use Settings → Data Management to download a full JSON backup or restore from one. Exports include all profiles and their data.

**Clearing data** — Settings → Clear All Data removes everything for the current profile.

## P2P Sync

The sync feature uses WebRTC for direct device-to-device data transfer. PeerJS handles the WebRTC signaling (connection setup only — no health data passes through PeerJS servers).

To use sync:
1. Open the app on the host device, go to the profile sharing section
2. The host generates a room code / QR code
3. On the peer device, scan the QR code or enter the room code

For self-hosting the PeerJS signaling server (recommended for medical data), see [PEERJS_SERVER_SETUP.md](PEERJS_SERVER_SETUP.md).

## How to Use

### Medications

1. Tap the **Meds** tab
2. Medications are grouped by time of day (Morning, Afternoon, Evening, Bedtime)
3. Tap the checkbox next to a medication when you take it — it logs the time automatically
4. To correct the taken time, hover over "Taken at [time]" and tap the pencil icon
5. Use the **Week View** button (tablet/desktop) to see the full week at a glance
6. Tap **+ Add Medication** to add a new one:
   - Enter name and dosage
   - Choose time(s) of day
   - Set frequency: every day, every other day, Mon/Wed/Fri, or custom days
   - Set duration: ongoing, number of weeks/months, end date, or bottle dose count
   - Optionally add notes (e.g., "Take with food")

> Medications not scheduled for today appear grayed out and don't count toward the daily total.

### Appointments

Appointments are hidden by default. To enable: go to **Settings → Also Track → Appointments**.

Once enabled:
1. Tap the **Appointments** tab
2. Use the filter buttons to switch between Upcoming and Past
3. Tap **+ Add Appointment**, choose a type (Doctor Visit, Infusion, Lab Work, Procedure, Other), fill in the date, time, location, and any notes
4. Tap **Mark Complete** when you've attended

### Health Metrics

1. Tap the **Metrics** tab
2. Tap **+ Log Metrics** to record a reading — enter any combination of vitals for that moment
3. Use the filter controls to narrow by metric type or date range
4. Tap **Print** to generate a printable report

## Files

| File | Purpose |
|------|---------|
| `index.html` | All HTML including every modal |
| `app.js` | All application logic |
| `styles.css` | All styles and theme variants |
| `styles_profile.css` | Profile modal styles |
| `translations.js` | i18n strings for 45 languages |
| `manifest.json` | PWA manifest |
| `peerjs.min.js` | PeerJS library (vendored) |
| `qrcode.min.js` | QR code library (vendored) |
| `sounds/` | Alarm sounds (alarm_01 – alarm_10.mp3) |

## Supported Languages

45 languages with full UI translation and locale-aware date/time formatting:

| Code | Language | Code | Language | Code | Language |
|------|----------|------|----------|------|----------|
| `en` | English | `fr` | French | `sw` | Kiswahili |
| `es` | Spanish | `pl` | Polish | `am` | Amharic |
| `zh` | Chinese (Simplified) | `id` | Indonesian | `om` | Oromo |
| `zh-TW` | Chinese (Traditional) | `tr` | Turkish | `ht` | Haitian Creole |
| `vi` | Vietnamese | `uk` | Ukrainian | `gu` | Gujarati |
| `tl` | Filipino / Tagalog | `ru` | Russian | `so` | Somali |
| `ko` | Korean | `hy` | Armenian | `bn` | Bengali |
| `ja` | Japanese | `ur` | Urdu | `ceb` | Cebuano |
| `ar` | Arabic | `ne` | Nepali | `ha` | Hausa |
| `fa` | Persian / Farsi | `mr` | Marathi | `ta` | Tamil |
| `hi` | Hindi | `pa` | Punjabi | `te` | Telugu |
| `de` | German | `lo` | Lao | `kn` | Kannada |
| `pt` | Portuguese | `th` | Thai | `ml` | Malayalam |
| `ilo` | Ilocano | `hmn` | Hmong | `my` | Burmese |
| `sm` | Samoan | `km` | Khmer | | |
| `haw` | Hawaiian | | | | |

## Hosting

Since the app is entirely static, it can be hosted anywhere:

- **GitHub Pages** — push the repo, enable Pages in repository settings
- **Any web host** — upload all files, preserving directory structure
- **Local network** — `python3 -m http.server 8080` on one device, access via local IP from others
