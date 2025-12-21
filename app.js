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
        this.checkNewDay();
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
            const startDate = new Date(med.schedule.startDate);
            startDate.setHours(0, 0, 0, 0);
            const todayDate = new Date(today);
            todayDate.setHours(0, 0, 0, 0);
            if (todayDate < startDate) {
                return false;
            }
        }

        // Check if medication has ended
        if (med.schedule && med.schedule.endDate) {
            const endDate = new Date(med.schedule.endDate);
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
            const startDate = med.schedule.startDate ? new Date(med.schedule.startDate) : new Date(med.createdAt);
            const daysDiff = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
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
    expandMedications() {
        const expanded = [];
        this.medications.forEach(med => {
            const times = med.times || [med.time]; // Support old format
            times.forEach(time => {
                expanded.push({
                    ...med,
                    time: time,
                    displayId: `${med.id}-${time}` // Unique ID for this time slot
                });
            });
        });
        return expanded;
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
                const endDate = new Date(med.schedule.endDate);
                const today = new Date();
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
            const endDate = new Date(schedule.endDate);
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
            const durationUnit = document.getElementById('durationUnit');

            if (e.target.value === 'weeks' || e.target.value === 'months') {
                durationNumberGroup.style.display = 'block';
                endDateGroup.style.display = 'none';
                durationUnit.textContent = e.target.value;
            } else if (e.target.value === 'end-date') {
                durationNumberGroup.style.display = 'none';
                endDateGroup.style.display = 'block';
            } else {
                durationNumberGroup.style.display = 'none';
                endDateGroup.style.display = 'none';
            }
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
                                <div style="margin-bottom: 10px; font-weight: bold; color: #333;">Show Metrics:</div>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px; font-weight: 600;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterAll" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">All</span>
                                </label>
                                <div style="height: 1px; background: #ddd; margin: 8px 0;"></div>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterTemperature" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Temperature</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterBloodPressure" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Blood Pressure</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterHeartRate" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Heart Rate</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterGlucose" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Blood Glucose</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterWeight" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Weight</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterSteps" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Steps</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                                    <input type="checkbox" id="filterNotes" checked style="width: 18px; height: 18px; cursor: pointer;">
                                    <span style="font-size: 1.1rem;">Notes</span>
                                </label>
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
                    const allChecked = filterCheckboxes.every(filter =>
                        document.getElementById(filter.id).checked
                    );
                    allCheckbox.checked = allChecked;
                };

                // "All" checkbox listener
                const allCheckbox = document.getElementById('filterAll');
                allCheckbox.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    filterCheckboxes.forEach(filter => {
                        const checkbox = document.getElementById(filter.id);
                        checkbox.checked = isChecked;
                        this.metricsFilter[filter.key] = isChecked;
                    });
                    this.renderLogs();
                });

                // Individual checkbox listeners
                filterCheckboxes.forEach(filter => {
                    const checkbox = document.getElementById(filter.id);
                    checkbox.checked = this.metricsFilter[filter.key];
                    checkbox.addEventListener('change', (e) => {
                        this.metricsFilter[filter.key] = e.target.checked;
                        updateAllCheckbox();
                        this.renderLogs();
                    });
                });

                // Initialize "All" checkbox state
                updateAllCheckbox();

                headerActions.innerHTML = `
                    <button class="action-button" id="addMetricsHeaderButton">+ Add Metrics</button>
                `;
                // Re-attach event listener for metrics button
                document.getElementById('addMetricsHeaderButton').addEventListener('click', () => this.openLogModal());
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
                }
            }

            this.editingId = medication.id;
        } else {
            document.getElementById('medModalTitle').textContent = 'Add Medication';
            form.reset();
            // Reset checkboxes
            document.querySelectorAll('input[name="medTimes"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('input[name="medDays"]').forEach(cb => cb.checked = false);
            document.getElementById('customDaysGroup').style.display = 'none';
            document.getElementById('durationNumberGroup').style.display = 'none';
            document.getElementById('endDateGroup').style.display = 'none';
            // Set default start date to today
            document.getElementById('medStartDate').value = new Date().toISOString().split('T')[0];
            this.editingId = null;
        }

        modal.classList.add('active');
    }

    closeMedModal() {
        document.getElementById('medModal').classList.remove('active');
        document.getElementById('medForm').reset();
        this.editingId = null;
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
            const endDate = new Date(med.schedule.endDate);
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
            const startDate = new Date(schedule.startDate);
            desc += ` • Starts ${startDate.toLocaleDateString()}`;
        }

        // Duration
        if (schedule.durationType === 'weeks') {
            desc += ` • ${schedule.durationNumber} weeks`;
        } else if (schedule.durationType === 'months') {
            desc += ` • ${schedule.durationNumber} months`;
        } else if (schedule.durationType === 'end-date' && schedule.endDate) {
            const endDate = new Date(schedule.endDate);
            desc += ` • Until ${endDate.toLocaleDateString()}`;
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

        if (log) {
            document.getElementById('logModalTitle').textContent = 'Edit Metrics';
            document.getElementById('logDateTime').value = log.datetime;

            // Set values and enable checkboxes for filled metrics
            this.setLogMetric('enableTemperature', 'logTemperature', log.temperature);
            this.setLogMetric('enableBloodPressure', ['logBPSystolic', 'logBPDiastolic'], [log.bpSystolic, log.bpDiastolic]);
            this.setLogMetric('enableHeartRate', 'logHeartRate', log.heartRate);
            this.setLogMetric('enableGlucose', 'logGlucose', log.glucose);
            this.setLogMetric('enableWeight', 'logWeight', log.weight);
            this.setLogMetric('enableSteps', 'logSteps', log.steps);
            this.setLogMetric('enableNotes', 'logNotes', log.notes);

            this.editingLogId = log.id;
        } else {
            document.getElementById('logModalTitle').textContent = 'Add Metrics';
            form.reset();

            // Uncheck all checkboxes and disable all inputs
            ['enableTemperature', 'enableBloodPressure', 'enableHeartRate', 'enableGlucose', 'enableWeight', 'enableSteps', 'enableNotes'].forEach(id => {
                document.getElementById(id).checked = false;
            });
            ['logTemperature', 'logBPSystolic', 'logBPDiastolic', 'logHeartRate', 'logGlucose', 'logWeight', 'logSteps', 'logNotes'].forEach(id => {
                document.getElementById(id).disabled = true;
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
        const expanded = this.expandMedications();

        // Filter medications that are scheduled for this date
        const activeMeds = expanded.filter(med => {
            const checkDate = new Date(date);
            checkDate.setHours(0, 0, 0, 0);
            const dayOfWeek = checkDate.getDay();

            // Check if medication has started
            if (med.schedule && med.schedule.startDate) {
                const startDate = new Date(med.schedule.startDate);
                startDate.setHours(0, 0, 0, 0);
                if (checkDate < startDate) return false;
            }

            // Check if medication has ended
            if (med.schedule && med.schedule.endDate) {
                const endDate = new Date(med.schedule.endDate);
                endDate.setHours(23, 59, 59, 999);
                if (checkDate > endDate) return false;
            }

            // Check frequency
            if (!med.schedule || med.schedule.frequency === 'daily') {
                return true;
            }

            if (med.schedule.frequency === 'every-other-day') {
                const startDate = med.schedule.startDate ? new Date(med.schedule.startDate) : new Date(med.createdAt);
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
        const startDate = new Date(med.startDate);

        // Check if date is before start
        if (medDate < startDate) return false;

        // Check if date is after end
        if (med.endDate) {
            const endDate = new Date(med.endDate);
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
}

// Initialize the app
const tracker = new HealthTracker();

// Check for new day every minute
setInterval(() => {
    tracker.checkNewDay();
}, 60000);
