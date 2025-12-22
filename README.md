# Meds

A simple medication tracker with flexible schedules, plus optionally track hospital procedures, doctor visits and health metrics (blood pressure, weight, temperature, etc.)

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

## Hosting Options

Since this is a simple web app, you have several options:

### Option 1: Quick Test (Easiest)
1. Open [index.html](index.html) directly in Safari or Chrome
2. Use AirDrop to send the entire folder to your iPad
3. Open the index.html file from the Files app on iPad

### Option 2: Host on GitHub Pages (Free, Recommended)
1. Create a GitHub account if you don't have one
2. Create a new repository and upload these files
3. Enable GitHub Pages in repository settings
4. Access via the provided GitHub Pages URL

### Option 3: Host on Your Server
Upload all three files (index.html, styles.css, app.js) to any web hosting service.

## Technical Details

- **No Backend Required** - Everything runs in the browser
- **Data Storage** - Uses browser's localStorage (data stays on the iPad)
- **Privacy** - No data leaves the device
- **Works Offline** - Once loaded, works without internet

## Files

- `index.html` - Main app structure
- `styles.css` - Visual styling optimized for iPad
- `app.js` - App functionality and data management

## Tips

- The app automatically resets each day at midnight
- All medications and check-offs are saved automatically
- If you need to clear everything and start fresh, you can delete the app and re-add it to the home screen
- For best experience, use in portrait mode on iPad

## Support

This app was made with love for someone special. If you need any changes or have issues, just ask!
