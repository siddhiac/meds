// Health tracking app
class HealthTracker {
    constructor() {
        this.medications = this.loadMedications();
        this.selectedDate = new Date();

        // Set metricsDateFrom to 2 days ago
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        this.metricsDateFrom = twoDaysAgo;

        this.metricsDateTo = new Date();
        this.metricsFilter = {
            temperature: true,
            bloodPressure: true,
            heartRate: true,
            glucose: true,
            weight: true,
            steps: true,
            notes: true
        };
        this.dailyLog = this.loadDailyLog(this.getDateString(this.selectedDate));
        this.asNeededLogs = this.loadAsNeededLogs(this.getDateString(this.selectedDate));
        this.appointments = this.loadAppointments();
        this.logs = this.loadLogs();
        this.editingId = null;
        this.editingAsNeededId = null;
        this.editingLogId = null;
        this.currentTab = 'medications';
        this.appointmentFilter = 'upcoming';
        this.init();
    }

    init() {
        this.updateHeader(this.currentTab); // Initialize header with current tab
        this.renderMedications();
        this.renderAppointments();
        this.renderLogs();
        this.attachEventListeners();
        this.applyTrackingPreferences(); // Apply saved tracking preferences
        this.checkNewDay();
        this.checkiOSInstallPrompt(); // Check if we should show iOS install instructions
    }

    // Get date as YYYY-MM-DD string
    getDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Get today's date as string (old format for compatibility)
    getTodayString() {
        return new Date().toDateString();
    }

    // Check if it's a new day and update to current date
    checkNewDay() {
        const today = this.getDateString(new Date());
        const selectedDateStr = this.getDateString(this.selectedDate);

        // If we're viewing today and it's a new day, refresh
        if (selectedDateStr === today) {
            this.dailyLog = this.loadDailyLog(today);
            this.asNeededLogs = this.loadAsNeededLogs(today);
            this.renderMedications();
        }
    }

    // Load medications from localStorage
    loadMedications() {
        const stored = localStorage.getItem('medications');
        return stored ? JSON.parse(stored) : [];
    }

    // Save medications to localStorage
    saveMedications() {
        localStorage.setItem('medications', JSON.stringify(this.medications));
    }

    // Load daily log from localStorage for a specific date
    loadDailyLog(dateStr) {
        const allLogs = JSON.parse(localStorage.getItem('dailyLogs') || '{}');
        return allLogs[dateStr] || { date: dateStr, taken: [] };
    }

    // Save daily log to localStorage
    saveDailyLog() {
        const allLogs = JSON.parse(localStorage.getItem('dailyLogs') || '{}');
        const dateStr = this.getDateString(this.selectedDate);
        allLogs[dateStr] = this.dailyLog;
        localStorage.setItem('dailyLogs', JSON.stringify(allLogs));
    }

    // Load as-needed medication logs for a specific date
    loadAsNeededLogs(dateStr) {
        const stored = localStorage.getItem('asNeededLogs');
        const logs = stored ? JSON.parse(stored) : [];
        // Filter to only the selected date's logs
        return logs.filter(log => log.date === dateStr);
    }

    // Save as-needed logs
    saveAsNeededLogs() {
        localStorage.setItem('asNeededLogs', JSON.stringify(this.asNeededLogs));
    }

    // Check if medication is taken today (supports both regular ID and displayId with time)
    isTaken(medId) {
        return this.dailyLog.taken.includes(medId);
    }

    // Toggle medication taken status (uses displayId which includes time)
    toggleTaken(displayId) {
        const index = this.dailyLog.taken.indexOf(displayId);
        if (index > -1) {
            this.dailyLog.taken.splice(index, 1);
        } else {
            this.dailyLog.taken.push(displayId);
        }
        this.saveDailyLog();
        this.renderMedications();
    }

    // Check if medication should be taken on the selected date
    isMedicationActiveToday(med) {
        const today = this.selectedDate;
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.

        // Check if medication has started
        if (med.schedule && med.schedule.startDate) {
            // Parse date string as local date (YYYY-MM-DD format)
            const [year, month, day] = med.schedule.startDate.split('-').map(Number);
            const startDate = new Date(year, month - 1, day);
            startDate.setHours(0, 0, 0, 0);
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            if (todayDate < startDate) {
                return false;
            }
        }

        // Check if medication has ended
        if (med.schedule && med.schedule.endDate) {
            const [year, month, day] = med.schedule.endDate.split('-').map(Number);
            const endDate = new Date(year, month - 1, day);
            endDate.setHours(23, 59, 59, 999);
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            if (todayDate > endDate) {
                return false;
            }
        }

        // Check frequency
        if (!med.schedule || med.schedule.frequency === 'daily') {
            return true;
        }

        if (med.schedule.frequency === 'every-other-day') {
            // Use startDate to determine pattern
            let startDate;
            if (med.schedule.startDate) {
                const [year, month, day] = med.schedule.startDate.split('-').map(Number);
                startDate = new Date(year, month - 1, day);
                startDate.setHours(0, 0, 0, 0);
            } else {
                startDate = new Date(med.createdAt);
                startDate.setHours(0, 0, 0, 0);
            }
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            const daysDiff = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24));
            return daysDiff % 2 === 0;
        }

        if (med.schedule.frequency === 'mwf') {
            return [1, 3, 5].includes(dayOfWeek); // Monday, Wednesday, Friday
        }

        if (med.schedule.frequency === 'custom-days' && med.schedule.days) {
            return med.schedule.days.includes(dayOfWeek);
        }

        return true;
    }

    // Expand medications with multiple times into individual entries
    expandMedications(forDate = null) {
        const expanded = [];
        const timeOrder = { 'Morning': 0, 'Afternoon': 1, 'Evening': 2, 'Bedtime': 3 };

        // Use provided date or fall back to selectedDate
        const targetDate = forDate || this.selectedDate;

        this.medications.forEach(med => {
            const times = med.times || [med.time]; // Support old format

            // Calculate days from start and end
            let isStartDay = false;
            let isEndDay = false;
            let daysDiffFromStart = 0;

            if (med.schedule && med.schedule.startDate) {
                const [year, month, day] = med.schedule.startDate.split('-').map(Number);
                const startDate = new Date(year, month - 1, day);
                startDate.setHours(0, 0, 0, 0);

                const todayDate = new Date(targetDate);
                todayDate.setHours(0, 0, 0, 0);

                daysDiffFromStart = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24));
                isStartDay = daysDiffFromStart === 0;
            }

            if (med.schedule && med.schedule.endDate) {
                const [year, month, day] = med.schedule.endDate.split('-').map(Number);
                const endDate = new Date(year, month - 1, day);
                endDate.setHours(0, 0, 0, 0);

                const todayDate = new Date(targetDate);
                todayDate.setHours(0, 0, 0, 0);

                const daysDiffFromEnd = Math.floor((todayDate - endDate) / (1000 * 60 * 60 * 24));
                isEndDay = daysDiffFromEnd === 0;
            }

            // For medications with a start time or last day doses, filter times appropriately
            const hasStartTimeFiltering = med.schedule && med.schedule.startTime && times.length > 1 && isStartDay;
            const hasEndDayFiltering = med.schedule && med.schedule.lastDayDoses && times.length > 1 && isEndDay;

            if (hasStartTimeFiltering || hasEndDayFiltering) {
                const startTimeIndex = hasStartTimeFiltering ? timeOrder[med.schedule.startTime] : -1;
                const lastDayDoses = hasEndDayFiltering ? med.schedule.lastDayDoses : times.length;

                times.forEach(time => {
                    const timeIndex = timeOrder[time];

                    // On the start date, only show times from start time onward
                    if (isStartDay && hasStartTimeFiltering && timeIndex < startTimeIndex) {
                        return; // Skip this time
                    }

                    // On the end date, only show the first N times based on lastDayDoses
                    if (isEndDay && hasEndDayFiltering && timeIndex >= lastDayDoses) {
                        return; // Skip this time
                    }

                    expanded.push({
                        ...med,
                        time: time,
                        displayId: `${med.id}-${time}` // Unique ID for this time slot
                    });
                });
            } else {
                // Normal expansion for all other medications
                times.forEach(time => {
                    expanded.push({
                        ...med,
                        time: time,
                        displayId: `${med.id}-${time}` // Unique ID for this time slot
                    });
                });
            }
        });
        return expanded;
    }

    // Calculate end date based on bottle doses
    calculateEndDateFromDoses(startDateStr, totalDoses, times, frequency, schedule) {
        const timeOrder = { 'Morning': 0, 'Afternoon': 1, 'Evening': 2, 'Bedtime': 3 };
        const [year, month, day] = startDateStr.split('-').map(Number);
        let currentDate = new Date(year, month - 1, day);
        currentDate.setHours(0, 0, 0, 0);

        let dosesRemaining = totalDoses;
        let dayCount = 0;
        const maxDays = 1000; // Safety limit to prevent infinite loops

        // If there's a start time, we need to account for partial first day
        if (schedule.startTime && times.length > 1) {
            const startTimeIndex = timeOrder[schedule.startTime];
            // Count how many doses are taken on the first day (from startTime onward)
            const firstDayDoses = times.filter(time => timeOrder[time] >= startTimeIndex).length;
            dosesRemaining -= firstDayDoses;
            dayCount = 1;
        }

        // Determine doses per scheduled day based on frequency
        const dosesPerDay = times.length;
        let lastDayDoses = dosesPerDay; // Track how many doses on the last day

        while (dosesRemaining > 0 && dayCount < maxDays) {
            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
            dayCount++;

            // Check if medication is scheduled for this day
            let isScheduledDay = false;

            if (frequency === 'daily') {
                isScheduledDay = true;
            } else if (frequency === 'every-other-day') {
                // For every-other-day, count days from start
                const daysSinceStart = Math.floor((currentDate - new Date(year, month - 1, day)) / (1000 * 60 * 60 * 24));
                isScheduledDay = daysSinceStart % 2 === 0;
            } else if (frequency === 'mwf') {
                const dayOfWeek = currentDate.getDay();
                isScheduledDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
            } else if (frequency === 'custom-days' && schedule.days) {
                const dayOfWeek = currentDate.getDay();
                isScheduledDay = schedule.days.includes(dayOfWeek);
            }

            if (isScheduledDay) {
                // Check if we can take all doses this day or just partial
                if (dosesRemaining <= dosesPerDay) {
                    // This is the last day - we'll take however many doses remain
                    lastDayDoses = dosesRemaining;
                    dosesRemaining = 0;
                    break;
                } else {
                    dosesRemaining -= dosesPerDay;
                }
            }
        }

        // Return the date in YYYY-MM-DD format
        const endYear = currentDate.getFullYear();
        const endMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
        const endDay = String(currentDate.getDate()).padStart(2, '0');
        return {
            endDate: `${endYear}-${endMonth}-${endDay}`,
            lastDayDoses: lastDayDoses
        };
    }

    // Render all medications
    renderMedications() {
        const container = document.getElementById('medicationsList');

        // Expand medications and filter out ended ones
        const expanded = this.expandMedications();
        const timeOrder = { 'Morning': 1, 'Afternoon': 2, 'Evening': 3, 'Bedtime': 4 };

        const activeMeds = expanded.filter(med => {
            // Check if medication has ended
            if (med.schedule && med.schedule.endDate) {
                const [year, month, day] = med.schedule.endDate.split('-').map(Number);
                const endDate = new Date(year, month - 1, day);
                endDate.setHours(0, 0, 0, 0);
                const today = new Date(this.selectedDate);
                today.setHours(0, 0, 0, 0);
                return endDate >= today;
            }
            return true;
        }).filter(med => this.isMedicationActiveToday(med)); // Only show meds active today

        const sorted = [...activeMeds].sort((a, b) => {
            return timeOrder[a.time] - timeOrder[b.time];
        });

        // Render all medications grouped by time (both taken and not taken)
        const medsHtml = this.renderMedicationsByTime(sorted);

        // Add as-needed medications at the end
        const asNeededHtml = this.asNeededLogs.length > 0 ? `
            <div class="time-container">
                <div class="time-container-header">As-Needed</div>
                <div class="meds-grid">
                    ${this.asNeededLogs.map(log => this.renderAsNeededLog(log)).join('')}
                </div>
            </div>
        ` : '';

        if (sorted.length === 0 && this.asNeededLogs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        No medications scheduled for today.
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = medsHtml + asNeededHtml;
        }

        //this.updateSummary();
    }

    // Render medications grouped by time of day
    renderMedicationsByTime(medications) {
        const times = ['Morning', 'Afternoon', 'Evening', 'Bedtime'];
        let html = '';

        times.forEach(time => {
            const medsForTime = medications.filter(med => med.time === time);
            if (medsForTime.length > 0) {
                html += `
                    <div class="time-container">
                        <div class="time-container-header">${time}</div>
                        <div class="meds-grid">
                            ${medsForTime.map(med => this.renderMedCard(med)).join('')}
                        </div>
                    </div>
                `;
            }
        });

        return html;
    }

    // Get schedule description
    getScheduleDescription(schedule) {
        if (!schedule) return 'Every day';

        let desc = '';
        if (schedule.frequency === 'daily') {
            desc = 'Every day';
        } else if (schedule.frequency === 'every-other-day') {
            desc = 'Every other day';
        } else if (schedule.frequency === 'mwf') {
            desc = 'Mon, Wed, Fri';
        } else if (schedule.frequency === 'custom-days' && schedule.days) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const selectedDays = schedule.days.map(d => dayNames[d]).join(', ');
            desc = selectedDays;
        }

        if (schedule.endDate) {
            const [year, month, day] = schedule.endDate.split('-').map(Number);
            const endDate = new Date(year, month - 1, day);
            const formatted = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            desc += ` • Until ${formatted}`;
        } else if (schedule.duration) {
            desc += ' • Ongoing';
        }

        return desc;
    }

    // Render individual medication card
    renderMedCard(med) {
        const displayId = med.displayId || med.id; // Use displayId if available
        const taken = this.isTaken(displayId);
        const isActiveToday = this.isMedicationActiveToday(med);

        return `
            <div class="med-card ${taken ? 'taken' : ''} ${!isActiveToday ? 'inactive' : ''}" data-id="${displayId}">
                <div class="med-checkbox" onclick="tracker.toggleTaken('${displayId}')" ${!isActiveToday ? 'style="opacity: 0.3; pointer-events: none;"' : ''}>
                    ${taken ? '✓' : ''}
                </div>
                <div class="med-info">
                    <div class="med-name">${med.name}</div>
                    <div class="med-dosage">${med.dosage}</div>
                    ${med.notes ? `<div class="med-notes">${med.notes}</div>` : ''}
                </div>
            </div>
        `;
    }

    // Render as-needed medication log
    renderAsNeededLog(log) {
        return `
            <div class="med-card as-needed-log taken" data-id="${log.id}" onclick="tracker.editAsNeededLog('${log.id}')" style="cursor: pointer;">
                <div class="med-checkbox">✓</div>
                <div class="med-info">
                    <div class="med-name">${log.name}</div>
                    <div class="med-dosage">${log.dosage}</div>
                    <div class="med-time-taken">Taken at ${log.time}</div>
                    ${log.notes ? `<div class="med-notes">${log.notes}</div>` : ''}
                </div>
            </div>
        `;
    }

    // // Update summary counts
    // updateSummary() {
    //     // Only count medications that are active today (expanded with times)
    //     const expanded = this.expandMedications();
    //     const activeToday = expanded.filter(med => this.isMedicationActiveToday(med));
    //     const total = activeToday.length;

    //     const taken = this.dailyLog.taken.filter(displayId =>
    //         activeToday.some(med => (med.displayId || med.id) === displayId)
    //     ).length;
    //     const remaining = total - taken;

    //     document.getElementById('takenCount').textContent = taken + this.asNeededLogs.length;
    //     document.getElementById('remainingCount').textContent = remaining;
    // }

    // Attach event listeners
    attachEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Appointment filter
        document.querySelectorAll('.filter-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchFilter(e.target.dataset.filter);
            });
        });

        // Medication list modal
        document.getElementById('addMedButton').addEventListener('click', () => {
            this.openMedListModal();
        });

        document.getElementById('medListCancelButton').addEventListener('click', () => {
            this.closeMedListModal();
        });

        document.getElementById('addNewMedButton').addEventListener('click', () => {
            this.closeMedListModal();
            this.openMedModal();
        });

        document.getElementById('medListModal').addEventListener('click', (e) => {
            if (e.target.id === 'medListModal') {
                this.closeMedListModal();
            }
        });

        // Medication form modal
        document.getElementById('medCancelButton').addEventListener('click', () => {
            this.closeMedModal();
        });

        document.getElementById('stopMedButton').addEventListener('click', () => {
            this.stopMedication();
        });

        document.getElementById('medForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveMedication();
        });

        document.getElementById('medModal').addEventListener('click', (e) => {
            if (e.target.id === 'medModal') {
                this.closeMedModal();
            }
        });

        // As-needed medication modal
        document.getElementById('logAsNeededButton').addEventListener('click', () => {
            this.openAsNeededModal();
        });

        document.getElementById('asNeededCancelButton').addEventListener('click', () => {
            this.closeAsNeededModal();
        });

        document.getElementById('asNeededForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAsNeededLog();
        });

        document.getElementById('asNeededModal').addEventListener('click', (e) => {
            if (e.target.id === 'asNeededModal') {
                this.closeAsNeededModal();
            }
        });

        // Appointment modal
        document.getElementById('addApptButton').addEventListener('click', () => {
            this.openApptModal();
        });

        document.getElementById('apptCancelButton').addEventListener('click', () => {
            this.closeApptModal();
        });

        document.getElementById('apptForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAppointment();
        });

        document.getElementById('apptModal').addEventListener('click', (e) => {
            if (e.target.id === 'apptModal') {
                this.closeApptModal();
            }
        });

        // Update address field label based on location type
        document.getElementById('apptLocation').addEventListener('change', (e) => {
            const addressLabel = document.querySelector('#apptAddressGroup label');
            if (e.target.value === 'Virtual') {
                addressLabel.textContent = 'Video Call Link/Details';
            } else {
                addressLabel.textContent = 'Address/Details';
            }
        });

        // Show/hide custom days based on frequency selection
        document.getElementById('medFrequency').addEventListener('change', (e) => {
            const customDaysGroup = document.getElementById('customDaysGroup');
            if (e.target.value === 'custom-days') {
                customDaysGroup.style.display = 'block';
            } else {
                customDaysGroup.style.display = 'none';
            }
        });

        // Show/hide duration fields based on duration type
        document.getElementById('medDuration').addEventListener('change', (e) => {
            const durationNumberGroup = document.getElementById('durationNumberGroup');
            const endDateGroup = document.getElementById('endDateGroup');
            const bottleDosesGroup = document.getElementById('bottleDosesGroup');
            const durationUnit = document.getElementById('durationUnit');

            if (e.target.value === 'weeks' || e.target.value === 'months') {
                durationNumberGroup.style.display = 'block';
                endDateGroup.style.display = 'none';
                bottleDosesGroup.style.display = 'none';
                durationUnit.textContent = e.target.value;
            } else if (e.target.value === 'end-date') {
                durationNumberGroup.style.display = 'none';
                endDateGroup.style.display = 'block';
                bottleDosesGroup.style.display = 'none';
            } else if (e.target.value === 'bottle-doses') {
                durationNumberGroup.style.display = 'none';
                endDateGroup.style.display = 'none';
                bottleDosesGroup.style.display = 'block';
            } else {
                durationNumberGroup.style.display = 'none';
                endDateGroup.style.display = 'none';
                bottleDosesGroup.style.display = 'none';
            }
        });

        // Update start time dropdown when time checkboxes change
        document.querySelectorAll('input[name="medTimes"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateStartTimeOptions();
            });
        });

        // Log entry modal
        document.getElementById('addLogButton').addEventListener('click', () => {
            this.openLogModal();
        });

        document.getElementById('logCancelButton').addEventListener('click', () => {
            this.closeLogModal();
        });

        document.getElementById('logForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveLog();
        });

        document.getElementById('logModal').addEventListener('click', (e) => {
            if (e.target.id === 'logModal') {
                this.closeLogModal();
            }
        });

        // Log metric checkboxes
        const logMetricCheckboxes = [
            { checkbox: 'enableTemperature', input: 'logTemperature' },
            { checkbox: 'enableBloodPressure', inputs: ['logBPSystolic', 'logBPDiastolic'] },
            { checkbox: 'enableHeartRate', input: 'logHeartRate' },
            { checkbox: 'enableGlucose', input: 'logGlucose' },
            { checkbox: 'enableWeight', input: 'logWeight' },
            { checkbox: 'enableSteps', input: 'logSteps' },
            { checkbox: 'enableNotes', input: 'logNotes' }
        ];

        logMetricCheckboxes.forEach(item => {
            const checkbox = document.getElementById(item.checkbox);
            checkbox.addEventListener('change', (e) => {
                if (item.inputs) {
                    // Multiple inputs (like blood pressure)
                    item.inputs.forEach(inputId => {
                        document.getElementById(inputId).disabled = !e.target.checked;
                    });
                } else {
                    // Single input
                    document.getElementById(item.input).disabled = !e.target.checked;
                }
            });
        });

        // Settings tab - data management buttons
        document.getElementById('exportDataButtonSettings').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('importDataButtonSettings').addEventListener('click', () => {
            document.getElementById('importFileInputSettings').click();
        });

        document.getElementById('importFileInputSettings').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        document.getElementById('clearDataButtonSettings').addEventListener('click', () => {
            this.clearAllData();
        });

        // Settings tab - also track checkboxes
        document.getElementById('trackAppointments').addEventListener('change', (e) => {
            this.updateTrackingPreferences('appointments', e.target.checked);
        });

        document.getElementById('trackMetrics').addEventListener('change', (e) => {
            this.updateTrackingPreferences('metrics', e.target.checked);
            this.toggleMetricsSubOptions(e.target.checked);
        });

        // Settings tab - metric sub-options
        const metricCheckboxes = ['metricWeight', 'metricTemperature', 'metricBloodPressure', 'metricHeartRate', 'metricBloodSugar', 'metricSteps'];
        metricCheckboxes.forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => {
                this.updateMetricPreference(id.replace('metric', '').toLowerCase(), e.target.checked);
            });
        });

        // Legacy data management modal (keeping for compatibility)
        document.getElementById('dataModalCloseButton').addEventListener('click', () => {
            this.closeDataModal();
        });

        document.getElementById('dataModal').addEventListener('click', (e) => {
            if (e.target.id === 'dataModal') {
                this.closeDataModal();
            }
        });

        document.getElementById('exportDataButton').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('importDataButton').addEventListener('click', () => {
            document.getElementById('importFileInput').click();
        });

        document.getElementById('importFileInput').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        document.getElementById('clearDataButton').addEventListener('click', () => {
            this.clearAllData();
        });
    }

    // Switch tabs
    switchTab(tab) {
        this.currentTab = tab;

        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tab);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tab + 'Tab').classList.add('active');

        // Update header based on tab
        this.updateHeader(tab);
    }

    // Update header content based on active tab
    updateHeader(tab) {
        const headerTitle = document.getElementById('headerTitle');
        const datePickerContainer = document.getElementById('datePickerContainer');
        const headerActions = document.getElementById('headerActions');

        switch(tab) {
            case 'medications':
                headerTitle.textContent = 'Meds';
                // Date picker with week picker button
                datePickerContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="date" id="datePicker" class="date-picker">
                        <button class="action-button" id="weekPickerButton" style="padding: 12px 20px; white-space: nowrap;">Week View</button>
                    </div>
                `;
                datePickerContainer.style.display = 'block';

                // Set initial value and re-attach event listener
                document.getElementById('datePicker').value = this.getDateString(this.selectedDate);
                document.getElementById('datePicker').addEventListener('change', (e) => {
                    this.selectedDate = new Date(e.target.value + 'T00:00:00');
                    this.dailyLog = this.loadDailyLog(this.getDateString(this.selectedDate));
                    this.asNeededLogs = this.loadAsNeededLogs(this.getDateString(this.selectedDate));
                    this.renderMedications();
                    this.renderLogs();
                });

                // Week picker button listener
                document.getElementById('weekPickerButton').addEventListener('click', () => this.openWeeklyViewModal());

                headerActions.innerHTML = `
                    <button class="action-button" id="addMedButton">Med Schedule</button>
                    <button class="action-button secondary" id="logAsNeededButton">+ As-Needed</button>
                `;
                // Re-attach event listeners for medication buttons
                document.getElementById('addMedButton').addEventListener('click', () => this.openMedListModal());
                document.getElementById('logAsNeededButton').addEventListener('click', () => this.openAsNeededModal());
                break;

            case 'appointments':
                headerTitle.textContent = 'Appointments';
                datePickerContainer.style.display = 'none';
                headerActions.innerHTML = `
                    <button class="action-button" id="addApptHeaderButton">+ Add Appointment</button>
                `;
                // Re-attach event listener for appointment button
                document.getElementById('addApptHeaderButton').addEventListener('click', () => this.openApptModal());
                break;

            case 'log':
                headerTitle.textContent = 'Metrics';
                datePickerContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="date" id="metricsDateFrom" class="date-picker" style="flex: 1; min-width: 150px;">
                        <span style="color: #666;">to</span>
                        <input type="date" id="metricsDateTo" class="date-picker" style="flex: 1; min-width: 150px;">
                        <div style="position: relative;">
                            <button id="metricsFilterButton" style="padding: 12px 20px; background: white; border: 2px solid #6b7c93; border-radius: 10px; font-size: 1.1rem; font-weight: 600; color: #6b7c93; cursor: pointer; white-space: nowrap;">
                                Filter Metrics ▼
                            </button>
                            <div id="metricsFilterDropdown" style="display: none; position: absolute; top: 100%; right: 0; margin-top: 5px; background: white; border: 2px solid #ddd; border-radius: 10px; padding: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 200px;">
                                ${this.generateMetricsFilterOptions()}
                            </div>
                        </div>
                    </div>
                `;
                datePickerContainer.style.display = 'block';

                // Set initial values
                document.getElementById('metricsDateFrom').value = this.getDateString(this.metricsDateFrom);
                document.getElementById('metricsDateTo').value = this.getDateString(this.metricsDateTo);

                // Attach event listeners for date range
                document.getElementById('metricsDateFrom').addEventListener('change', (e) => {
                    this.metricsDateFrom = new Date(e.target.value + 'T00:00:00');
                    this.renderLogs();
                });
                document.getElementById('metricsDateTo').addEventListener('change', (e) => {
                    this.metricsDateTo = new Date(e.target.value + 'T00:00:00');
                    this.renderLogs();
                });

                // Toggle dropdown
                const filterButton = document.getElementById('metricsFilterButton');
                const filterDropdown = document.getElementById('metricsFilterDropdown');
                filterButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    filterDropdown.style.display = filterDropdown.style.display === 'none' ? 'block' : 'none';
                });

                // Close dropdown when clicking outside
                document.addEventListener('click', (e) => {
                    if (!filterDropdown.contains(e.target) && e.target !== filterButton) {
                        filterDropdown.style.display = 'none';
                    }
                });

                // Attach filter checkbox listeners
                const filterCheckboxes = [
                    { id: 'filterTemperature', key: 'temperature' },
                    { id: 'filterBloodPressure', key: 'bloodPressure' },
                    { id: 'filterHeartRate', key: 'heartRate' },
                    { id: 'filterGlucose', key: 'glucose' },
                    { id: 'filterWeight', key: 'weight' },
                    { id: 'filterSteps', key: 'steps' },
                    { id: 'filterNotes', key: 'notes' }
                ];

                // Helper function to update "All" checkbox state
                const updateAllCheckbox = () => {
                    const allCheckbox = document.getElementById('filterAll');
                    const allChecked = filterCheckboxes.every(filter => {
                        const checkbox = document.getElementById(filter.id);
                        return !checkbox || checkbox.checked;
                    });
                    allCheckbox.checked = allChecked;
                };

                // "All" checkbox listener
                const allCheckbox = document.getElementById('filterAll');
                allCheckbox.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    filterCheckboxes.forEach(filter => {
                        const checkbox = document.getElementById(filter.id);
                        if (checkbox) {
                            checkbox.checked = isChecked;
                            this.metricsFilter[filter.key] = isChecked;
                        }
                    });
                    this.renderLogs();
                });

                // Individual checkbox listeners
                filterCheckboxes.forEach(filter => {
                    const checkbox = document.getElementById(filter.id);
                    if (checkbox) {
                        checkbox.checked = this.metricsFilter[filter.key];
                        checkbox.addEventListener('change', (e) => {
                            this.metricsFilter[filter.key] = e.target.checked;
                            updateAllCheckbox();
                            this.renderLogs();
                        });
                    }
                });

                // Initialize "All" checkbox state
                updateAllCheckbox();

                headerActions.innerHTML = `
                    <button class="action-button" id="addMetricsHeaderButton">+ Add Metrics</button>
                `;
                // Re-attach event listener for metrics button
                document.getElementById('addMetricsHeaderButton').addEventListener('click', () => this.openLogModal());

                // Render logs after setting up the filter UI
                this.renderLogs();
                break;

            case 'settings':
                // Replace header title with app info
                headerTitle.innerHTML = `
                    <div class="header-app-info">
                        <img src="favicon.png" alt="App Icon" class="header-app-icon">
                        <div class="header-app-details">
                            <div class="header-app-name">Meds Tracker</div>
                            <div class="header-app-version">Version 1.0.0 — December 22, 2025</div>
                            <div class="header-app-author">by Sid Cooperrider</div>
                        </div>
                    </div>
                `;
                datePickerContainer.style.display = 'none';

                // Sync checkbox states with localStorage
                const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": true, "metrics": true}');
                document.getElementById('trackAppointments').checked = prefs.appointments;
                document.getElementById('trackMetrics').checked = prefs.metrics;

                // Sync metric sub-option checkboxes
                const metricPrefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true}');
                document.getElementById('metricWeight').checked = metricPrefs.weight;
                document.getElementById('metricTemperature').checked = metricPrefs.temperature;
                document.getElementById('metricBloodPressure').checked = metricPrefs.bloodpressure;
                document.getElementById('metricHeartRate').checked = metricPrefs.heartrate;
                document.getElementById('metricBloodSugar').checked = metricPrefs.bloodsugar;
                document.getElementById('metricSteps').checked = metricPrefs.steps;

                // Show/hide metric sub-options based on trackMetrics state
                this.toggleMetricsSubOptions(prefs.metrics);

                // Show back button if both tabs are unchecked
                const bothUnchecked = !prefs.appointments && !prefs.metrics;
                if (bothUnchecked) {
                    headerActions.innerHTML = '<button class="action-button" id="backToMedsButton">← Back</button>';
                    document.getElementById('backToMedsButton').addEventListener('click', () => this.switchTab('medications'));
                } else {
                    headerActions.innerHTML = '';
                }
                break;
        }
    }

    // Switch appointment filter
    switchFilter(filter) {
        this.appointmentFilter = filter;

        // Update filter buttons
        document.querySelectorAll('.filter-button').forEach(button => {
            button.classList.toggle('active', button.dataset.filter === filter);
        });

        this.renderAppointments();
    }

    // Medication modal methods
    openMedModal(medication = null) {
        const modal = document.getElementById('medModal');
        const form = document.getElementById('medForm');

        if (medication) {
            document.getElementById('medModalTitle').textContent = 'Edit Medication';
            document.getElementById('medName').value = medication.name;
            document.getElementById('medDosage').value = medication.dosage;
            document.getElementById('medNotes').value = medication.notes || '';

            // Populate times checkboxes
            const times = medication.times || [medication.time]; // Support old format
            document.querySelectorAll('input[name="medTimes"]').forEach(cb => {
                cb.checked = times.includes(cb.value);
            });

            // Update start time options based on selected times
            this.updateStartTimeOptions();

            // Set start time if it exists
            if (medication.schedule && medication.schedule.startTime) {
                document.getElementById('medStartTime').value = medication.schedule.startTime;
            }

            // Populate schedule fields
            if (medication.schedule) {
                document.getElementById('medFrequency').value = medication.schedule.frequency || 'daily';
                document.getElementById('medStartDate').value = medication.schedule.startDate || new Date().toISOString().split('T')[0];
                document.getElementById('medDuration').value = medication.schedule.durationType || 'ongoing';

                if (medication.schedule.frequency === 'custom-days' && medication.schedule.days) {
                    document.getElementById('customDaysGroup').style.display = 'block';
                    medication.schedule.days.forEach(day => {
                        const checkbox = document.querySelector(`input[name="medDays"][value="${day}"]`);
                        if (checkbox) checkbox.checked = true;
                    });
                }

                if (medication.schedule.durationType === 'weeks' || medication.schedule.durationType === 'months') {
                    document.getElementById('durationNumberGroup').style.display = 'block';
                    document.getElementById('medDurationNumber').value = medication.schedule.durationNumber;
                    document.getElementById('durationUnit').textContent = medication.schedule.durationType;
                } else if (medication.schedule.durationType === 'end-date' && medication.schedule.endDate) {
                    document.getElementById('endDateGroup').style.display = 'block';
                    document.getElementById('medEndDate').value = medication.schedule.endDate;
                } else if (medication.schedule.durationType === 'bottle-doses' && medication.schedule.bottleDoses) {
                    document.getElementById('bottleDosesGroup').style.display = 'block';
                    document.getElementById('medBottleDoses').value = medication.schedule.bottleDoses;
                }
            }

            this.editingId = medication.id;
            // Show stop button when editing
            document.getElementById('stopMedButton').style.display = 'block';
        } else {
            document.getElementById('medModalTitle').textContent = 'Add Medication';
            form.reset();
            // Reset checkboxes
            document.querySelectorAll('input[name="medTimes"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('input[name="medDays"]').forEach(cb => cb.checked = false);
            document.getElementById('customDaysGroup').style.display = 'none';
            document.getElementById('durationNumberGroup').style.display = 'none';
            document.getElementById('endDateGroup').style.display = 'none';
            document.getElementById('bottleDosesGroup').style.display = 'none';
            // Set default start date to today
            document.getElementById('medStartDate').value = new Date().toISOString().split('T')[0];
            this.editingId = null;
            // Hide stop button when adding new medication
            document.getElementById('stopMedButton').style.display = 'none';
        }

        modal.classList.add('active');
    }

    closeMedModal() {
        document.getElementById('medModal').classList.remove('active');
        document.getElementById('medForm').reset();
        this.editingId = null;
    }

    stopMedication() {
        if (!this.editingId) return;

        if (confirm('Stop this medication? This will set the end date to yesterday, removing all future doses.')) {
            const index = this.medications.findIndex(m => m.id === this.editingId);
            if (index > -1) {
                const med = this.medications[index];

                // Set end date to yesterday to stop all future instances
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const endDateStr = yesterday.toISOString().split('T')[0];

                // Initialize schedule if it doesn't exist
                if (!med.schedule) {
                    med.schedule = {
                        frequency: 'daily',
                        startDate: new Date().toISOString().split('T')[0]
                    };
                }

                // Set end date and duration type
                med.schedule.endDate = endDateStr;
                med.schedule.durationType = 'end-date';

                // Remove bottle doses fields if they exist
                delete med.schedule.bottleDoses;
                delete med.schedule.lastDayDoses;

                this.saveMedications();
                this.closeMedModal();
                this.renderMedications();
                this.renderMedList();
            }
        }
    }

    // Update the start time dropdown options based on selected times
    updateStartTimeOptions() {
        const selectedTimes = Array.from(document.querySelectorAll('input[name="medTimes"]:checked'))
            .map(cb => cb.value);

        const startTimeGroup = document.getElementById('startTimeGroup');
        const startTimeSelect = document.getElementById('medStartTime');

        // Show start time selector only if more than one time is selected
        if (selectedTimes.length > 1) {
            startTimeGroup.style.display = 'block';

            // Populate options
            startTimeSelect.innerHTML = selectedTimes
                .map(time => `<option value="${time}">${time}</option>`)
                .join('');
        } else {
            startTimeGroup.style.display = 'none';
            startTimeSelect.innerHTML = '';
        }
    }

    // Open medication list modal
    openMedListModal() {
        this.renderMedList();
        document.getElementById('medListModal').classList.add('active');
    }

    // Close medication list modal
    closeMedListModal() {
        document.getElementById('medListModal').classList.remove('active');
    }

    // Render medication list in the modal
    renderMedList() {
        const container = document.getElementById('medListContainer');

        // Get all medications that are current or future (not ended)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const activeMeds = this.medications.filter(med => {
            // Include if no end date (ongoing) or end date is today or in the future
            if (!med.schedule || !med.schedule.endDate) {
                return true;
            }
            const [year, month, day] = med.schedule.endDate.split('-').map(Number);
            const endDate = new Date(year, month - 1, day);
            endDate.setHours(0, 0, 0, 0);
            return endDate >= today;
        });

        if (activeMeds.length === 0) {
            container.innerHTML = '<div class="empty-med-list">No medications scheduled.<br>Click "+ Add Medication" to get started.</div>';
            return;
        }

        // Sort by name
        activeMeds.sort((a, b) => a.name.localeCompare(b.name));

        container.innerHTML = activeMeds.map(med => this.renderMedListItem(med)).join('');
    }

    // Render individual medication list item
    renderMedListItem(med) {
        const schedule = this.getScheduleDescription(med.schedule);
        const times = med.times || [med.time] || [];

        return `
            <div class="med-list-item" onclick="tracker.editMedicationFromList('${med.id}')">
                <div class="med-list-item-header">
                    <div class="med-list-item-name">${med.name}</div>
                </div>
                <div class="med-list-item-dosage">${med.dosage}</div>
                <div class="med-list-item-schedule">${schedule}</div>
                <div class="med-list-item-times">
                    ${times.map(time => `<span class="med-list-time-badge">${time}</span>`).join('')}
                </div>
            </div>
        `;
    }

    // Get schedule description text
    getScheduleDescription(schedule) {
        if (!schedule) return 'Daily';

        let desc = '';

        // Frequency
        if (schedule.frequency === 'daily') {
            desc = 'Daily';
        } else if (schedule.frequency === 'every-other-day') {
            desc = 'Every other day';
        } else if (schedule.frequency === 'mwf') {
            desc = 'Monday, Wednesday, Friday';
        } else if (schedule.frequency === 'custom-days' && schedule.days) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            desc = schedule.days.map(d => dayNames[d]).join(', ');
        }

        // Start date
        if (schedule.startDate) {
            const [year, month, day] = schedule.startDate.split('-').map(Number);
            const startDate = new Date(year, month - 1, day);
            desc += ` • Starts ${startDate.toLocaleDateString()}`;
        }

        // Duration
        if (schedule.durationType === 'weeks') {
            desc += ` • ${schedule.durationNumber} weeks`;
        } else if (schedule.durationType === 'months') {
            desc += ` • ${schedule.durationNumber} months`;
        } else if (schedule.durationType === 'end-date' && schedule.endDate) {
            const [eYear, eMonth, eDay] = schedule.endDate.split('-').map(Number);
            const endDate = new Date(eYear, eMonth - 1, eDay);
            desc += ` • Until ${endDate.toLocaleDateString()}`;
        } else if (schedule.durationType === 'bottle-doses' && schedule.bottleDoses) {
            desc += ` • ${schedule.bottleDoses} doses`;
            if (schedule.endDate) {
                const [eYear, eMonth, eDay] = schedule.endDate.split('-').map(Number);
                const endDate = new Date(eYear, eMonth - 1, eDay);
                desc += ` (until ${endDate.toLocaleDateString()})`;
            }
        } else if (schedule.durationType === 'ongoing') {
            desc += ' • Ongoing';
        }

        return desc;
    }

    // Edit medication from list
    editMedicationFromList(medId) {
        const medication = this.medications.find(m => m.id === medId);
        if (medication) {
            this.closeMedListModal();
            this.openMedModal(medication);
        }
    }

    // Save medication (add or update)
    saveMedication() {
        const name = document.getElementById('medName').value.trim();
        const dosage = document.getElementById('medDosage').value.trim();
        const notes = document.getElementById('medNotes').value.trim();
        const frequency = document.getElementById('medFrequency').value;
        const startDate = document.getElementById('medStartDate').value;
        const durationType = document.getElementById('medDuration').value;

        // Get selected times
        const selectedTimes = Array.from(document.querySelectorAll('input[name="medTimes"]:checked'))
            .map(cb => cb.value);

        if (!name || !dosage) {
            alert('Please fill in all required fields');
            return;
        }

        if (selectedTimes.length === 0) {
            alert('Please select at least one time of day');
            return;
        }

        if (!startDate) {
            alert('Please select a start date');
            return;
        }

        // Build schedule object
        const schedule = {
            frequency: frequency,
            durationType: durationType,
            startDate: startDate
        };

        // Add start time if multiple times are selected
        if (selectedTimes.length > 1) {
            const startTime = document.getElementById('medStartTime').value;
            if (startTime) {
                schedule.startTime = startTime;
            }
        }

        // Handle custom days
        if (frequency === 'custom-days') {
            const selectedDays = Array.from(document.querySelectorAll('input[name="medDays"]:checked'))
                .map(cb => parseInt(cb.value));
            if (selectedDays.length === 0) {
                alert('Please select at least one day for custom schedule');
                return;
            }
            schedule.days = selectedDays;
        }

        // Handle duration
        if (durationType === 'weeks' || durationType === 'months') {
            const durationNumber = parseInt(document.getElementById('medDurationNumber').value);
            if (!durationNumber || durationNumber < 1) {
                alert('Please enter a valid duration');
                return;
            }
            schedule.durationNumber = durationNumber;

            // Calculate end date from start date
            const endDate = new Date(startDate);
            if (durationType === 'weeks') {
                endDate.setDate(endDate.getDate() + (durationNumber * 7));
            } else {
                endDate.setMonth(endDate.getMonth() + durationNumber);
            }
            schedule.endDate = endDate.toISOString().split('T')[0];
        } else if (durationType === 'end-date') {
            const endDate = document.getElementById('medEndDate').value;
            if (!endDate) {
                alert('Please select an end date');
                return;
            }
            schedule.endDate = endDate;
        } else if (durationType === 'bottle-doses') {
            const bottleDoses = parseInt(document.getElementById('medBottleDoses').value);
            if (!bottleDoses || bottleDoses < 1) {
                alert('Please enter the number of doses in the bottle');
                return;
            }
            schedule.bottleDoses = bottleDoses;

            // Calculate end date based on doses and frequency
            const result = this.calculateEndDateFromDoses(startDate, bottleDoses, selectedTimes, frequency, schedule);
            schedule.endDate = result.endDate;
            schedule.lastDayDoses = result.lastDayDoses;
        }

        if (this.editingId) {
            // Update existing medication
            const index = this.medications.findIndex(m => m.id === this.editingId);
            if (index > -1) {
                this.medications[index] = {
                    ...this.medications[index],
                    name,
                    dosage,
                    times: selectedTimes,
                    notes,
                    schedule
                };
            }
        } else {
            // Add new medication
            const medication = {
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                name,
                dosage,
                times: selectedTimes,
                notes,
                schedule
            };
            this.medications.push(medication);
        }

        this.saveMedications();
        this.renderMedications();
        this.closeMedModal();
    }

    // Edit medication
    editMedication(id) {
        const medication = this.medications.find(m => m.id === id);
        if (medication) {
            this.openMedModal(medication);
        }
    }

    // Delete medication
    deleteMedication(id) {
        if (confirm('Are you sure you want to delete this medication?')) {
            this.medications = this.medications.filter(m => m.id !== id);
            // Also remove from today's log if present
            this.dailyLog.taken = this.dailyLog.taken.filter(takenId => takenId !== id);
            this.saveMedications();
            this.saveDailyLog();
            this.renderMedications();
        }
    }

    // As-needed medication methods
    openAsNeededModal(log = null) {
        const modal = document.getElementById('asNeededModal');
        const form = document.getElementById('asNeededForm');
        const modalTitle = document.querySelector('#asNeededModal h2');

        if (log) {
            // Editing existing log
            modalTitle.textContent = 'Edit As-Needed Medication';
            document.getElementById('asNeededName').value = log.name;
            document.getElementById('asNeededDosage').value = log.dosage;
            document.getElementById('asNeededTime').value = log.time;
            document.getElementById('asNeededNotes').value = log.notes || '';
            this.editingAsNeededId = log.id;
        } else {
            // Adding new log
            modalTitle.textContent = 'Log As-Needed Medication';
            form.reset();

            // Set current time as default
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            document.getElementById('asNeededTime').value = `${hours}:${minutes}`;

            this.editingAsNeededId = null;
        }

        modal.classList.add('active');
    }

    closeAsNeededModal() {
        document.getElementById('asNeededModal').classList.remove('active');
        document.getElementById('asNeededForm').reset();
        this.editingAsNeededId = null;
    }

    editAsNeededLog(id) {
        const log = this.asNeededLogs.find(l => l.id === id);
        if (log) {
            this.openAsNeededModal(log);
        }
    }

    saveAsNeededLog() {
        const name = document.getElementById('asNeededName').value.trim();
        const dosage = document.getElementById('asNeededDosage').value.trim();
        const time = document.getElementById('asNeededTime').value;
        const notes = document.getElementById('asNeededNotes').value.trim();

        if (!name || !dosage || !time) {
            alert('Please fill in all required fields');
            return;
        }

        if (this.editingAsNeededId) {
            // Update existing log
            const index = this.asNeededLogs.findIndex(l => l.id === this.editingAsNeededId);
            if (index > -1) {
                this.asNeededLogs[index] = {
                    ...this.asNeededLogs[index],
                    name,
                    dosage,
                    time,
                    notes
                };
            }

            // Also update in all logs
            const allLogs = JSON.parse(localStorage.getItem('asNeededLogs') || '[]');
            const allIndex = allLogs.findIndex(l => l.id === this.editingAsNeededId);
            if (allIndex > -1) {
                allLogs[allIndex] = {
                    ...allLogs[allIndex],
                    name,
                    dosage,
                    time,
                    notes
                };
                localStorage.setItem('asNeededLogs', JSON.stringify(allLogs));
            }
        } else {
            // Add new log
            const log = {
                id: Date.now().toString(),
                date: this.getDateString(this.selectedDate),
                name,
                dosage,
                time,
                notes
            };

            this.asNeededLogs.push(log);

            // Also save to all logs (for history)
            const allLogs = JSON.parse(localStorage.getItem('asNeededLogs') || '[]');
            allLogs.push(log);
            localStorage.setItem('asNeededLogs', JSON.stringify(allLogs));
        }

        this.saveAsNeededLogs();
        this.renderMedications();
        this.closeAsNeededModal();
    }

    deleteAsNeededLog(id) {
        if (confirm('Are you sure you want to delete this log entry?')) {
            this.asNeededLogs = this.asNeededLogs.filter(log => log.id !== id);

            // Also remove from all logs
            const allLogs = JSON.parse(localStorage.getItem('asNeededLogs') || '[]');
            const filtered = allLogs.filter(log => log.id !== id);
            localStorage.setItem('asNeededLogs', JSON.stringify(filtered));

            this.saveAsNeededLogs();
            this.renderMedications();
        }
    }

    // Appointment methods
    loadAppointments() {
        const stored = localStorage.getItem('appointments');
        return stored ? JSON.parse(stored) : [];
    }

    saveAppointments() {
        localStorage.setItem('appointments', JSON.stringify(this.appointments));
    }

    renderAppointments() {
        const container = document.getElementById('appointmentsList');
        const now = new Date();

        if (this.appointments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        No appointments scheduled yet.<br>
                        Tap the button below to add your first appointment.
                    </div>
                </div>
            `;
            return;
        }

        // Filter appointments based on selected filter
        const filtered = this.appointments.filter(appt => {
            const apptDate = new Date(appt.date + 'T' + appt.time);
            if (this.appointmentFilter === 'upcoming') {
                return apptDate >= now || !appt.completed;
            } else {
                return apptDate < now || appt.completed;
            }
        });

        // Sort appointments by date and time
        const sorted = [...filtered].sort((a, b) => {
            const dateA = new Date(a.date + 'T' + a.time);
            const dateB = new Date(b.date + 'T' + b.time);
            return this.appointmentFilter === 'upcoming' ? dateA - dateB : dateB - dateA;
        });

        if (sorted.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        No ${this.appointmentFilter} appointments.
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = sorted.map(appt => this.renderApptCard(appt)).join('');
    }

    renderApptCard(appt) {
        const apptDate = new Date(appt.date + 'T' + appt.time);
        const now = new Date();
        const isPast = apptDate < now;
        const isCompleted = appt.completed;

        // Format date and time
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
        const formattedDate = apptDate.toLocaleDateString('en-US', dateOptions);
        const formattedTime = apptDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        // Get type badge class
        const typeClass = appt.type.toLowerCase().replace(' ', '');

        return `
            <div class="appt-card ${isPast ? 'past' : ''} ${isCompleted ? 'completed' : ''}" data-id="${appt.id}">
                <div class="appt-header">
                    <div class="appt-type-badge ${typeClass}">${appt.type}</div>
                </div>
                <div class="appt-title">${appt.title}</div>
                <div class="appt-datetime">
                    📅 ${formattedDate} at ${formattedTime}
                </div>
                <div class="appt-location">
                    ${appt.location === 'Virtual' ? '💻' : '🏥'} ${appt.location}
                </div>
                ${appt.address ? `<div class="appt-address">${appt.address}</div>` : ''}
                ${appt.notes ? `<div class="appt-notes">📝 ${appt.notes}</div>` : ''}
                <div class="appt-actions">
                    <button class="complete-button" onclick="tracker.toggleAppointmentComplete('${appt.id}')">
                        ${isCompleted ? '✓ Completed' : 'Mark Complete'}
                    </button>
                    <button class="edit-button" onclick="tracker.editAppointment('${appt.id}')">Edit</button>
                    <button class="delete-button" onclick="tracker.deleteAppointment('${appt.id}')">Delete</button>
                </div>
            </div>
        `;
    }

    openApptModal(appointment = null) {
        const modal = document.getElementById('apptModal');
        const form = document.getElementById('apptForm');

        if (appointment) {
            document.getElementById('apptModalTitle').textContent = 'Edit Appointment';
            document.getElementById('apptType').value = appointment.type;
            document.getElementById('apptTitle').value = appointment.title;
            document.getElementById('apptDate').value = appointment.date;
            document.getElementById('apptTime').value = appointment.time;
            document.getElementById('apptLocation').value = appointment.location;
            document.getElementById('apptAddress').value = appointment.address || '';
            document.getElementById('apptNotes').value = appointment.notes || '';
            this.editingId = appointment.id;
        } else {
            document.getElementById('apptModalTitle').textContent = 'Add Appointment';
            form.reset();
            this.editingId = null;
        }

        modal.classList.add('active');
    }

    closeApptModal() {
        document.getElementById('apptModal').classList.remove('active');
        document.getElementById('apptForm').reset();
        this.editingId = null;
    }

    saveAppointment() {
        const type = document.getElementById('apptType').value;
        const title = document.getElementById('apptTitle').value.trim();
        const date = document.getElementById('apptDate').value;
        const time = document.getElementById('apptTime').value;
        const location = document.getElementById('apptLocation').value;
        const address = document.getElementById('apptAddress').value.trim();
        const notes = document.getElementById('apptNotes').value.trim();

        if (!title || !date || !time) {
            alert('Please fill in all required fields');
            return;
        }

        if (this.editingId) {
            // Update existing appointment
            const index = this.appointments.findIndex(a => a.id === this.editingId);
            if (index > -1) {
                this.appointments[index] = {
                    ...this.appointments[index],
                    type,
                    title,
                    date,
                    time,
                    location,
                    address,
                    notes
                };
            }
        } else {
            // Add new appointment
            const appointment = {
                id: Date.now().toString(),
                type,
                title,
                date,
                time,
                location,
                address,
                notes,
                completed: false
            };
            this.appointments.push(appointment);
        }

        this.saveAppointments();
        this.renderAppointments();
        this.closeApptModal();
    }

    editAppointment(id) {
        const appointment = this.appointments.find(a => a.id === id);
        if (appointment) {
            this.openApptModal(appointment);
        }
    }

    deleteAppointment(id) {
        if (confirm('Are you sure you want to delete this appointment?')) {
            this.appointments = this.appointments.filter(a => a.id !== id);
            this.saveAppointments();
            this.renderAppointments();
        }
    }

    toggleAppointmentComplete(id) {
        const appointment = this.appointments.find(a => a.id === id);
        if (appointment) {
            appointment.completed = !appointment.completed;
            this.saveAppointments();
            this.renderAppointments();
        }
    }

    // Log entry methods
    loadLogs() {
        const stored = localStorage.getItem('logs');
        return stored ? JSON.parse(stored) : [];
    }

    saveLogs() {
        localStorage.setItem('logs', JSON.stringify(this.logs));
    }

    renderLogs() {
        const container = document.getElementById('logEntries');

        // Filter logs by date range (for Metrics tab) or single date (for Meds tab)
        let filteredLogs;
        if (this.currentTab === 'log') {
            // Use date range for Metrics tab
            const fromDateStr = this.getDateString(this.metricsDateFrom);
            const toDateStr = this.getDateString(this.metricsDateTo);
            filteredLogs = this.logs.filter(log => {
                const logDate = log.datetime.split('T')[0]; // Get YYYY-MM-DD part
                return logDate >= fromDateStr && logDate <= toDateStr;
            });
        } else {
            // Use single date for other tabs
            const selectedDateStr = this.getDateString(this.selectedDate);
            filteredLogs = this.logs.filter(log => {
                const logDate = log.datetime.split('T')[0]; // Get YYYY-MM-DD part
                return logDate === selectedDateStr;
            });
        }

        if (filteredLogs.length === 0) {
            const allLogsEmpty = this.logs.length === 0;
            container.innerHTML = `
                <div class="empty-log">
                    <p>${allLogsEmpty ? 'No health metrics yet.' : 'No metrics for this date.'}</p>
                    <p>Click "+ Add Metrics" to start tracking.</p>
                </div>
            `;
            return;
        }

        // Sort logs by date/time (newest first)
        const sortedLogs = [...filteredLogs].sort((a, b) => {
            return new Date(b.datetime) - new Date(a.datetime);
        });

        // Filter out logs that have no visible metrics based on the current filter
        const visibleLogs = sortedLogs.filter(log => {
            // Check if any metric is both present in the log AND enabled in the filter
            const hasVisibleMetric =
                (log.temperature && this.metricsFilter.temperature) ||
                (log.bpSystolic && log.bpDiastolic && this.metricsFilter.bloodPressure) ||
                (log.heartRate && this.metricsFilter.heartRate) ||
                (log.glucose && this.metricsFilter.glucose) ||
                (log.weight && this.metricsFilter.weight) ||
                (log.steps && this.metricsFilter.steps) ||
                (log.notes && this.metricsFilter.notes);
            return hasVisibleMetric;
        });

        if (visibleLogs.length === 0) {
            container.innerHTML = `
                <div class="empty-log">
                    <p>No metrics match the current filter.</p>
                    <p>Try adjusting your filter settings or date range.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = visibleLogs.map(log => this.renderLogCard(log)).join('');
    }

    renderLogCard(log) {
        const date = new Date(log.datetime);
        const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        });

        const metrics = [];
        // Only add metrics that are enabled in the filter
        if (log.temperature && this.metricsFilter.temperature) {
            metrics.push({ label: 'Temperature', value: log.temperature, unit: '°F' });
        }
        if (log.bpSystolic && log.bpDiastolic && this.metricsFilter.bloodPressure) {
            metrics.push({ label: 'Blood Pressure', value: `${log.bpSystolic}/${log.bpDiastolic}`, unit: 'mmHg' });
        }
        if (log.heartRate && this.metricsFilter.heartRate) {
            metrics.push({ label: 'Heart Rate', value: log.heartRate, unit: 'bpm' });
        }
        if (log.glucose && this.metricsFilter.glucose) {
            metrics.push({ label: 'Blood Glucose', value: log.glucose, unit: 'mg/dL' });
        }
        if (log.weight && this.metricsFilter.weight) {
            metrics.push({ label: 'Weight', value: log.weight, unit: 'lbs' });
        }
        if (log.steps && this.metricsFilter.steps) {
            metrics.push({ label: 'Steps', value: log.steps.toLocaleString(), unit: '' });
        }

        return `
            <div class="log-card">
                <div class="log-card-header">
                    <div class="log-datetime">${dateStr} at ${timeStr}</div>
                    <div class="log-actions">
                        <button class="log-edit-button" onclick="tracker.editLog('${log.id}')">Edit</button>
                        <button class="log-delete-button" onclick="tracker.deleteLog('${log.id}')">Delete</button>
                    </div>
                </div>
                ${metrics.length > 0 ? `
                    <div class="log-metrics">
                        ${metrics.map(m => `
                            <div class="log-metric">
                                <div class="log-metric-label">${m.label}</div>
                                <div class="log-metric-value">
                                    ${m.value}<span class="log-metric-unit">${m.unit}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${log.notes && this.metricsFilter.notes ? `
                    <div class="log-notes-section">
                        <div class="log-notes-label">Notes</div>
                        <div class="log-notes-content">${log.notes}</div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    openLogModal(log = null) {
        const modal = document.getElementById('logModal');
        const form = document.getElementById('logForm');

        // Show/hide metric groups based on preferences
        this.applyMetricVisibility();

        if (log) {
            document.getElementById('logModalTitle').textContent = 'Edit Metrics';
            document.getElementById('logDateTime').value = log.datetime;

            // Set values and enable checkboxes for filled metrics (only if metric is enabled)
            if (this.isMetricEnabled('temperature')) {
                this.setLogMetric('enableTemperature', 'logTemperature', log.temperature);
            }
            if (this.isMetricEnabled('bloodpressure')) {
                this.setLogMetric('enableBloodPressure', ['logBPSystolic', 'logBPDiastolic'], [log.bpSystolic, log.bpDiastolic]);
            }
            if (this.isMetricEnabled('heartrate')) {
                this.setLogMetric('enableHeartRate', 'logHeartRate', log.heartRate);
            }
            if (this.isMetricEnabled('bloodsugar')) {
                this.setLogMetric('enableGlucose', 'logGlucose', log.glucose);
            }
            if (this.isMetricEnabled('weight')) {
                this.setLogMetric('enableWeight', 'logWeight', log.weight);
            }
            if (this.isMetricEnabled('steps')) {
                this.setLogMetric('enableSteps', 'logSteps', log.steps);
            }
            // Notes are always available
            this.setLogMetric('enableNotes', 'logNotes', log.notes);

            this.editingLogId = log.id;
        } else {
            document.getElementById('logModalTitle').textContent = 'Add Metrics';
            form.reset();

            // Uncheck all checkboxes and disable all inputs
            ['enableTemperature', 'enableBloodPressure', 'enableHeartRate', 'enableGlucose', 'enableWeight', 'enableSteps', 'enableNotes'].forEach(id => {
                const checkbox = document.getElementById(id);
                if (checkbox) checkbox.checked = false;
            });
            ['logTemperature', 'logBPSystolic', 'logBPDiastolic', 'logHeartRate', 'logGlucose', 'logWeight', 'logSteps', 'logNotes'].forEach(id => {
                const input = document.getElementById(id);
                if (input) input.disabled = true;
            });

            // Set default datetime to now
            const now = new Date();
            const offset = now.getTimezoneOffset();
            const localNow = new Date(now.getTime() - (offset * 60 * 1000));
            document.getElementById('logDateTime').value = localNow.toISOString().slice(0, 16);
            this.editingLogId = null;
        }

        modal.classList.add('active');
    }

    setLogMetric(checkboxId, inputId, value) {
        const checkbox = document.getElementById(checkboxId);
        const hasValue = Array.isArray(inputId)
            ? value && value.some(v => v != null && v !== '')
            : value != null && value !== '';

        checkbox.checked = hasValue;

        if (Array.isArray(inputId)) {
            inputId.forEach((id, index) => {
                const input = document.getElementById(id);
                input.disabled = !hasValue;
                input.value = hasValue && value[index] ? value[index] : '';
            });
        } else {
            const input = document.getElementById(inputId);
            input.disabled = !hasValue;
            input.value = hasValue ? value : '';
        }
    }

    closeLogModal() {
        document.getElementById('logModal').classList.remove('active');
        document.getElementById('logForm').reset();
        this.editingLogId = null;
    }

    saveLog() {
        const datetime = document.getElementById('logDateTime').value;

        // Only read values if checkbox is checked
        const temperature = document.getElementById('enableTemperature').checked
            ? parseFloat(document.getElementById('logTemperature').value) || null
            : null;
        const bpSystolic = document.getElementById('enableBloodPressure').checked
            ? parseInt(document.getElementById('logBPSystolic').value) || null
            : null;
        const bpDiastolic = document.getElementById('enableBloodPressure').checked
            ? parseInt(document.getElementById('logBPDiastolic').value) || null
            : null;
        const heartRate = document.getElementById('enableHeartRate').checked
            ? parseInt(document.getElementById('logHeartRate').value) || null
            : null;
        const glucose = document.getElementById('enableGlucose').checked
            ? parseInt(document.getElementById('logGlucose').value) || null
            : null;
        const weight = document.getElementById('enableWeight').checked
            ? parseFloat(document.getElementById('logWeight').value) || null
            : null;
        const steps = document.getElementById('enableSteps').checked
            ? parseInt(document.getElementById('logSteps').value) || null
            : null;
        const notes = document.getElementById('enableNotes').checked
            ? document.getElementById('logNotes').value.trim()
            : '';

        if (!datetime) {
            alert('Please select a date and time');
            return;
        }

        // Check if at least one metric is checked
        const hasAnyMetric = document.getElementById('enableTemperature').checked ||
            document.getElementById('enableBloodPressure').checked ||
            document.getElementById('enableHeartRate').checked ||
            document.getElementById('enableGlucose').checked ||
            document.getElementById('enableWeight').checked ||
            document.getElementById('enableSteps').checked ||
            document.getElementById('enableNotes').checked;

        if (!hasAnyMetric) {
            alert('Please check at least one metric to record');
            return;
        }

        if (this.editingLogId) {
            // Update existing log
            const index = this.logs.findIndex(l => l.id === this.editingLogId);
            if (index > -1) {
                this.logs[index] = {
                    ...this.logs[index],
                    datetime,
                    temperature,
                    bpSystolic,
                    bpDiastolic,
                    heartRate,
                    glucose,
                    weight,
                    steps,
                    notes
                };
            }
        } else {
            // Add new log
            const log = {
                id: Date.now().toString(),
                datetime,
                temperature,
                bpSystolic,
                bpDiastolic,
                heartRate,
                glucose,
                weight,
                steps,
                notes
            };
            this.logs.push(log);
        }

        this.saveLogs();
        this.renderLogs();
        this.closeLogModal();
    }

    editLog(id) {
        const log = this.logs.find(l => l.id === id);
        if (log) {
            this.openLogModal(log);
        }
    }

    deleteLog(id) {
        if (confirm('Are you sure you want to delete this log entry?')) {
            this.logs = this.logs.filter(l => l.id !== id);
            this.saveLogs();
            this.renderLogs();
        }
    }

    // Weekly view methods
    openWeeklyViewModal() {
        this.currentWeekStart = this.getWeekStart(this.selectedDate);
        this.renderWeeklyView();
        document.getElementById('weeklyViewModal').classList.add('active');

        // Attach event listeners
        document.getElementById('prevWeekButton').addEventListener('click', () => this.changeWeek(-1));
        document.getElementById('nextWeekButton').addEventListener('click', () => this.changeWeek(1));
        document.getElementById('weeklyViewCloseButton').addEventListener('click', () => this.closeWeeklyViewModal());
        document.getElementById('weeklyViewPrintButton').addEventListener('click', () => window.print());
    }

    closeWeeklyViewModal() {
        document.getElementById('weeklyViewModal').classList.remove('active');
    }

    // Data management modal
    openDataModal() {
        document.getElementById('dataModal').classList.add('active');
    }

    closeDataModal() {
        document.getElementById('dataModal').classList.remove('active');
    }

    // Export all data to JSON file
    async exportData() {
        const data = {
            medications: this.medications,
            dailyLogs: JSON.parse(localStorage.getItem('dailyLogs') || '{}'),
            asNeededLogs: JSON.parse(localStorage.getItem('asNeededLogs') || '[]'),
            appointments: this.appointments,
            logs: this.logs,
            metricPreferences: JSON.parse(localStorage.getItem('metricPreferences') || '{}'),
            trackAppointments: localStorage.getItem('trackAppointments') === 'true',
            trackMetrics: localStorage.getItem('trackMetrics') === 'true',
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        const dataStr = JSON.stringify(data, null, 2);
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `meds-backup-${timestamp}.json`;

        // Try to use Web Share API (works well on iOS)
        if (navigator.share && navigator.canShare) {
            try {
                const blob = new Blob([dataStr], { type: 'application/json' });
                const file = new File([blob], filename, { type: 'application/json' });

                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Meds Tracker Backup',
                        text: 'Your medication tracker backup file'
                    });
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    // User cancelled the share, don't show an error
                    return;
                }
                console.log('Share failed, falling back to download:', err);
            }
        }

        // Fallback: traditional download method
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert('Data exported successfully! On iOS, you may need to long-press the downloaded file and choose "Save to Files" to keep it.');
    }

    // Import data from JSON file
    importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // Validate data structure
                if (!data.medications || !data.dailyLogs) {
                    throw new Error('Invalid backup file format');
                }

                // Confirm with user before overwriting
                const confirmed = confirm(
                    'This will replace all current data with the imported data. Are you sure you want to continue?'
                );

                if (!confirmed) {
                    // Reset the file input
                    document.getElementById('importFileInput').value = '';
                    return;
                }

                // Import all data
                localStorage.setItem('medications', JSON.stringify(data.medications));
                localStorage.setItem('dailyLogs', JSON.stringify(data.dailyLogs));
                localStorage.setItem('asNeededLogs', JSON.stringify(data.asNeededLogs || []));
                localStorage.setItem('appointments', JSON.stringify(data.appointments || []));
                localStorage.setItem('logs', JSON.stringify(data.logs || []));

                // Import settings
                if (data.metricPreferences) {
                    localStorage.setItem('metricPreferences', JSON.stringify(data.metricPreferences));
                }
                if (data.trackAppointments !== undefined) {
                    localStorage.setItem('trackAppointments', data.trackAppointments.toString());
                }
                if (data.trackMetrics !== undefined) {
                    localStorage.setItem('trackMetrics', data.trackMetrics.toString());
                }

                // Reload the page to refresh all data
                alert('Data imported successfully! The page will now reload.');
                location.reload();
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }

            // Reset the file input
            document.getElementById('importFileInput').value = '';
        };

        reader.readAsText(file);
    }

    // Clear all data with confirmation
    clearAllData() {
        const confirmed = confirm(
            'Are you ABSOLUTELY sure you want to delete ALL data? This cannot be undone!\n\nThis will delete:\n• All medications\n• All medication logs\n• All appointments\n• All health metrics\n\nType "DELETE" in the next prompt to confirm.'
        );

        if (!confirmed) return;

        const secondConfirm = prompt('Type DELETE to confirm:');
        if (secondConfirm !== 'DELETE') {
            alert('Deletion cancelled.');
            return;
        }

        // Clear all localStorage
        localStorage.removeItem('medications');
        localStorage.removeItem('dailyLogs');
        localStorage.removeItem('asNeededLogs');
        localStorage.removeItem('appointments');
        localStorage.removeItem('logs');
        localStorage.removeItem('trackingPreferences');

        alert('All data has been deleted. The page will now reload.');
        location.reload();
    }

    // Update tracking preferences
    updateTrackingPreferences(type, enabled) {
        const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": true, "metrics": true}');
        prefs[type] = enabled;
        localStorage.setItem('trackingPreferences', JSON.stringify(prefs));

        // Update UI visibility
        this.applyTrackingPreferences();
    }

    // Apply tracking preferences to UI
    applyTrackingPreferences() {
        const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": true, "metrics": true}');

        const appointmentsTab = document.querySelector('[data-tab="appointments"]');
        const metricsTab = document.querySelector('[data-tab="log"]');
        const tabsContainer = document.querySelector('.tabs');
        const headerTitle = document.getElementById('headerTitle');

        // Show/hide tabs based on preferences
        if (appointmentsTab) {
            appointmentsTab.style.display = prefs.appointments ? '' : 'none';
        }
        if (metricsTab) {
            metricsTab.style.display = prefs.metrics ? '' : 'none';
        }

        // Count visible tabs (excluding settings)
        const bothUnchecked = !prefs.appointments && !prefs.metrics;

        if (bothUnchecked) {
            // Hide the entire tabs container
            if (tabsContainer) {
                tabsContainer.style.display = 'none';
            }

            // If currently on a hidden tab or settings tab, switch to medications
            if (this.currentTab === 'appointments' || this.currentTab === 'log' || this.currentTab === 'settings') {
                this.switchTab('medications');
            }

            // Add settings button to header
            if (headerTitle) {
                // Check if settings button is not already in header
                if (!document.getElementById('headerSettingsButton')) {
                    // Check if h1 is already wrapped
                    if (!headerTitle.parentElement.classList.contains('header-title-wrapper')) {
                        // Create a wrapper for the title and button
                        const wrapper = document.createElement('div');
                        wrapper.className = 'header-title-wrapper';
                        wrapper.style.display = 'flex';
                        wrapper.style.alignItems = 'center';
                        wrapper.style.gap = '15px';

                        // Wrap the h1
                        headerTitle.parentNode.insertBefore(wrapper, headerTitle);
                        wrapper.appendChild(headerTitle);
                    }

                    const settingsButton = document.createElement('button');
                    settingsButton.id = 'headerSettingsButton';
                    settingsButton.textContent = '⚙️';
                    settingsButton.style.fontSize = '2.5rem';
                    settingsButton.style.background = 'none';
                    settingsButton.style.border = 'none';
                    settingsButton.style.cursor = 'pointer';
                    settingsButton.style.padding = '0';
                    settingsButton.style.transition = 'transform 0.2s ease';
                    settingsButton.style.flexShrink = '0';
                    settingsButton.addEventListener('click', () => this.switchTab('settings'));
                    settingsButton.addEventListener('mousedown', (e) => {
                        e.target.style.transform = 'scale(0.9)';
                    });
                    settingsButton.addEventListener('mouseup', (e) => {
                        e.target.style.transform = 'scale(1)';
                    });
                    settingsButton.addEventListener('mouseleave', (e) => {
                        e.target.style.transform = 'scale(1)';
                    });

                    // Insert before the title in the wrapper
                    headerTitle.parentElement.insertBefore(settingsButton, headerTitle);
                }
            }
        } else {
            // Show the tabs container
            if (tabsContainer) {
                tabsContainer.style.display = 'grid';
            }

            // Remove settings button from header if it exists
            const headerSettingsButton = document.getElementById('headerSettingsButton');
            if (headerSettingsButton) {
                headerSettingsButton.remove();
            }

            // Unwrap the h1 if it's wrapped
            if (headerTitle) {
                const wrapper = headerTitle.parentElement;
                if (wrapper && wrapper.classList.contains('header-title-wrapper')) {
                    const headerLeft = wrapper.parentElement;
                    headerLeft.insertBefore(headerTitle, wrapper);
                    wrapper.remove();
                }
            }

            // Update grid template based on which tabs are visible
            const visibleCount = 2 + (prefs.appointments ? 1 : 0) + (prefs.metrics ? 1 : 0); // 2 = settings + meds

            if (visibleCount === 3) {
                // One tab is hidden, so: auto (settings) + two equal-width tabs
                tabsContainer.style.gridTemplateColumns = 'auto 1fr 1fr';
            } else {
                // Both tabs visible: auto (settings) + three equal-width tabs
                tabsContainer.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
            }
        }
    }

    // Toggle visibility of metric sub-options
    toggleMetricsSubOptions(show) {
        const subOptions = document.getElementById('metricsSubOptions');
        if (subOptions) {
            subOptions.style.display = show ? 'grid' : 'none';
        }
    }

    // Update individual metric preference
    updateMetricPreference(metric, enabled) {
        const prefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true}');
        prefs[metric] = enabled;
        localStorage.setItem('metricPreferences', JSON.stringify(prefs));
    }

    // Check if a metric is enabled
    isMetricEnabled(metric) {
        const prefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true}');
        return prefs[metric];
    }

    // Apply metric visibility to form
    applyMetricVisibility() {
        // Map of metric keys to their container element parent
        const metricMap = {
            'temperature': 'enableTemperature',
            'bloodpressure': 'enableBloodPressure',
            'heartrate': 'enableHeartRate',
            'bloodsugar': 'enableGlucose',
            'weight': 'enableWeight',
            'steps': 'enableSteps'
        };

        Object.entries(metricMap).forEach(([metric, checkboxId]) => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                const metricGroup = checkbox.closest('.log-metric-group');
                if (metricGroup) {
                    metricGroup.style.display = this.isMetricEnabled(metric) ? 'flex' : 'none';
                }
            }
        });
    }

    // Generate metrics filter dropdown options based on enabled metrics
    generateMetricsFilterOptions() {
        const metricOptions = [
            { key: 'temperature', filterId: 'filterTemperature', label: 'Temperature' },
            { key: 'bloodpressure', filterId: 'filterBloodPressure', label: 'Blood Pressure' },
            { key: 'heartrate', filterId: 'filterHeartRate', label: 'Heart Rate' },
            { key: 'bloodsugar', filterId: 'filterGlucose', label: 'Blood Glucose' },
            { key: 'weight', filterId: 'filterWeight', label: 'Weight' },
            { key: 'steps', filterId: 'filterSteps', label: 'Steps' }
        ];

        let html = '<div style="margin-bottom: 10px; font-weight: bold; color: #333;">Show Metrics:</div>';
        html += `
            <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px; font-weight: 600;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                <input type="checkbox" id="filterAll" checked style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 1.1rem;">All</span>
            </label>
            <div style="height: 1px; background: #ddd; margin: 8px 0;"></div>
        `;

        // Add only enabled metrics
        metricOptions.forEach(metric => {
            if (this.isMetricEnabled(metric.key)) {
                html += `
                    <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                        <input type="checkbox" id="${metric.filterId}" checked style="width: 18px; height: 18px; cursor: pointer;">
                        <span style="font-size: 1.1rem;">${metric.label}</span>
                    </label>
                `;
            }
        });

        // Always show Notes filter
        html += `
            <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                <input type="checkbox" id="filterNotes" checked style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 1.1rem;">Notes</span>
            </label>
        `;

        return html;
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day; // Adjust to Sunday
        return new Date(d.setDate(diff));
    }

    changeWeek(direction) {
        const newStart = new Date(this.currentWeekStart);
        newStart.setDate(newStart.getDate() + (direction * 7));
        this.currentWeekStart = newStart;
        this.renderWeeklyView();
    }

    renderWeeklyView() {
        const container = document.getElementById('weeklyViewContainer');
        const weekDays = [];

        // Generate 7 days starting from Sunday
        for (let i = 0; i < 7; i++) {
            const date = new Date(this.currentWeekStart);
            date.setDate(date.getDate() + i);
            weekDays.push(date);
        }

        // Build weekly schedule HTML
        let html = '<div class="weekly-schedule">';

        // Header row with days
        html += '<div class="weekly-header-row">';
        weekDays.forEach(date => {
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            const monthDay = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
            html += `<div class="weekly-day-header">${dayName} ${monthDay}</div>`;
        });
        html += '</div>';

        // Time sections - each time period spans all 7 days
        const times = ['Morning', 'Afternoon', 'Evening', 'Bedtime'];
        times.forEach(time => {
            // Check if this time period has any medications for the entire week
            let hasAnyMeds = false;
            const dayMedsHtml = [];

            weekDays.forEach(date => {
                const dayHtml = this.renderDayMedicationsForTime(date, time);
                dayMedsHtml.push(dayHtml);
                if (dayHtml.trim() !== '') {
                    hasAnyMeds = true;
                }
            });

            // Only render this time row if it has medications
            if (hasAnyMeds) {
                html += `<div class="weekly-time-row">`;
                html += `<div class="weekly-time-header-full">${time}</div>`;
                html += `<div class="weekly-time-columns">`;

                dayMedsHtml.forEach(dayHtml => {
                    html += '<div class="weekly-day-column">';
                    html += dayHtml;
                    html += '</div>';
                });

                html += `</div>`;
                html += `</div>`;
            }
        });

        html += '</div>';
        container.innerHTML = html;
    }

    renderDayMedicationsForTime(date, time) {
        let html = '';

        // Get all medications expanded for this specific date
        const expanded = this.expandMedications(date);

        // Filter medications that are scheduled for this date
        const activeMeds = expanded.filter(med => {
            const checkDate = new Date(date);
            checkDate.setHours(0, 0, 0, 0);
            const dayOfWeek = checkDate.getDay();

            // Check if medication has started
            if (med.schedule && med.schedule.startDate) {
                const [year, month, day] = med.schedule.startDate.split('-').map(Number);
                const startDate = new Date(year, month - 1, day);
                startDate.setHours(0, 0, 0, 0);
                if (checkDate < startDate) return false;
            }

            // Check if medication has ended
            if (med.schedule && med.schedule.endDate) {
                const [year, month, day] = med.schedule.endDate.split('-').map(Number);
                const endDate = new Date(year, month - 1, day);
                endDate.setHours(23, 59, 59, 999);
                if (checkDate > endDate) return false;
            }

            // Check frequency
            if (!med.schedule || med.schedule.frequency === 'daily') {
                return true;
            }

            if (med.schedule.frequency === 'every-other-day') {
                let startDate;
                if (med.schedule.startDate) {
                    const [year, month, day] = med.schedule.startDate.split('-').map(Number);
                    startDate = new Date(year, month - 1, day);
                    startDate.setHours(0, 0, 0, 0);
                } else {
                    startDate = new Date(med.createdAt);
                    startDate.setHours(0, 0, 0, 0);
                }
                const daysDiff = Math.floor((checkDate - startDate) / (1000 * 60 * 60 * 24));
                return daysDiff % 2 === 0;
            }

            if (med.schedule.frequency === 'mwf') {
                return [1, 3, 5].includes(dayOfWeek); // Monday, Wednesday, Friday
            }

            if (med.schedule.frequency === 'custom-days' && med.schedule.days) {
                return med.schedule.days.includes(dayOfWeek);
            }

            return true;
        });

        // Filter for this specific time
        const medsForTime = activeMeds.filter(med => med.time === time);

        if (medsForTime.length > 0) {
            medsForTime.forEach(med => {
                html += `
                    <div class="weekly-med-item">
                        <input type="checkbox" class="weekly-checkbox">
                        <span class="weekly-med-label">${med.name}</span>
                    </div>
                `;
            });
        }

        return html;
    }

    isMedScheduledForDate(med, date) {
        const dateStr = this.getDateString(date);
        const medDate = new Date(date);
        medDate.setHours(0, 0, 0, 0);

        // Parse start date as local date
        const [year, month, day] = med.startDate.split('-').map(Number);
        const startDate = new Date(year, month - 1, day);
        startDate.setHours(0, 0, 0, 0);

        // Check if date is before start
        if (medDate < startDate) return false;

        // Check if date is after end
        if (med.endDate) {
            const [eYear, eMonth, eDay] = med.endDate.split('-').map(Number);
            const endDate = new Date(eYear, eMonth - 1, eDay);
            endDate.setHours(23, 59, 59, 999);
            if (medDate > endDate) return false;
        }

        // Check frequency
        if (med.frequency === 'daily') {
            return true;
        } else if (med.frequency === 'every-other-day') {
            const daysDiff = Math.floor((medDate - startDate) / (1000 * 60 * 60 * 24));
            return daysDiff % 2 === 0;
        } else if (med.frequency === 'mwf') {
            const day = medDate.getDay();
            return day === 1 || day === 3 || day === 5; // Mon, Wed, Fri
        } else if (med.frequency === 'custom-days') {
            const day = medDate.getDay();
            return med.customDays && med.customDays.includes(day.toString());
        }

        return false;
    }

    // Check if running on iOS Safari (not standalone) and show install prompt
    checkiOSInstallPrompt() {
        // Check if we're on iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        // If on iOS, show the install button in Settings
        if (isIOS) {
            const installSection = document.getElementById('iosInstallSection');
            if (installSection) {
                installSection.style.display = 'block';
            }

            // Add event listener for manual trigger
            const installButton = document.getElementById('showiOSInstallButton');
            if (installButton) {
                installButton.addEventListener('click', () => {
                    this.showiOSInstallModal();
                });
            }
        }

        // Check if we're NOT running as standalone (i.e., we're in Safari)
        const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

        // Check if user has dismissed this prompt before
        const hasSeenPrompt = localStorage.getItem('hasSeeniOSInstallPrompt') === 'true';

        // Show prompt if on iOS, not standalone, and hasn't seen it before
        if (isIOS && !isStandalone && !hasSeenPrompt) {
            // Wait a bit before showing to avoid overwhelming on first load
            setTimeout(() => {
                this.showiOSInstallModal();
            }, 2000);
        }
    }

    showiOSInstallModal() {
        const modal = document.getElementById('iosInstallModal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    closeiOSInstallModal(rememberChoice = false) {
        const modal = document.getElementById('iosInstallModal');
        if (modal) {
            modal.classList.remove('active');
        }

        if (rememberChoice) {
            localStorage.setItem('hasSeeniOSInstallPrompt', 'true');
        }
    }
}

// Initialize the app
const tracker = new HealthTracker();

// Check for new day every minute
setInterval(() => {
    tracker.checkNewDay();
}, 60000);
