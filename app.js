// Health tracking app
class HealthTracker {
    constructor() {
        this.medications = this.loadMedications();
        this.selectedDate = new Date();
        this.dailyLog = this.loadDailyLog(this.getDateString(this.selectedDate));
        this.asNeededLogs = this.loadAsNeededLogs(this.getDateString(this.selectedDate));
        this.appointments = this.loadAppointments();
        this.editingId = null;
        this.editingAsNeededId = null;
        this.currentTab = 'medications';
        this.appointmentFilter = 'upcoming';
        this.init();
    }

    init() {
        this.initDatePicker();
        this.renderMedications();
        this.renderAppointments();
        this.attachEventListeners();
        this.checkNewDay();
    }

    // Initialize date picker
    initDatePicker() {
        const datePicker = document.getElementById('datePicker');
        datePicker.value = this.getDateString(this.selectedDate);

        datePicker.addEventListener('change', (e) => {
            this.selectedDate = new Date(e.target.value + 'T00:00:00');
            this.dailyLog = this.loadDailyLog(this.getDateString(this.selectedDate));
            this.asNeededLogs = this.loadAsNeededLogs(this.getDateString(this.selectedDate));
            this.renderMedications();
        });
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

        // Check if medication has ended
        if (med.schedule && med.schedule.endDate) {
            const endDate = new Date(med.schedule.endDate);
            if (today > endDate) {
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
        const scheduleDesc = this.getScheduleDescription(med.schedule);

        return `
            <div class="med-card ${taken ? 'taken' : ''} ${!isActiveToday ? 'inactive' : ''}" data-id="${displayId}">
                <div class="med-checkbox" onclick="tracker.toggleTaken('${displayId}')" ${!isActiveToday ? 'style="opacity: 0.3; pointer-events: none;"' : ''}>
                    ${taken ? '✓' : ''}
                </div>
                <div class="med-info">
                    <div class="med-name">${med.name}</div>
                    <div class="med-dosage">${med.dosage}</div>
                    <div class="med-schedule ${!isActiveToday ? 'inactive' : ''}">
                        ${isActiveToday ? scheduleDesc : 'Not scheduled for today • ' + scheduleDesc}
                    </div>
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

        // Medication modal
        document.getElementById('addMedButton').addEventListener('click', () => {
            this.openMedModal();
        });

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
            this.editingId = null;
        }

        modal.classList.add('active');
    }

    closeMedModal() {
        document.getElementById('medModal').classList.remove('active');
        document.getElementById('medForm').reset();
        this.editingId = null;
    }

    // Save medication (add or update)
    saveMedication() {
        const name = document.getElementById('medName').value.trim();
        const dosage = document.getElementById('medDosage').value.trim();
        const notes = document.getElementById('medNotes').value.trim();
        const frequency = document.getElementById('medFrequency').value;
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

        // Build schedule object
        const schedule = {
            frequency: frequency,
            durationType: durationType,
            startDate: new Date().toISOString().split('T')[0] // Today's date
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

            // Calculate end date
            const endDate = new Date();
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
}

// Initialize the app
const tracker = new HealthTracker();

// Check for new day every minute
setInterval(() => {
    tracker.checkNewDay();
}, 60000);
