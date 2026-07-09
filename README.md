# Meds Tracker

A private, offline-first health tracker for medications, appointments, and health metrics. Runs entirely in the browser — no server, no account, no data leaves your device.

## Features

- **Medications** — schedule by time of day (Morning / Afternoon / Evening / Bedtime), frequency (daily, every other day, specific days), and duration (ongoing, weeks, months, end date, or bottle count). Check off doses as taken with one tap.
- **Weekly view** — see the full week's medication schedule at a glance, printable.
- **Appointments** — track doctor visits, infusions, lab work, procedures. Filter upcoming vs. past, mark complete.
- **Health metrics** — log temperature, blood pressure, heart rate, blood glucose, weight, steps, oxygenation, sleep, and notes. Filter by metric and date range, printable report.
- **Multiple profiles** — separate data sets for different people on the same device.
- **P2P sync** — real-time sync between devices over WebRTC (no server required for data; uses PeerJS for signaling). Host generates a QR code; peers scan to join.
- **Alarms** — configurable per time-of-day slot with custom sounds.
- **45 languages** — full UI translation. Locale-aware date/time formatting throughout.
- **6 themes** — Clean, Dark, Warm, High Contrast, Material, Soft.
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

## Features

### Medication Tracking
- ✅ **Easy Check-Off System** - Large, touch-friendly checkboxes
- 📅 **Smart Scheduling** - Set medications for:
  - Every day
  - Every other day
  - Specific days (e.g., Monday, Wednesday, Friday)
  - Custom days of the week
- ⏰ **Flexible Duration** - Set medications to run:
  - Ongoing (no end date)
  - For a specific number of weeks or months
  - Until a specific end date
- 🗓️ **Automatic Daily Reset** - Only shows medications scheduled for today
- ⏰ **Time-Based Organization** - Medications sorted by Morning, Afternoon, Evening, Bedtime
- 📊 **Progress Summary** - See at a glance what's taken today and what's remaining

### Appointment Management
- 🏥 **Track All Appointments** - Doctor visits, infusions, procedures, and lab work
- 📍 **Location Tracking** - Mark appointments as virtual or in-person
- 🔔 **Upcoming & Past Views** - Filter to see what's coming up or review past appointments
- ✓ **Completion Tracking** - Mark appointments as completed
- 📝 **Detailed Notes** - Add important details like "bring insurance card" or "fasting required"

### General
- 💾 **Automatic Saving** - All data saved locally on your device
- 🎨 **Clear, Large Interface** - Easy to read and use
- 🔄 **Easy Switching** - Simple tabs to switch between medications, appointments, and metrics

## How to Use

### Daily Use

#### For Medications
1. **Switch to Medications Tab** - Tap the "Meds" tab at the top
2. **View Your Medications** - All medications are listed, organized by time of day
3. **Check Off When Taken** - Tap the large checkbox next to each medication after taking it
4. **Add/Edit/Delete** - Use the buttons to manage your medication list

#### For Appointments
1. **Switch to Appointments Tab** - Tap the "Appointments" tab at the top
2. **View Upcoming or Past** - Use the filter buttons to switch between upcoming and past appointments
3. **See Details** - Each appointment shows the type, date, time, location, and any notes
4. **Mark Complete** - Tap "Mark Complete" when you've attended an appointment
5. **Add/Edit/Delete** - Use the buttons to manage your appointments

#### For Metrics
1. **Switch to Metrics Tab** - Tap the "Metrics" tab at the top

### Adding a Medication

1. Go to the "Medications" tab
2. Tap "+ Add Medication"
3. Enter the medication name (e.g., "Tylenol")
4. Enter the dosage (e.g., "2 pills" or "1 tablet")
5. Select the time of day (Morning, Afternoon, Evening, or Bedtime)
6. Choose how often:
   - **Every Day** - Takes medication daily
   - **Every Other Day** - Alternating days
   - **Monday, Wednesday, Friday** - Those specific days
   - **Custom Days of Week** - Pick specific days (shows checkboxes for each day)
7. Set the duration:
   - **Ongoing** - No end date (for maintenance medications)
   - **For a number of weeks** - Enter number of weeks
   - **For a number of months** - Enter number of months
   - **Until a specific date** - Pick an end date
8. Optionally add notes (e.g., "Take with food")
9. Tap "Save"

**Note:** Medications not scheduled for today will appear grayed out and won't count toward your daily total.

### Adding an Appointment

1. Go to the "Appointments" tab
2. Tap "+ Add Appointment"
3. Select the type (Doctor Visit, Infusion, Lab Work, Procedure, or Other)
4. Enter a title/description (e.g., "Dr. Smith Check-up" or "Chemotherapy Session 3")
5. Select the date and time
6. Choose location type (Virtual or In-Person)
7. Add address/details (hospital name, room number, or video call link)
8. Optionally add notes (e.g., "Bring insurance card", "Fasting required")
9. Tap "Save"

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

## Hosting

Since the app is entirely static, it can be hosted anywhere:

- **GitHub Pages** — push the repo, enable Pages in repository settings
- **Any web host** — upload all files, preserving directory structure
- **Local network** — `python3 -m http.server 8080` on one device, access via local IP from others
