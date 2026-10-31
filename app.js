// P2P Sync Class for WebRTC
class P2PSync {
    constructor(tracker) {
        this.tracker = tracker;
        this.peer = null;
        this.connections = new Map(); // Map of peerId -> connection
        this.isHost = false;
        this.roomId = null;
        this.deviceName = this.getDeviceName();
        this.deviceId = this.getOrCreateDeviceId();
        this.hostProfileName = null; // Store host's profile name for peers
        this.autoReconnectAttempted = false;
    }

    getDeviceName() {
        // Try to get a friendly device name
        const userAgent = navigator.userAgent;
        if (userAgent.includes('iPad')) return 'iPad';
        if (userAgent.includes('iPhone')) return 'iPhone';
        if (userAgent.includes('Android')) return 'Android Device';
        if (userAgent.includes('Mac')) return 'Mac';
        if (userAgent.includes('Windows')) return 'Windows PC';
        return 'Device';
    }

    // Generate or retrieve a persistent device ID
    getOrCreateDeviceId() {
        let deviceId = localStorage.getItem('p2p_device_id');
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
            localStorage.setItem('p2p_device_id', deviceId);
        }
        return deviceId;
    }

    // Save sync state for auto-reconnect
    saveSyncState() {
        const state = {
            isHost: this.isHost,
            roomId: this.roomId,
            profileId: this.tracker.currentProfile?.id,
            hostProfileName: this.hostProfileName,
            savedAt: Date.now()
        };
        localStorage.setItem('p2p_sync_state', JSON.stringify(state));
    }

    // Load sync state
    loadSyncState() {
        const stored = localStorage.getItem('p2p_sync_state');
        if (!stored) return null;

        try {
            const state = JSON.parse(stored);
            // State expires after 24 hours
            if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
                this.clearSyncState();
                return null;
            }
            return state;
        } catch (e) {
            return null;
        }
    }

    // Clear sync state
    clearSyncState() {
        localStorage.removeItem('p2p_sync_state');
    }

    // Save trusted device
    addTrustedDevice(deviceId, deviceName) {
        const trusted = this.getTrustedDevices();
        trusted[deviceId] = {
            name: deviceName,
            lastSeen: Date.now()
        };
        localStorage.setItem('p2p_trusted_devices', JSON.stringify(trusted));
    }

    // Get trusted devices
    getTrustedDevices() {
        const stored = localStorage.getItem('p2p_trusted_devices');
        if (!stored) return {};
        try {
            return JSON.parse(stored);
        } catch (e) {
            return {};
        }
    }

    // Check if device is trusted
    isDeviceTrusted(deviceId) {
        const trusted = this.getTrustedDevices();
        return !!trusted[deviceId];
    }

    // Try to auto-reconnect based on saved state
    tryAutoReconnect() {
        if (this.autoReconnectAttempted) return false;
        this.autoReconnectAttempted = true;

        const state = this.loadSyncState();
        if (!state || !state.roomId) return false;

        // Only auto-reconnect for the same profile
        if (state.profileId !== this.tracker.currentProfile?.id) return false;

        console.log('Auto-reconnect: Found saved sync state', state);

        // Show reconnecting UI
        this.showReconnectingUI(state.isHost);

        if (state.isHost) {
            // Resume hosting with the same room code
            console.log('Auto-reconnect: Resuming as host with code', state.roomId);
            this.startHost(state.roomId);
            return true;
        } else {
            // Try to reconnect as peer
            console.log('Auto-reconnect: Reconnecting as peer to', state.roomId);
            this.hostProfileName = state.hostProfileName;
            this.joinRoom(state.roomId, true); // true = auto-reconnect attempt
            return true;
        }
    }

    generateRoomId() {
        // Generate a short, memorable room code
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous characters
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // Start as host (sharing profile)
    startHost(existingRoomId = null) {
        this.isHost = true;
        this.roomId = existingRoomId || this.generateRoomId();

        // Configure PeerJS to use custom server (you'll need to set this up)
        // For now, using the default PeerJS cloud server
        this.peer = new Peer(this.roomId, {
            // Uncomment and configure when you have your own PeerJS server:
            // host: 'your-peerjs-server.com',
            // port: 9000,
            // path: '/myapp'
        });

        this.peer.on('open', (id) => {
            console.log('Host started with ID:', id);
            this.showHostUI();
            this.generateQRCode(id);

            // Save sync state for auto-reconnect
            this.saveSyncState();
        });

        this.peer.on('connection', (conn) => {
            console.log('New peer connecting:', conn.peer);
            this.handleNewPeer(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            // If auto-reconnecting and fails, clear the state
            if (existingRoomId) {
                console.log('Auto-reconnect failed, clearing state');
                this.clearSyncState();
            } else {
                // Show user-friendly message instead of raw PeerJS error
                if (err.type === 'network' || err.message?.includes('server')) {
                    this.showToast('Connection to sync service lost');
                } else {
                    this.showToast('Sharing error: ' + err.type);
                }
            }
        });
    }

    // Handle new peer connection
    handleNewPeer(conn) {
        this.connections.set(conn.peer, conn);

        conn.on('open', () => {
            console.log('Peer connected:', conn.peer);

            // Send full profile data
            this.sendFullSync(conn);

            // Send device info including our device ID
            conn.send({
                type: 'DEVICE_INFO',
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                timestamp: Date.now()
            });

            // Update connected devices list
            this.updateConnectedDevices();
        });

        conn.on('data', (data) => {
            this.handleIncomingData(data, conn);

            // If we received device info, add to trusted devices
            if (data.type === 'DEVICE_INFO' && data.deviceId) {
                this.addTrustedDevice(data.deviceId, data.deviceName || 'Unknown Device');
                conn.metadata = {
                    deviceId: data.deviceId,
                    deviceName: data.deviceName
                };
                this.updateConnectedDevices();
            }
        });

        conn.on('close', () => {
            console.log('Peer disconnected:', conn.peer);
            const deviceName = conn.metadata?.deviceName || 'A device';
            this.connections.delete(conn.peer);
            this.updateConnectedDevices();
            this.showToast(`${deviceName} disconnected`);
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            const deviceName = conn.metadata?.deviceName || 'A device';
            this.connections.delete(conn.peer);
            this.updateConnectedDevices();
            this.showToast(`Lost connection to ${deviceName}`);
        });
    }

    // Join as peer (connecting to shared profile)
    joinRoom(roomId, isAutoReconnect = false) {
        this.isHost = false;
        this.roomId = roomId;
        this.isAutoReconnecting = isAutoReconnect;

        this.peer = new Peer({
            // Same server config as host
        });

        this.peer.on('open', (id) => {
            console.log('Peer created with ID:', id);
            const conn = this.peer.connect(roomId);
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (this.isAutoReconnecting) {
                console.log('Auto-reconnect failed, clearing state');
                this.clearSyncState();
                this.isAutoReconnecting = false;
                this.showToast('Could not reconnect to host');
            } else {
                // Show user-friendly message
                if (err.type === 'peer-unavailable') {
                    this.showToast('Host not found - check the code');
                } else if (err.type === 'network' || err.message?.includes('server')) {
                    this.showToast('Connection to sync service lost');
                } else {
                    this.showToast('Failed to connect to host');
                }
            }
        });
    }

    handleConnection(conn) {
        this.connections.set(conn.peer, conn);

        conn.on('open', () => {
            console.log('Connected to host');
            this.showPeerUI();
            this.isAutoReconnecting = false;

            // Send device info including our device ID
            conn.send({
                type: 'DEVICE_INFO',
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                timestamp: Date.now()
            });

            // Request full sync
            conn.send({
                type: 'REQUEST_FULL_SYNC',
                timestamp: Date.now()
            });

            // Save sync state for future auto-reconnect
            this.saveSyncState();
        });

        conn.on('data', (data) => {
            this.handleIncomingData(data, conn);
        });

        conn.on('close', () => {
            console.log('Disconnected from host');
            this.showToast('Disconnected from host');
            this.disconnect(true); // true = keep sync state for reconnect
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.showToast('Lost connection to host');
            this.disconnect(true); // true = keep sync state for reconnect
        });
    }

    // Send full profile data
    sendFullSync(conn) {
        const profileData = this.tracker.loadProfileData();

        conn.send({
            type: 'FULL_SYNC',
            profileId: this.tracker.currentProfile.id,
            profileName: this.tracker.currentProfile.name,
            data: profileData,
            timestamp: Date.now()
        });
    }

    // Broadcast change to all connected peers
    broadcastChange(changeType, data) {
        if (!this.peer || this.connections.size === 0) {
            console.log('Cannot broadcast - no peer or connections', {
                hasPeer: !!this.peer,
                connectionCount: this.connections.size
            });
            return;
        }

        const message = {
            type: changeType,
            data: data,
            timestamp: Date.now()
        };

        console.log('Broadcasting:', changeType, 'to', this.connections.size, 'connections');

        this.connections.forEach((conn) => {
            if (conn.open) {
                console.log('  Sending to connection:', conn.peer);
                conn.send(message);
            } else {
                console.log('  Connection not open:', conn.peer);
            }
        });
    }

    // Handle incoming data
    handleIncomingData(message, conn) {
        console.log('Received:', message.type, message);

        switch (message.type) {
            case 'DEVICE_INFO':
                // Store device info
                conn.metadata = { deviceName: message.deviceName };
                this.updateConnectedDevices();
                break;

            case 'REQUEST_FULL_SYNC':
                // Send full profile data
                if (this.isHost) {
                    this.sendFullSync(conn);
                }
                break;

            case 'FULL_SYNC':
                // Receive full profile data
                this.handleFullSync(message);
                break;

            case 'MED_ADDED':
            case 'MED_UPDATED':
            case 'MED_DELETED':
                this.handleMedicationChange(message);
                break;

            case 'MED_TAKEN':
            case 'MED_UNTAKEN':
                this.handleMedicationTaken(message);
                break;

            case 'APPOINTMENT_ADDED':
            case 'APPOINTMENT_UPDATED':
            case 'APPOINTMENT_DELETED':
                this.handleAppointmentChange(message);
                break;

            case 'LOG_ADDED':
            case 'LOG_UPDATED':
            case 'LOG_DELETED':
                this.handleLogChange(message);
                break;
        }

        // Update last sync time
        this.updateLastSyncTime();
    }

    handleFullSync(message) {
        // Store the host's profile info
        this.hostProfileName = message.profileName;
        this.hostProfileId = message.profileId;

        // IMPORTANT: Update the tracker's current profile to use the host's profile ID
        // This ensures all save/load operations use the same key as the host
        const originalProfileId = this.tracker.currentProfile.id;
        this.tracker.currentProfile = {
            ...this.tracker.currentProfile,
            id: message.profileId,
            name: message.profileName,
            originalId: originalProfileId, // Keep track of original for when we disconnect
            isSynced: true
        };

        // Save the full profile data under the host's profile ID
        const key = `profileData_${message.profileId}`;
        localStorage.setItem(key, JSON.stringify(message.data));

        // Update profile name displays
        const connectedProfileName = document.getElementById('connectedProfileName');
        if (connectedProfileName) {
            connectedProfileName.textContent = message.profileName;
        }
        document.getElementById('activeProfileName').textContent = message.profileName;

        // Reload the app data from the synced data
        this.tracker.medications = message.data.medications || [];
        this.tracker.appointments = message.data.appointments || [];
        this.tracker.logs = message.data.logs || [];

        // Also load daily logs for the current date
        const dateStr = this.tracker.getDateString(this.tracker.selectedDate);
        this.tracker.dailyLog = message.data.dailyLogs?.[dateStr] || { date: dateStr, taken: [] };

        // Re-render everything
        this.tracker.renderMedications();
        this.tracker.renderAppointments();
        this.tracker.renderLogs();

        this.updateLastSyncTime();
    }

    handleMedicationChange(message) {
        switch (message.type) {
            case 'MED_ADDED':
                // Check if medication already exists (prevent duplicates)
                const existingMed = this.tracker.medications.find(m => m.id === message.data.id);
                if (!existingMed) {
                    this.tracker.medications.push(message.data);
                }
                break;
            case 'MED_UPDATED':
                const medIndex = this.tracker.medications.findIndex(m => m.id === message.data.id);
                if (medIndex > -1) {
                    this.tracker.medications[medIndex] = message.data;
                }
                break;
            case 'MED_DELETED':
                this.tracker.medications = this.tracker.medications.filter(m => m.id !== message.data.id);
                break;
        }

        this.tracker.saveMedications();
        this.tracker.renderMedications();

        // If we're the host, broadcast to other peers
        if (this.isHost) {
            this.broadcastChange(message.type, message.data);
        }
    }

    handleMedicationTaken(message) {
        const dateStr = message.data.dateStr;
        const medId = message.data.medId;

        // Load the daily log for that date
        const profileData = this.tracker.loadProfileData();
        const dailyLog = profileData.dailyLogs[dateStr] || { date: dateStr, taken: [] };

        if (message.type === 'MED_TAKEN') {
            if (!dailyLog.taken.includes(medId)) {
                dailyLog.taken.push(medId);
            }
        } else {
            dailyLog.taken = dailyLog.taken.filter(id => id !== medId);
        }

        // Save back
        profileData.dailyLogs[dateStr] = dailyLog;
        const key = this.tracker.getProfileDataKey();
        if (key) {
            localStorage.setItem(key, JSON.stringify(profileData));
        }

        // If it's today's date, update current display
        const today = this.tracker.getDateString(this.tracker.selectedDate);
        if (dateStr === today) {
            this.tracker.dailyLog = dailyLog;
            this.tracker.renderMedications();
        }

        // If we're the host, broadcast to other peers
        if (this.isHost) {
            this.broadcastChange(message.type, message.data);
        }
    }

    handleAppointmentChange(message) {
        switch (message.type) {
            case 'APPOINTMENT_ADDED':
                // Check if appointment already exists (prevent duplicates)
                const existingAppt = this.tracker.appointments.find(a => a.id === message.data.id);
                if (!existingAppt) {
                    this.tracker.appointments.push(message.data);
                }
                break;
            case 'APPOINTMENT_UPDATED':
                const apptIndex = this.tracker.appointments.findIndex(a => a.id === message.data.id);
                if (apptIndex > -1) {
                    this.tracker.appointments[apptIndex] = message.data;
                }
                break;
            case 'APPOINTMENT_DELETED':
                this.tracker.appointments = this.tracker.appointments.filter(a => a.id !== message.data.id);
                break;
        }

        this.tracker.saveAppointments();
        this.tracker.renderAppointments();

        if (this.isHost) {
            this.broadcastChange(message.type, message.data);
        }
    }

    handleLogChange(message) {
        console.log('handleLogChange:', message.type, 'isHost:', this.isHost);

        switch (message.type) {
            case 'LOG_ADDED':
                console.log('  Adding log:', message.data.id);
                // Check if log already exists (prevent duplicates when host re-broadcasts)
                const existingLog = this.tracker.logs.find(l => l.id === message.data.id);
                if (!existingLog) {
                    this.tracker.logs.push(message.data);
                } else {
                    console.log('  Log already exists, skipping');
                }
                break;
            case 'LOG_UPDATED':
                console.log('  Updating log:', message.data.id);
                const logIndex = this.tracker.logs.findIndex(l => l.id === message.data.id);
                if (logIndex > -1) {
                    this.tracker.logs[logIndex] = message.data;
                }
                break;
            case 'LOG_DELETED':
                console.log('  Deleting log:', message.data.id);
                this.tracker.logs = this.tracker.logs.filter(l => l.id !== message.data.id);
                break;
        }

        this.tracker.saveLogs();
        this.tracker.renderLogs();

        if (this.isHost) {
            console.log('  Re-broadcasting to other peers');
            this.broadcastChange(message.type, message.data);
        }
    }

    // UI Methods
    showHostUI() {
        // Hide local profile actions
        document.getElementById('localProfileActions').style.display = 'none';
        document.getElementById('connectedProfileState').style.display = 'none';

        // Show sharing state
        document.getElementById('sharingProfileState').style.display = 'block';

        // Update profile info
        document.getElementById('activeProfileName').textContent = this.tracker.currentProfile?.name || 'Profile';
        document.getElementById('activeProfileDesc').textContent = this.tracker.t('profile.sharingDesc');

        // Show sync badge
        const badge = document.getElementById('profileSyncBadge');
        badge.style.display = 'inline-flex';
        document.getElementById('profileSyncStatus').textContent = this.tracker.t('profile.sharing');
    }

    showPeerUI() {
        // Hide local profile actions and sharing state
        document.getElementById('localProfileActions').style.display = 'none';
        document.getElementById('sharingProfileState').style.display = 'none';

        // Show connected state
        document.getElementById('connectedProfileState').style.display = 'block';

        // Update profile info with host's profile name
        const profileName = this.hostProfileName || 'Shared Profile';
        document.getElementById('activeProfileName').textContent = profileName;
        document.getElementById('activeProfileDesc').textContent = this.tracker.t('profile.syncedDesc');

        // Show sync badge
        const badge = document.getElementById('profileSyncBadge');
        badge.style.display = 'inline-flex';
        document.getElementById('profileSyncStatus').textContent = this.tracker.t('profile.synced');
    }

    showReconnectingUI(isHost) {
        // Show badge with "Reconnecting" status
        const badge = document.getElementById('profileSyncBadge');
        badge.style.display = 'inline-flex';
        document.getElementById('profileSyncStatus').textContent = this.tracker.t('profile.reconnecting');

        // Update description
        document.getElementById('activeProfileDesc').textContent = isHost
            ? this.tracker.t('profile.resumingDesc')
            : this.tracker.t('profile.reconnectingDesc');
    }

    showNotSyncingUI() {
        // Show local profile actions
        document.getElementById('localProfileActions').style.display = 'block';
        document.getElementById('sharingProfileState').style.display = 'none';
        document.getElementById('connectedProfileState').style.display = 'none';

        // Update profile info
        document.getElementById('activeProfileName').textContent = this.tracker.currentProfile?.name || 'Profile';
        document.getElementById('activeProfileDesc').textContent = this.tracker.t('profile.allDataSeparate');

        // Hide sync badge
        document.getElementById('profileSyncBadge').style.display = 'none';
    }

    generateQRCode(roomId) {
        const container = document.getElementById('syncQRCode');
        document.getElementById('syncRoomCode').textContent = roomId;

        // Clear previous QR code if any
        container.innerHTML = '';

        // Create URL with sync code parameter
        // This makes the QR code open the app with the code pre-filled
        const currentUrl = window.location.href.split('?')[0]; // Base URL without params
        const syncUrl = `${currentUrl}?sync=${roomId}`;

        // Generate new QR code using qrcodejs
        new QRCode(container, {
            text: syncUrl,
            width: 200,
            height: 200,
            colorDark: '#6b7c93',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    updateConnectedDevices() {
        const container = document.getElementById('connectedDevicesList');

        if (this.connections.size === 0) {
            container.innerHTML = `<div class="sync-no-devices">${this.tracker.t('profile.noDevices')}</div>`;
            return;
        }

        const devicesHTML = Array.from(this.connections.values()).map(conn => {
            const deviceName = conn.metadata?.deviceName || 'Unknown Device';
            return `
                <div class="sync-device-item">
                    <span class="sync-device-icon">📱</span>
                    <span class="sync-device-name">${deviceName}</span>
                    <span class="sync-device-status">● Connected</span>
                </div>
            `;
        }).join('');

        container.innerHTML = devicesHTML;
    }

    updateLastSyncTime() {
        const timeEl = document.getElementById('lastSyncTime');
        if (timeEl) {
            timeEl.textContent = this.tracker.t('profile.justNow');
        }
    }

    // Disconnect and cleanup
    // keepStateForReconnect: if true, don't clear the sync state (allows auto-reconnect)
    disconnect(keepStateForReconnect = false) {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.connections.clear();
        this.isHost = false;
        this.roomId = null;

        // Clear sync state unless we want to allow auto-reconnect
        if (!keepStateForReconnect) {
            this.clearSyncState();
        }

        this.showNotSyncingUI();
    }

    // Show a brief toast notification
    showToast(message) {
        // Remove any existing toast
        const existingToast = document.querySelector('.sync-toast');
        if (existingToast) {
            existingToast.remove();
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'sync-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Health tracking app
class HealthTracker {
    constructor() {
        this.currentProfile = null;
        this.profiles = this.loadProfiles();

        // Check if opened via QR code sync link
        const urlParams = new URLSearchParams(window.location.search);
        const syncCode = urlParams.get('sync');

        // Check if we need to show profile selection
        if (!this.hasActiveProfile()) {
            // Attach profile event listeners first
            this.attachProfileEventListeners();

            // If joining via QR code, auto-create a temporary profile
            if (syncCode) {
                this.createSyncProfile(syncCode);
                return;
            }

            // Check if this is a first-time user with existing data
            const hasLegacyData = localStorage.getItem('medications') ||
                                 localStorage.getItem('appointments') ||
                                 localStorage.getItem('logs');

            if (hasLegacyData && this.profiles.length === 0) {
                // First-time migration - show form with migration option
                setTimeout(() => {
                    this.openProfileFormModal(true);
                }, 100);
            } else {
                // No profiles exist, show profile selection
                this.showProfileModal();
            }
            return; // Don't initialize the rest until profile is selected
        }

        this.initializeApp();
    }

    // Auto-create profile when joining via sync
    createSyncProfile(syncCode) {
        // Create a temporary profile that will be overwritten by sync
        const profile = {
            id: Date.now().toString(),
            name: 'Synced Profile', // Will be updated when sync completes
            createdAt: new Date().toISOString()
        };

        this.profiles.push(profile);
        this.saveProfiles();
        this.setActiveProfile(profile.id);

        // Initialize app
        this.initializeApp();

        // Auto-connect after a brief delay
        setTimeout(() => {
            this.switchTab('settings');
            setTimeout(() => {
                document.getElementById('syncCode').value = syncCode;
                // Directly join without showing modal
                this.p2pSync.joinRoom(syncCode);

                // Show instructions
                alert('Connecting to shared profile...\n\nYou will receive all data from the host device.');
            }, 300);
        }, 500);
    }

    initializeApp() {
        this.language = localStorage.getItem('language') || 'en';
        this.theme = localStorage.getItem('theme') || 'auto';
        this.medications = this.loadMedications();
        this.medications.forEach(med => { if (med.critical === undefined) med.critical = true; });
        this.selectedDate = new Date();

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        this.metricsDateFrom = sevenDaysAgo;

        this.metricsDateTo = new Date();
        this.metricsFilter = {
            temperature: true,
            bloodPressure: true,
            heartRate: true,
            glucose: true,
            weight: true,
            steps: true,
            oxygenation: true,
            sleep: true,
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
        this.alarmAudio = null;
        this.alarmCheckInterval = null;
        this.lastAlarmTime = null;

        // Initialize P2P sync
        this.p2pSync = new P2PSync(this);

        this.init();
    }

    init() {
        this.updateCurrentProfileDisplay(); // Update profile name in settings
        this.updateHeader(this.currentTab); // Initialize header with current tab
        this.renderMedications();
        this.renderAppointments();
        this.renderLogs();
        this.attachEventListeners();
        this.initializeAlarmSystem();
        this.applyTrackingPreferences(); // Apply saved tracking preferences
        this.loadAlarmSettings(); // Restore alarm checkbox and sound selections
        this.checkNewDay();
        this.checkiOSInstallPrompt(); // Check if we should show iOS install instructions
        this.startVersionCheck(); // Check for app updates periodically
        this.checkSyncParameter(); // Check if opened with sync code
        this.tryAutoReconnect(); // Try to auto-reconnect if we were previously syncing
        this.checkMorningMissedMeds();
        document.documentElement.lang = this.language;
        document.documentElement.dir = ['ar', 'fa', 'ur'].includes(this.language) ? 'rtl' : 'ltr';
        this.applyTranslations();
        const langSelect = document.getElementById('languageSelect');
        if (langSelect) langSelect.value = this.language;
        document.documentElement.dataset.theme = this.theme === 'auto' ? this.getAutoTheme() : this.theme;
        this.updateThemeSelector();
    }

    // Try to auto-reconnect to previous sync session
    tryAutoReconnect() {
        // Don't auto-reconnect if there's a sync code in URL (manual connect takes priority)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('sync')) return;

        // Try auto-reconnect after a short delay to ensure UI is ready
        setTimeout(() => {
            if (this.p2pSync.tryAutoReconnect()) {
                console.log('Auto-reconnect initiated');
            }
        }, 1000);
    }

    // Check if URL has sync parameter from QR code
    checkSyncParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const syncCode = urlParams.get('sync');

        if (syncCode) {
            // Clean up URL without reloading
            window.history.replaceState({}, document.title, window.location.pathname);

            // Switch to settings tab
            this.switchTab('settings');

            // Small delay to ensure UI is ready
            setTimeout(() => {
                // Auto-fill the code
                document.getElementById('syncCode').value = syncCode;

                // Auto-connect directly
                this.p2pSync.joinRoom(syncCode);

                // Show connection status
                alert(`Connecting to shared profile...\n\nYou will receive all data from the host device.`);
            }, 500);
        }
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
        // Don't run if app hasn't been initialized yet (no active profile)
        if (!this.selectedDate || !this.currentProfile) {
            return;
        }

        const today = this.getDateString(new Date());
        const selectedDateStr = this.getDateString(this.selectedDate);

        // If we're viewing today and it's a new day, refresh
        if (selectedDateStr === today) {
            this.dailyLog = this.loadDailyLog(today);
            this.asNeededLogs = this.loadAsNeededLogs(today);
            this.renderMedications();
        }
    }

    // Profile Management Methods

    loadProfiles() {
        const stored = localStorage.getItem('healthProfiles');
        if (stored) {
            return JSON.parse(stored);
        }
        return [];
    }

    saveProfiles() {
        localStorage.setItem('healthProfiles', JSON.stringify(this.profiles));
    }

    hasActiveProfile() {
        const activeProfileId = localStorage.getItem('activeProfileId');
        if (activeProfileId) {
            const profile = this.profiles.find(p => p.id === activeProfileId);
            if (profile) {
                this.currentProfile = profile;
                return true;
            }
        }
        return false;
    }

    setActiveProfile(profileId) {
        const profile = this.profiles.find(p => p.id === profileId);
        if (profile) {
            this.currentProfile = profile;
            localStorage.setItem('activeProfileId', profileId);
            return true;
        }
        return false;
    }

    getProfileDataKey() {
        // Return the key for this profile's data object
        if (this.currentProfile) {
            return `profileData_${this.currentProfile.id}`;
        }
        return null;
    }

    loadProfileData() {
        const key = this.getProfileDataKey();
        if (!key) return null;

        const stored = localStorage.getItem(key);
        if (stored) {
            return JSON.parse(stored);
        }

        // Return empty data structure
        return {
            medications: [],
            dailyLogs: {},
            asNeededLogs: [],
            appointments: [],
            logs: []
        };
    }

    saveProfileData() {
        const key = this.getProfileDataKey();
        if (!key) return;

        const profileData = this.loadProfileData();

        // Update with current data
        profileData.medications = this.medications || [];
        profileData.appointments = this.appointments || [];
        profileData.logs = this.logs || [];

        localStorage.setItem(key, JSON.stringify(profileData));
    }

    showProfileModal() {
        this.renderProfileList();
        document.getElementById('profileModal').classList.add('active');
    }

    closeProfileModal() {
        document.getElementById('profileModal').classList.remove('active');
    }

    renderProfileList() {
        const container = document.getElementById('profileListContainer');

        if (this.profiles.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No profiles yet. Create your first profile to get started.</div>';
            return;
        }

        container.innerHTML = this.profiles.map(profile => {
            const isActive = this.currentProfile && this.currentProfile.id === profile.id;
            const createdDate = new Date(profile.createdAt).toLocaleDateString(this.language, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            return `
                <div class="profile-item ${isActive ? 'active' : ''}" data-profile-id="${profile.id}">
                    <div class="profile-item-info" onclick="tracker.selectProfile('${profile.id}')">
                        <div class="profile-item-name">${profile.name}</div>
                        <div class="profile-item-meta">Created ${createdDate}</div>
                    </div>
                    ${!isActive ? `<div class="profile-item-actions">
                        <button class="profile-delete-button" onclick="tracker.deleteProfile('${profile.id}'); event.stopPropagation();">Delete</button>
                    </div>` : '<div class="profile-item-meta">Active</div>'}
                </div>
            `;
        }).join('');
    }

    selectProfile(profileId) {
        if (this.currentProfile && this.currentProfile.id === profileId) {
            // Already active, just close modal
            this.closeProfileModal();
            return;
        }

        if (this.setActiveProfile(profileId)) {
            // Reload the app with the new profile
            this.closeProfileModal();
            location.reload();
        }
    }

    deleteProfile(profileId) {
        const profile = this.profiles.find(p => p.id === profileId);
        if (!profile) return;

        if (this.currentProfile && this.currentProfile.id === profileId) {
            alert(this.t('alerts.deleteActiveProfile'));
            return;
        }

        if (confirm(this.t('alerts.deleteProfile', { name: profile.name }))) {
            // Delete the single profile data object
            localStorage.removeItem(`profileData_${profileId}`);

            // Remove from profiles array
            this.profiles = this.profiles.filter(p => p.id !== profileId);
            this.saveProfiles();
            this.renderProfileList();
        }
    }

    openProfileFormModal(migrateData = false) {
        document.getElementById('profileFormTitle').textContent = this.t('profile.createNew');
        document.getElementById('profileName').value = '';
        document.getElementById('migrateExistingData').checked = false;

        // Show migration option if there's existing legacy data and this is first profile
        const hasLegacyData = localStorage.getItem('medications') ||
                             localStorage.getItem('appointments') ||
                             localStorage.getItem('logs');

        if (migrateData && hasLegacyData) {
            document.getElementById('migrateDataGroup').style.display = 'block';
        } else {
            document.getElementById('migrateDataGroup').style.display = 'none';
        }

        document.getElementById('profileFormModal').classList.add('active');
    }

    closeProfileFormModal() {
        document.getElementById('profileFormModal').classList.remove('active');
        document.getElementById('profileForm').reset();
    }

    saveProfile() {
        const name = document.getElementById('profileName').value.trim();
        const migrateData = document.getElementById('migrateExistingData').checked;

        if (!name) {
            alert(this.t('alerts.profileNameRequired'));
            return;
        }

        const profile = {
            id: Date.now().toString(),
            name: name,
            createdAt: new Date().toISOString()
        };

        this.profiles.push(profile);
        this.saveProfiles();

        // If migrating data, copy legacy data to this profile
        if (migrateData) {
            this.migrateLegacyData(profile.id);
        }

        // Set as active profile and ensure it's saved
        this.setActiveProfile(profile.id);

        this.closeProfileFormModal();

        // Use setTimeout to ensure localStorage writes complete before reload
        setTimeout(() => {
            location.reload();
        }, 100);
    }

    migrateLegacyData(profileId) {
        // Create a new profile data object from legacy data
        const profileData = {
            medications: [],
            dailyLogs: {},
            asNeededLogs: [],
            appointments: [],
            logs: []
        };

        // Migrate medications
        const medications = localStorage.getItem('medications');
        if (medications) {
            profileData.medications = JSON.parse(medications);
        }

        // Migrate daily logs
        const dailyLogs = localStorage.getItem('dailyLogs');
        if (dailyLogs) {
            profileData.dailyLogs = JSON.parse(dailyLogs);
        }

        // Migrate as-needed logs
        const asNeededLogs = localStorage.getItem('asNeededLogs');
        if (asNeededLogs) {
            profileData.asNeededLogs = JSON.parse(asNeededLogs);
        }

        // Migrate appointments
        const appointments = localStorage.getItem('appointments');
        if (appointments) {
            profileData.appointments = JSON.parse(appointments);
        }

        // Migrate logs (health metrics)
        const logs = localStorage.getItem('logs');
        if (logs) {
            profileData.logs = JSON.parse(logs);
        }

        // Save the consolidated profile data
        localStorage.setItem(`profileData_${profileId}`, JSON.stringify(profileData));
    }

    updateCurrentProfileDisplay() {
        if (this.currentProfile) {
            // Update the new unified profile UI
            const activeProfileName = document.getElementById('activeProfileName');
            if (activeProfileName) {
                activeProfileName.textContent = this.currentProfile.name;
            }

            // Legacy support (if old elements still exist)
            const currentProfileName = document.getElementById('currentProfileName');
            if (currentProfileName) {
                currentProfileName.textContent = this.currentProfile.name;
            }
        }
    }

    // Join sync modal methods
    openJoinSyncModal() {
        document.getElementById('syncCode').value = '';
        document.getElementById('joinSyncModal').classList.add('active');
    }

    closeJoinSyncModal() {
        document.getElementById('joinSyncModal').classList.remove('active');
    }

    // Switch or Join modal methods
    openSwitchOrJoinModal() {
        document.getElementById('switchOrJoinModal').classList.add('active');
    }

    closeSwitchOrJoinModal() {
        document.getElementById('switchOrJoinModal').classList.remove('active');
    }

    // Load medications from localStorage
    loadMedications() {
        const profileData = this.loadProfileData();
        return profileData ? profileData.medications : [];
    }

    // Save medications to localStorage
    saveMedications() {
        this.saveProfileData();
    }

    // Load daily log from localStorage for a specific date
    loadDailyLog(dateStr) {
        const profileData = this.loadProfileData();
        const allLogs = profileData ? profileData.dailyLogs : {};
        return allLogs[dateStr] || { date: dateStr, taken: [] };
    }

    // Save daily log to localStorage
    saveDailyLog() {
        const profileData = this.loadProfileData();
        const dateStr = this.getDateString(this.selectedDate);
        profileData.dailyLogs[dateStr] = this.dailyLog;

        const key = this.getProfileDataKey();
        if (key) {
            localStorage.setItem(key, JSON.stringify(profileData));
        }
    }

    // Load as-needed medication logs for a specific date
    loadAsNeededLogs(dateStr) {
        const profileData = this.loadProfileData();
        const logs = profileData ? profileData.asNeededLogs : [];
        // Filter to only the selected date's logs
        return logs.filter(log => log.date === dateStr);
    }

    // Save as-needed logs
    saveAsNeededLogs() {
        const profileData = this.loadProfileData();

        // Get all as-needed logs from the entire profile data
        const allLogs = profileData.asNeededLogs || [];

        // Update or add the current date's logs
        const currentDateStr = this.getDateString(this.selectedDate);

        // Remove existing logs for current date
        const otherLogs = allLogs.filter(log => log.date !== currentDateStr);

        // Add current logs
        profileData.asNeededLogs = [...otherLogs, ...this.asNeededLogs];

        const key = this.getProfileDataKey();
        if (key) {
            localStorage.setItem(key, JSON.stringify(profileData));
        }
    }

    // Check if medication is taken today (supports both regular ID and displayId with time)
    isTaken(medId) {
        return this.dailyLog.taken.includes(medId);
    }

    // Toggle medication taken status (uses displayId which includes time)
    toggleTaken(displayId) {
        const index = this.dailyLog.taken.indexOf(displayId);
        const wasTaken = index > -1;

        if (wasTaken) {
            this.dailyLog.taken.splice(index, 1);
            if (this.dailyLog.takenTimes) delete this.dailyLog.takenTimes[displayId];
        } else {
            this.dailyLog.taken.push(displayId);
            // Remove from skipped if it was there
            if (this.dailyLog.skipped) {
                this.dailyLog.skipped = this.dailyLog.skipped.filter(id => id !== displayId);
            }
            if (!this.dailyLog.takenTimes) this.dailyLog.takenTimes = {};
            const _now = new Date();
            const hh = String(_now.getHours()).padStart(2,'0');
            const mm = String(_now.getMinutes()).padStart(2,'0');
            this.dailyLog.takenTimes[displayId] = `${this.getDateString(this.selectedDate)}T${hh}:${mm}`;
        }
        this.saveDailyLog();
        this.renderMedications();

        // Broadcast to connected peers
        if (this.p2pSync) {
            const messageType = wasTaken ? 'MED_UNTAKEN' : 'MED_TAKEN';
            this.p2pSync.broadcastChange(messageType, {
                medId: displayId,
                dateStr: this.getDateString(this.selectedDate)
            });
        }
    }

    editTakenTime(displayId) {
        this._editingTakenDisplayId = displayId;
        const raw = this.dailyLog.takenTimes?.[displayId] || '';
        let dateVal = this.getDateString(this.selectedDate);
        let timeVal = '';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
            [dateVal, timeVal] = raw.split('T');
        } else if (/^\d{2}:\d{2}$/.test(raw)) {
            timeVal = raw; // legacy format — date assumed to be the log date
        }
        document.getElementById('editTakenDateInput').value = dateVal;
        document.getElementById('editTakenTimeInput').value = timeVal;
        document.getElementById('editTakenTimeModal').classList.add('active');
    }

    saveTakenTime() {
        const newTime = document.getElementById('editTakenTimeInput').value;
        const newDate = document.getElementById('editTakenDateInput').value;
        const displayId = this._editingTakenDisplayId;
        if (displayId && newTime && newDate) {
            // Always store in the current viewed day's log — date records actual intake time
            if (!this.dailyLog.takenTimes) this.dailyLog.takenTimes = {};
            this.dailyLog.takenTimes[displayId] = `${newDate}T${newTime}`;
            this.saveDailyLog();
            this.renderMedications();
        }
        document.getElementById('editTakenTimeModal').classList.remove('active');
        this._editingTakenDisplayId = null;
    }

    closeEditTakenTimeModal() {
        document.getElementById('editTakenTimeModal').classList.remove('active');
        this._editingTakenDisplayId = null;
    }

    openChangeDosageModal(medId) {
        const med = this.medications.find(m => m.id === medId);
        if (!med) return;
        this._changingDosageMedId = medId;

        document.getElementById('changeDosageCurrent').textContent = med.dosage;
        document.getElementById('changeDosageInput').value = med.dosage;
        document.getElementById('changeDosageDateInput').value = this.getDateString(new Date());
        document.getElementById('changeDosageNoteInput').value = '';

        // Show history if it exists
        const history = med.dosageHistory || [];
        const histSection = document.getElementById('dosageHistorySection');
        const histList = document.getElementById('dosageHistoryList');
        if (history.length > 0) {
            histList.innerHTML = history.map(h => {
                const d = new Date(h.date + 'T12:00:00').toLocaleDateString(this.language, { month: 'short', day: 'numeric', year: 'numeric' });
                return `<div>${d} — ${h.dosage}${h.note ? ` <span style="color:var(--text-tertiary)">(${h.note})</span>` : ''}</div>`;
            }).join('');
            histSection.style.display = '';
        } else {
            histSection.style.display = 'none';
        }

        document.getElementById('changeDosageModal').classList.add('active');
        setTimeout(() => document.getElementById('changeDosageInput').focus(), 50);
    }

    saveChangeDosage() {
        const med = this.medications.find(m => m.id === this._changingDosageMedId);
        const newDosage = document.getElementById('changeDosageInput').value.trim();
        const date = document.getElementById('changeDosageDateInput').value;
        const note = document.getElementById('changeDosageNoteInput').value.trim();
        if (!med || !newDosage || !date) return;

        if (!med.dosageHistory) med.dosageHistory = [];
        // Record the old dosage first if history is empty
        if (med.dosageHistory.length === 0 && med.dosage) {
            med.dosageHistory.push({ dosage: med.dosage, date: date, note: this.t('meds.initialDosage') });
        }
        // Push the new dosage entry
        med.dosageHistory.push({ dosage: newDosage, date, note });
        med.dosage = newDosage;

        this.saveMedications();
        this.renderMedications();
        this.closeChangeDosageModal();
    }

    closeChangeDosageModal() {
        document.getElementById('changeDosageModal').classList.remove('active');
        this._changingDosageMedId = null;
    }

    toggleCritical(medId) {
        const med = this.medications.find(m => m.id === medId);
        if (!med) return;
        med.critical = med.critical === false ? true : false;
        this.saveMedications();
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
                <div class="time-container-header">${this.t('timeOfDay.asNeeded')}</div>
                <div class="meds-grid">
                    ${this.asNeededLogs.map(log => this.renderAsNeededLog(log)).join('')}
                </div>
            </div>
        ` : '';

        if (sorted.length === 0 && this.asNeededLogs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        ${this.t('meds.empty')}
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = medsHtml + asNeededHtml;
            // Auto-size any pre-filled slot notes textareas
            container.querySelectorAll('.slot-notes-input').forEach(el => {
                if (el.value) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
            });
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
                const timeKey = time.toLowerCase();
                const dateStr = this.getDateString(this.selectedDate);
                const slotNoteEntry = this.logs.find(l => l.id === `slotNote_${dateStr}_${timeKey}`);
                const savedNote = (slotNoteEntry?.notes || '').replace(/"/g, '&quot;');
                html += `
                    <div class="time-container">
                        <div class="time-container-header">${this.t('timeOfDay.' + timeKey)}</div>
                        <textarea class="slot-notes-input" rows="1"
                            placeholder="${this.t('logModal.notes')}"
                            oninput="tracker.saveSlotNote('${timeKey}', this.value); this.style.height='auto'; this.style.height=this.scrollHeight+'px';"
                        >${savedNote}</textarea>
                        <div class="meds-grid">
                            ${medsForTime.map(med => this.renderMedCard(med)).join('')}
                        </div>
                    </div>
                `;
            }
        });

        return html;
    }

    saveSlotNote(timeKey, value) {
        const slotHours = { morning: '08:00', afternoon: '12:00', evening: '18:00', bedtime: '21:00' };
        const dateStr = this.getDateString(this.selectedDate);
        const id = `slotNote_${dateStr}_${timeKey}`;
        const idx = this.logs.findIndex(l => l.id === id);

        if (value.trim()) {
            const entry = {
                id,
                datetime: `${dateStr}T${slotHours[timeKey] || '12:00'}`,
                temperature: null, bpSystolic: null, bpDiastolic: null,
                heartRate: null, glucose: null, weight: null,
                steps: null, oxygenation: null, sleep: null,
                notes: value.trim(),
                slotNote: timeKey
            };
            if (idx > -1) {
                this.logs[idx] = entry;
            } else {
                this.logs.push(entry);
            }
        } else if (idx > -1) {
            this.logs.splice(idx, 1);
        }
        this.saveLogs();
    }

    // Get schedule description
    getScheduleDescription(schedule) {
        if (!schedule) return this.t('schedule.everyDay');

        let desc = '';
        if (schedule.frequency === 'daily') {
            desc = this.t('schedule.everyDay');
        } else if (schedule.frequency === 'every-other-day') {
            desc = this.t('schedule.everyOtherDay');
        } else if (schedule.frequency === 'mwf') {
            desc = this.t('schedule.mwf');
        } else if (schedule.frequency === 'custom-days' && schedule.days) {
            const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const selectedDays = schedule.days.map(d => this.t('days.' + dayKeys[d])).join(', ');
            desc = selectedDays;
        }

        if (schedule.endDate) {
            const [year, month, day] = schedule.endDate.split('-').map(Number);
            const endDate = new Date(year, month - 1, day);
            const formatted = endDate.toLocaleDateString(this.language, { month: 'short', day: 'numeric', year: 'numeric' });
            desc += this.t('schedule.untilDate', { date: formatted });
        } else if (schedule.duration) {
            desc += ' ' + this.t('schedule.ongoing');
        }

        return desc;
    }

    // Render individual medication card
    renderMedCard(med) {
        const displayId = med.displayId || med.id;
        const taken = this.isTaken(displayId);
        const skipped = this.dailyLog.skipped?.includes(displayId) || false;
        const isActiveToday = this.isMedicationActiveToday(med);
        const selectedStr = this.getDateString(this.selectedDate);
        const todayStr = this.getDateString(new Date());
        const isPastDay = selectedStr < todayStr;

        // Parse taken time (new: YYYY-MM-DDTHH:MM, legacy: HH:MM or locale string)
        const takenTimeRaw = taken && this.dailyLog.takenTimes?.[displayId];
        let takenTimeFormatted = null;
        let takenDateNote = '';
        if (takenTimeRaw) {
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(takenTimeRaw)) {
                const [datePart, timePart] = takenTimeRaw.split('T');
                const [h, m] = timePart.split(':').map(Number);
                const d = new Date(); d.setHours(h, m, 0, 0);
                takenTimeFormatted = d.toLocaleTimeString(this.language, { hour: 'numeric', minute: '2-digit' });
                if (datePart !== selectedStr) {
                    takenDateNote = ` (${new Date(datePart + 'T12:00:00').toLocaleDateString(this.language, { month: 'short', day: 'numeric' })})`;
                }
            } else if (/^\d{2}:\d{2}$/.test(takenTimeRaw)) {
                const [h, m] = takenTimeRaw.split(':').map(Number);
                const d = new Date(); d.setHours(h, m, 0, 0);
                takenTimeFormatted = d.toLocaleTimeString(this.language, { hour: 'numeric', minute: '2-digit' });
            } else {
                takenTimeFormatted = takenTimeRaw; // legacy locale string
            }
        }

        const showMissedBtn = isPastDay && !taken && !skipped && isActiveToday;

        return `
            <div class="med-card ${taken ? 'taken' : ''} ${skipped ? 'skipped' : ''} ${!isActiveToday ? 'inactive' : ''}" data-id="${displayId}">
                <div class="med-checkbox" onclick="tracker.toggleTaken('${displayId}')" ${!isActiveToday ? 'style="opacity: 0.3; pointer-events: none;"' : ''}>
                    ${taken ? '✓' : skipped ? '–' : ''}
                </div>
                <div class="med-info">
                    <div class="med-name-row">
                        <span class="med-name">${med.name}</span>
                        <button type="button" class="priority-badge ${med.critical !== false ? 'critical' : 'optional'}" onclick="event.stopPropagation(); tracker.toggleCritical('${med.id}')" title="${this.t('meds.tapToPriority')}">${med.critical !== false ? this.t('meds.critical') : this.t('meds.optional')}</button>
                        ${skipped ? `<span class="missed-badge">${this.t('meds.missed')}</span>` : ''}
                    </div>
                    <div class="med-dosage" onclick="event.stopPropagation(); tracker.openChangeDosageModal('${med.id}')" title="${this.t('meds.changeDosage')}">${med.dosage}<span class="dosage-edit-icon">✏️</span></div>
                    ${takenTimeFormatted ? `<div class="time-taken" onclick="event.stopPropagation(); tracker.editTakenTime('${displayId}')">${this.t('meds.takenAt')} ${takenTimeFormatted}${takenDateNote}<span class="time-edit-icon">✏️</span></div>` : ''}
                    ${skipped ? `<button type="button" class="undo-missed-btn" onclick="event.stopPropagation(); tracker.unskipMed('${displayId}')">${this.t('meds.undoMissed')}</button>` : ''}
                    ${showMissedBtn ? `<button type="button" class="mark-missed-btn" onclick="event.stopPropagation(); tracker.skipMed('${displayId}')">${this.t('meds.missed')}</button>` : ''}
                    ${med.notes ? `<div class="med-notes">${med.notes}</div>` : ''}
                </div>
            </div>
        `;
    }

    skipMed(displayId, dateStr) {
        if (dateStr && dateStr !== this.getDateString(this.selectedDate)) {
            const profileData = this.loadProfileData();
            const log = profileData.dailyLogs[dateStr] || { date: dateStr, taken: [] };
            if (!log.skipped) log.skipped = [];
            if (!log.skipped.includes(displayId)) log.skipped.push(displayId);
            profileData.dailyLogs[dateStr] = log;
            const key = this.getProfileDataKey();
            if (key) localStorage.setItem(key, JSON.stringify(profileData));
        } else {
            if (!this.dailyLog.skipped) this.dailyLog.skipped = [];
            if (!this.dailyLog.skipped.includes(displayId)) this.dailyLog.skipped.push(displayId);
            this.saveDailyLog();
            this.renderMedications();
        }
    }

    unskipMed(displayId) {
        if (!this.dailyLog.skipped) return;
        this.dailyLog.skipped = this.dailyLog.skipped.filter(id => id !== displayId);
        this.saveDailyLog();
        this.renderMedications();
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

    // Attach profile-specific event listeners
    attachProfileEventListeners() {
        document.getElementById('addProfileButton').addEventListener('click', () => {
            this.openProfileFormModal();
        });

        document.getElementById('profileFormCancelButton').addEventListener('click', () => {
            this.closeProfileFormModal();
        });

        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProfile();
        });

        // Import from backup button in profile selection modal
        document.getElementById('importProfileButton').addEventListener('click', () => {
            document.getElementById('importProfileFileInput').click();
        });

        document.getElementById('importProfileFileInput').addEventListener('change', (e) => {
            this.importDataWithProfile(e.target.files[0]);
            e.target.value = ''; // Reset file input
        });
    }

    // Attach event listeners
    attachEventListeners() {
        // Profile management
        this.attachProfileEventListeners();

        // New unified profile UI event listeners
        document.getElementById('shareProfileButton').addEventListener('click', () => {
            this.p2pSync.startHost();
        });

        document.getElementById('switchOrJoinButton').addEventListener('click', () => {
            this.openSwitchOrJoinModal();
        });

        document.getElementById('switchOrJoinCancelButton').addEventListener('click', () => {
            this.closeSwitchOrJoinModal();
        });

        document.getElementById('switchProfileChoice').addEventListener('click', () => {
            this.closeSwitchOrJoinModal();
            this.showProfileModal();
        });

        document.getElementById('joinProfileChoice').addEventListener('click', () => {
            this.closeSwitchOrJoinModal();
            this.openJoinSyncModal();
        });

        document.getElementById('stopSharingButton').addEventListener('click', () => {
            this.p2pSync.disconnect();
        });

        document.getElementById('disconnectButton').addEventListener('click', () => {
            this.p2pSync.disconnect();
        });

        document.getElementById('joinSyncCancelButton').addEventListener('click', () => {
            this.closeJoinSyncModal();
        });

        document.getElementById('joinSyncForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const code = document.getElementById('syncCode').value.trim().toUpperCase();
            if (code) {
                this.p2pSync.joinRoom(code);
                this.closeJoinSyncModal();
            }
        });

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

        // Auto-fill dosage when a known medication name is selected
        document.getElementById('asNeededName').addEventListener('input', () => {
            const name = document.getElementById('asNeededName').value.trim().toLowerCase();
            const dosageField = document.getElementById('asNeededDosage');
            if (!dosageField.value) {
                const match = this.getKnownMeds().find(m => m.name.toLowerCase() === name);
                if (match?.dosage) dosageField.value = match.dosage;
            }
        });

        document.getElementById('asNeededModal').addEventListener('click', (e) => {
            if (e.target.id === 'asNeededModal') {
                this.closeAsNeededModal();
            }
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
                addressLabel.textContent = this.t('apptModal.addressVirtualField');
            } else {
                addressLabel.textContent = this.t('apptModal.addressField');
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
            const durationUnitLabel = document.getElementById('durationUnitLabel');

            if (e.target.value === 'weeks' || e.target.value === 'months') {
                durationNumberGroup.style.display = 'block';
                endDateGroup.style.display = 'none';
                bottleDosesGroup.style.display = 'none';
                if (durationUnitLabel) durationUnitLabel.textContent = this.t(e.target.value === 'weeks' ? 'medModal.numOfWeeks' : 'medModal.numOfMonths');
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

        // Add specific time button
        document.getElementById('addSpecificTimeButton').addEventListener('click', () => {
            this.addSpecificTimeRow();
        });



        document.getElementById('logCancelButton').addEventListener('click', () => {
            this.closeLogModal();
        });

        document.getElementById('editTakenTimeCancelBtn').addEventListener('click', () => this.closeEditTakenTimeModal());
        document.getElementById('editTakenTimeSaveBtn').addEventListener('click', () => this.saveTakenTime());
        document.getElementById('editTakenTimeModal').addEventListener('click', (e) => {
            if (e.target.id === 'editTakenTimeModal') this.closeEditTakenTimeModal();
        });

        document.getElementById('changeDosageCancelBtn').addEventListener('click', () => this.closeChangeDosageModal());
        document.getElementById('changeDosageSaveBtn').addEventListener('click', () => this.saveChangeDosage());
        document.getElementById('changeDosageModal').addEventListener('click', (e) => {
            if (e.target.id === 'changeDosageModal') this.closeChangeDosageModal();
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
            { checkbox: 'enableOxygenation', input: 'logOxygenation' },
            { checkbox: 'enableSleep', input: 'logSleep' },
            { checkbox: 'enableNotes', input: 'logNotes' }
        ];

        logMetricCheckboxes.forEach(item => {
            const checkbox = document.getElementById(item.checkbox);

            // Unchecking clears the associated input(s)
            checkbox.addEventListener('change', (e) => {
                if (!e.target.checked) {
                    const ids = item.inputs || [item.input];
                    ids.forEach(id => { document.getElementById(id).value = ''; });
                }
            });

            // Typing in an input auto-checks its checkbox; clearing auto-unchecks
            const ids = item.inputs || [item.input];
            ids.forEach(id => {
                document.getElementById(id).addEventListener('input', () => {
                    const hasValue = item.inputs
                        ? item.inputs.some(i => document.getElementById(i).value.trim() !== '')
                        : document.getElementById(item.input).value.trim() !== '';
                    checkbox.checked = hasValue;
                });
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

        // Settings tab - time of day inputs
        ['Morning', 'Afternoon', 'Evening', 'Bedtime'].forEach(timeOfDay => {
            const input = document.getElementById(`time${timeOfDay}`);
            input.addEventListener('change', (e) => {
                this.saveTimeOfDaySetting(timeOfDay, e.target.value);

                // If time is cleared, reset alarm to 'none'
                if (!e.target.value) {
                    const alarmSelect = document.getElementById(`alarmSound${timeOfDay}`);
                    if (alarmSelect) {
                        alarmSelect.value = 'none';
                        this.saveAlarmSound(timeOfDay.toLowerCase(), 'none');
                        this.updateTestButtonState(timeOfDay.toLowerCase());
                    }
                }
            });
        });

        // Settings tab - alarm settings
        document.getElementById('enableAlarms').addEventListener('change', (e) => {
            this.saveAlarmSetting('enabled', e.target.checked);
            this.toggleAlarmSettings(e.target.checked);
            if (e.target.checked) {
                this.initializeAlarmSystem();
            } else {
                this.stopAlarmSystem();
            }
        });

        // Alarm sound selectors for each time of day
        ['Morning', 'Afternoon', 'Evening', 'Bedtime'].forEach(timeOfDay => {
            const select = document.getElementById(`alarmSound${timeOfDay}`);
            select.addEventListener('change', (e) => {
                this.saveAlarmSound(timeOfDay.toLowerCase(), e.target.value);
                // Update test button state based on alarm selection
                this.updateTestButtonState(timeOfDay.toLowerCase());
            });
        });

        // Test alarm buttons
        // Support both old and new test alarm button classes
        document.querySelectorAll('.test-alarm-button, .test-alarm-compact').forEach(button => {
            button.addEventListener('click', (e) => {
                const timeOfDay = e.target.getAttribute('data-time');
                this.testAlarmSound(timeOfDay);
            });
        });

        // Save Time of Day & Alarm Settings button
        document.getElementById('saveTimeAlarmSettingsBtn')?.addEventListener('click', () => {
            this.showToast(this.t('toasts.alarmSaved'));
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
        const metricCheckboxes = ['metricWeight', 'metricTemperature', 'metricBloodPressure', 'metricHeartRate', 'metricBloodSugar', 'metricSteps', 'metricOxygenation', 'metricSleep'];
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
                headerTitle.textContent = this.t('header.meds');
                // Date picker with week picker button
                datePickerContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="date" id="datePicker" class="date-picker">
                        <button class="action-button" id="weekPickerButton" style="padding: 12px 20px; white-space: nowrap;">${this.t('header.weekView')}</button>
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
                    <button class="action-button" id="addMedButton">${this.t('header.medSchedule')}</button>
                    <button class="action-button secondary" id="logAsNeededButton">${this.t('header.asNeeded')}</button>
                `;
                // Re-attach event listeners for medication buttons
                document.getElementById('addMedButton').addEventListener('click', () => this.openMedListModal());
                document.getElementById('logAsNeededButton').addEventListener('click', () => this.openAsNeededModal());
                break;

            case 'appointments':
                headerTitle.textContent = this.t('header.appointments');
                datePickerContainer.style.display = 'none';
                headerActions.innerHTML = `
                    <button class="action-button" id="addApptHeaderButton">${this.t('header.addAppointment')}</button>
                `;
                // Re-attach event listener for appointment button
                document.getElementById('addApptHeaderButton').addEventListener('click', () => this.openApptModal());
                break;

            case 'log':
                headerTitle.textContent = this.t('header.metrics');
                datePickerContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="date" id="metricsDateFrom" class="date-picker" style="flex: 1; min-width: 150px;">
                        <span style="color: #666;">${this.t('metrics.to')}</span>
                        <input type="date" id="metricsDateTo" class="date-picker" style="flex: 1; min-width: 150px;">
                        <div style="position: relative;">
                            <button id="metricsFilterButton" style="padding: 12px 20px; background: white; border: 2px solid #6b7c93; border-radius: 10px; font-size: 1.1rem; font-weight: 600; color: #6b7c93; cursor: pointer; white-space: nowrap;">
                                ${this.t('header.filterMetrics')}
                            </button>
                            <div id="metricsFilterDropdown" style="display: none; position: absolute; top: 100%; right: 0; margin-top: 5px; background: white; border: 2px solid #ddd; border-radius: 10px; padding: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; min-width: 200px;">
                                ${this.generateMetricsFilterOptions()}
                            </div>
                        </div>
                        <button id="metricsPrintButton" style="padding: 12px 20px; background: #6b7c93; border: 2px solid #6b7c93; border-radius: 10px; font-size: 1.1rem; font-weight: 600; color: white; cursor: pointer; white-space: nowrap;">
                            ${this.t('header.print')}
                        </button>
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
                    { id: 'filterOxygenation', key: 'oxygenation' },
                    { id: 'filterSleep', key: 'sleep' },
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

                // Print button listener
                const printButton = document.getElementById('metricsPrintButton');
                if (printButton) {
                    printButton.addEventListener('click', () => {
                        this.openPrintModal();
                    });
                }

                headerActions.innerHTML = `
                    <button class="action-button" id="addMetricsHeaderButton">${this.t('header.addMetrics')}</button>
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
                            <div class="header-app-name">Meds</div>
                            <div class="header-app-version">Version 1.5.8 — Oct 30, 2026</div>
                            <div class="header-app-author">by Sid Cooperrider</div>
                        </div>
                    </div>
                `;
                datePickerContainer.style.display = 'none';

                // Load time of day settings
                this.loadTimeOfDaySettings();

                // Sync checkbox states with localStorage
                const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": false, "metrics": true}');
                document.getElementById('trackAppointments').checked = prefs.appointments;
                document.getElementById('trackMetrics').checked = prefs.metrics;

                // Sync metric sub-option checkboxes
                const metricPrefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true, "oxygenation": true, "sleep": true}');
                document.getElementById('metricWeight').checked = metricPrefs.weight;
                document.getElementById('metricTemperature').checked = metricPrefs.temperature;
                document.getElementById('metricBloodPressure').checked = metricPrefs.bloodpressure;
                document.getElementById('metricHeartRate').checked = metricPrefs.heartrate;
                document.getElementById('metricBloodSugar').checked = metricPrefs.bloodsugar;
                document.getElementById('metricSteps').checked = metricPrefs.steps;
                document.getElementById('metricOxygenation').checked = metricPrefs.oxygenation !== false;
                document.getElementById('metricSleep').checked = metricPrefs.sleep !== false;

                // Show/hide metric sub-options based on trackMetrics state
                this.toggleMetricsSubOptions(prefs.metrics);

                // Sync language dropdown to current setting
                const langSelect = document.getElementById('languageSelect');
                if (langSelect) langSelect.value = this.language;

                // Show back button if both tabs are unchecked
                const bothUnchecked = !prefs.appointments && !prefs.metrics;
                if (bothUnchecked) {
                    headerActions.innerHTML = `<button class="action-button" id="backToMedsButton">${this.t('header.back')}</button>`;
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
            document.getElementById('medModalTitle').textContent = this.t('medModal.editTitle');
            document.getElementById('medName').value = medication.name;
            document.getElementById('medDosage').value = medication.dosage;
            document.getElementById('medNotes').value = medication.notes || '';

            // Populate times checkboxes
            const times = medication.times || [medication.time]; // Support old format
            document.querySelectorAll('input[name="medTimes"]').forEach(cb => {
                cb.checked = times.includes(cb.value);
            });

            // Load specific times
            this.loadSpecificTimes(medication.specificTimes || []);

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
                    const durationUnitLabel = document.getElementById('durationUnitLabel');
                    if (durationUnitLabel) durationUnitLabel.textContent = this.t(medication.schedule.durationType === 'weeks' ? 'medModal.numOfWeeks' : 'medModal.numOfMonths');
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
            // Set priority
            const isCritical = medication.critical !== false;
            document.getElementById('medPriority').value = isCritical ? 'critical' : 'optional';
        } else {
            document.getElementById('medModalTitle').textContent = this.t('medModal.addTitle');
            form.reset();
            // Reset checkboxes
            document.querySelectorAll('input[name="medTimes"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('input[name="medDays"]').forEach(cb => cb.checked = false);
            document.getElementById('customDaysGroup').style.display = 'none';
            document.getElementById('durationNumberGroup').style.display = 'none';
            document.getElementById('endDateGroup').style.display = 'none';
            document.getElementById('bottleDosesGroup').style.display = 'none';
            // Clear specific times
            this.clearSpecificTimes();
            // Set default start date to today
            document.getElementById('medStartDate').value = new Date().toISOString().split('T')[0];
            this.editingId = null;
            // Hide stop button when adding new medication
            document.getElementById('stopMedButton').style.display = 'none';
            // Default priority to Critical
            document.getElementById('medPriority').value = 'critical';
        }

        modal.classList.add('active');
    }

    closeMedModal() {
        document.getElementById('medModal').classList.remove('active');
        document.getElementById('medForm').reset();
        this.clearSpecificTimes();
        this.editingId = null;
    }

    stopMedication() {
        if (!this.editingId) return;

        if (confirm(this.t('alerts.stopMed'))) {
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

    // Add a specific time row with time picker and alarm dropdown
    addSpecificTimeRow() {
        const container = document.getElementById('specificTimesContainer');
        const rowId = `specificTime_${Date.now()}`;

        const row = document.createElement('div');
        row.className = 'specific-time-item';
        row.dataset.id = rowId;

        row.innerHTML = `
            <label>Time:</label>
            <input type="time" class="specific-time-input" data-row="${rowId}">
            <select class="specific-alarm-select" data-row="${rowId}">
                <option value="none">No Alarm</option>
                <option value="alarm_01.mp3">Alarm 1 - Gentle Bell</option>
                <option value="alarm_02.mp3">Alarm 2 - Soft Chime</option>
                <option value="alarm_03.mp3">Alarm 3 - Morning Birds</option>
                <option value="alarm_04.mp3">Alarm 4 - Classic Bell</option>
                <option value="alarm_05.mp3">Alarm 5 - Digital Beep</option>
                <option value="alarm_06.mp3">Alarm 6 - Pleasant Tone</option>
                <option value="alarm_07.mp3">Alarm 7 - Piercing Beep Beep</option>
            </select>
            <button type="button" class="remove-specific-time" data-row="${rowId}">Remove</button>
        `;

        container.appendChild(row);

        // Add event listener for remove button
        row.querySelector('.remove-specific-time').addEventListener('click', (e) => {
            this.removeSpecificTimeRow(e.target.dataset.row);
        });
    }

    // Remove a specific time row
    removeSpecificTimeRow(rowId) {
        const row = document.querySelector(`.specific-time-item[data-id="${rowId}"]`);
        if (row) {
            row.remove();
        }
    }

    // Get all specific times with their alarm sounds
    getSpecificTimes() {
        const rows = document.querySelectorAll('.specific-time-item');
        const specificTimes = [];

        rows.forEach(row => {
            const timeInput = row.querySelector('.specific-time-input');
            const alarmSelect = row.querySelector('.specific-alarm-select');

            if (timeInput.value) {
                specificTimes.push({
                    time: timeInput.value,
                    alarm: alarmSelect.value
                });
            }
        });

        return specificTimes;
    }

    // Clear all specific time rows
    clearSpecificTimes() {
        const container = document.getElementById('specificTimesContainer');
        container.innerHTML = '';
    }

    // Load specific times into the form
    loadSpecificTimes(specificTimes) {
        this.clearSpecificTimes();

        if (specificTimes && specificTimes.length > 0) {
            specificTimes.forEach(st => {
                this.addSpecificTimeRow();
                // Find the last added row and set its values
                const rows = document.querySelectorAll('.specific-time-item');
                const lastRow = rows[rows.length - 1];

                lastRow.querySelector('.specific-time-input').value = st.time;
                lastRow.querySelector('.specific-alarm-select').value = st.alarm || 'none';
            });
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
            container.innerHTML = `<div class="empty-med-list">${this.t('medListModal.empty').replace('\n', '<br>')}</div>`;
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
                    ${times.map(time => { const k = {Morning:'morning',Afternoon:'afternoon',Evening:'evening',Bedtime:'bedtime'}[time]; return `<span class="med-list-time-badge">${k ? this.t('timeOfDay.'+k) : time}</span>`; }).join('')}
                </div>
            </div>
        `;
    }

    // Get schedule description text
    getScheduleDescription(schedule) {
        if (!schedule) return this.t('schedule.daily');

        let desc = '';

        // Frequency
        if (schedule.frequency === 'daily') {
            desc = this.t('schedule.daily');
        } else if (schedule.frequency === 'every-other-day') {
            desc = this.t('schedule.everyOtherDay');
        } else if (schedule.frequency === 'mwf') {
            desc = this.t('schedule.mwf');
        } else if (schedule.frequency === 'custom-days' && schedule.days) {
            const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            desc = schedule.days.map(d => this.t('days.' + dayKeys[d])).join(', ');
        }

        // Start date
        if (schedule.startDate) {
            const [year, month, day] = schedule.startDate.split('-').map(Number);
            const startDate = new Date(year, month - 1, day);
            desc += ' ' + this.t('schedule.starts').replace('{{date}}', startDate.toLocaleDateString());
        }

        // Duration
        if (schedule.durationType === 'weeks') {
            desc += ' ' + this.t('schedule.nWeeks').replace('{{n}}', schedule.durationNumber);
        } else if (schedule.durationType === 'months') {
            desc += ' ' + this.t('schedule.nMonths').replace('{{n}}', schedule.durationNumber);
        } else if (schedule.durationType === 'end-date' && schedule.endDate) {
            const [eYear, eMonth, eDay] = schedule.endDate.split('-').map(Number);
            const endDate = new Date(eYear, eMonth - 1, eDay);
            desc += ' ' + this.t('schedule.untilDate').replace('{{date}}', endDate.toLocaleDateString());
        } else if (schedule.durationType === 'bottle-doses' && schedule.bottleDoses) {
            desc += ' ' + this.t('schedule.nDoses').replace('{{n}}', schedule.bottleDoses);
            if (schedule.endDate) {
                const [eYear, eMonth, eDay] = schedule.endDate.split('-').map(Number);
                const endDate = new Date(eYear, eMonth - 1, eDay);
                desc += ' ' + this.t('schedule.untilDateParens').replace('{{date}}', endDate.toLocaleDateString());
            }
        } else if (schedule.durationType === 'ongoing') {
            desc += ' • ' + this.t('schedule.ongoing');
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
        const critical = document.getElementById('medPriority').value === 'critical';

        // Get selected times
        const selectedTimes = Array.from(document.querySelectorAll('input[name="medTimes"]:checked'))
            .map(cb => cb.value);

        // Get specific times with alarms
        const specificTimes = this.getSpecificTimes();

        if (!name || !dosage) {
            alert(this.t('alerts.requiredFields'));
            return;
        }

        if (selectedTimes.length === 0 && specificTimes.length === 0) {
            alert(this.t('alerts.selectTime'));
            return;
        }

        if (!startDate) {
            alert(this.t('alerts.selectStartDate'));
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
                alert(this.t('alerts.selectDays'));
                return;
            }
            schedule.days = selectedDays;
        }

        // Handle duration
        if (durationType === 'weeks' || durationType === 'months') {
            const durationNumber = parseInt(document.getElementById('medDurationNumber').value);
            if (!durationNumber || durationNumber < 1) {
                alert(this.t('alerts.invalidDuration'));
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
                alert(this.t('alerts.selectEndDate'));
                return;
            }
            schedule.endDate = endDate;
        } else if (durationType === 'bottle-doses') {
            const bottleDoses = parseInt(document.getElementById('medBottleDoses').value);
            if (!bottleDoses || bottleDoses < 1) {
                alert(this.t('alerts.bottleDosesRequired'));
                return;
            }
            schedule.bottleDoses = bottleDoses;

            // Calculate end date based on doses and frequency
            const result = this.calculateEndDateFromDoses(startDate, bottleDoses, selectedTimes, frequency, schedule);
            schedule.endDate = result.endDate;
            schedule.lastDayDoses = result.lastDayDoses;
        }

        let updatedMed = null;
        let isNew = false;

        if (this.editingId) {
            // Update existing medication
            const index = this.medications.findIndex(m => m.id === this.editingId);
            if (index > -1) {
                this.medications[index] = {
                    ...this.medications[index],
                    name,
                    dosage,
                    times: selectedTimes,
                    specificTimes: specificTimes,
                    notes,
                    schedule,
                    critical
                };
                updatedMed = this.medications[index];
            }
        } else {
            // Add new medication
            const medication = {
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                name,
                dosage,
                times: selectedTimes,
                specificTimes: specificTimes,
                notes,
                schedule,
                critical
            };
            this.medications.push(medication);
            updatedMed = medication;
            isNew = true;
        }

        this.saveMedications();
        this.renderMedications();
        this.closeMedModal();

        // Broadcast to connected peers
        if (this.p2pSync && updatedMed) {
            const messageType = isNew ? 'MED_ADDED' : 'MED_UPDATED';
            this.p2pSync.broadcastChange(messageType, updatedMed);
        }
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
        if (confirm(this.t('alerts.deleteMed'))) {
            this.medications = this.medications.filter(m => m.id !== id);
            // Also remove from today's log if present
            this.dailyLog.taken = this.dailyLog.taken.filter(takenId => takenId !== id);
            this.saveMedications();
            this.saveDailyLog();
            this.renderMedications();

            // Broadcast to connected peers
            if (this.p2pSync) {
                this.p2pSync.broadcastChange('MED_DELETED', { id });
            }
        }
    }

    // As-needed medication methods
    getKnownMeds() {
        // Collect {name, dosage} from scheduled meds and all past as-needed logs, deduped by name
        const map = new Map(); // name.toLowerCase() -> {name, dosage}

        // Scheduled medications first (lowest priority — as-needed history can override dosage)
        this.medications.forEach(med => {
            map.set(med.name.toLowerCase(), { name: med.name, dosage: med.dosage });
        });

        // All as-needed logs across all dates (most recent last so latest dosage wins)
        const profileData = this.loadProfileData();
        const allAsNeeded = profileData?.asNeededLogs || [];
        allAsNeeded.forEach(log => {
            if (log.name) map.set(log.name.toLowerCase(), { name: log.name, dosage: log.dosage });
        });

        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    openAsNeededModal(log = null) {
        const modal = document.getElementById('asNeededModal');
        const form = document.getElementById('asNeededForm');
        const modalTitle = document.querySelector('#asNeededModal h2');

        // Populate datalist with known medications
        const datalist = document.getElementById('asNeededNameList');
        if (datalist) {
            const known = this.getKnownMeds();
            datalist.innerHTML = known.map(m =>
                `<option value="${m.name.replace(/"/g, '&quot;')}">${m.dosage || ''}</option>`
            ).join('');
        }

        if (log) {
            // Editing existing log
            modalTitle.textContent = this.t('asNeededModal.editTitle');
            document.getElementById('asNeededName').value = log.name;
            document.getElementById('asNeededDosage').value = log.dosage;
            document.getElementById('asNeededTime').value = log.time;
            document.getElementById('asNeededNotes').value = log.notes || '';
            this.editingAsNeededId = log.id;
        } else {
            // Adding new log
            modalTitle.textContent = this.t('asNeededModal.addTitle');
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
            alert(this.t('alerts.requiredFields'));
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
        if (confirm(this.t('alerts.deleteLog'))) {
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
        const profileData = this.loadProfileData();
        return profileData ? profileData.appointments : [];
    }

    saveAppointments() {
        this.saveProfileData();
    }

    renderAppointments() {
        const container = document.getElementById('appointmentsList');
        const now = new Date();

        if (this.appointments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        ${this.t('appointments.noAny')}<br>
                        ${this.t('appointments.noAnyHint')}
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
            const emptyKey = this.appointmentFilter === 'upcoming' ? 'appointments.noUpcoming' : 'appointments.noPast';
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">
                        ${this.t(emptyKey)}
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
        const locale = this.language;
        const dateOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
        const formattedDate = apptDate.toLocaleDateString(locale, dateOptions);
        const formattedTime = apptDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

        // Get type badge class and translated label
        const typeClass = appt.type.toLowerCase().replace(' ', '');
        const typeKeyMap = {
            'Doctor Visit': 'apptModal.typeDoctorVisit',
            'Infusion':     'apptModal.typeInfusion',
            'Lab Work':     'apptModal.typeLabWork',
            'Procedure':    'apptModal.typeProcedure',
            'Other':        'apptModal.typeOther'
        };
        const typeLabel = this.t(typeKeyMap[appt.type] || appt.type);
        const locationLabel = this.t(appt.location === 'Virtual' ? 'apptModal.locationVirtual' : 'apptModal.locationInPerson');

        return `
            <div class="appt-card ${isPast ? 'past' : ''} ${isCompleted ? 'completed' : ''}" data-id="${appt.id}">
                <div class="appt-header">
                    <div class="appt-type-badge ${typeClass}">${typeLabel}</div>
                </div>
                <div class="appt-title">${appt.title}</div>
                <div class="appt-datetime">
                    📅 ${formattedDate} ${this.t('appointments.at')} ${formattedTime}
                </div>
                <div class="appt-location">
                    ${appt.location === 'Virtual' ? '💻' : '🏥'} ${locationLabel}
                </div>
                ${appt.address ? `<div class="appt-address">${appt.address}</div>` : ''}
                ${appt.notes ? `<div class="appt-notes">📝 ${appt.notes}</div>` : ''}
                <div class="appt-actions">
                    <button class="complete-button" onclick="tracker.toggleAppointmentComplete('${appt.id}')">
                        ${isCompleted ? this.t('appointments.completed') : this.t('appointments.markComplete')}
                    </button>
                    <button class="edit-button" onclick="tracker.editAppointment('${appt.id}')">${this.t('appointments.edit')}</button>
                    <button class="delete-button" onclick="tracker.deleteAppointment('${appt.id}')">${this.t('appointments.delete')}</button>
                </div>
            </div>
        `;
    }

    openApptModal(appointment = null) {
        const modal = document.getElementById('apptModal');
        const form = document.getElementById('apptForm');

        if (appointment) {
            document.getElementById('apptModalTitle').textContent = this.t('apptModal.editTitle');
            document.getElementById('apptType').value = appointment.type;
            document.getElementById('apptTitle').value = appointment.title;
            document.getElementById('apptDate').value = appointment.date;
            document.getElementById('apptTime').value = appointment.time;
            document.getElementById('apptLocation').value = appointment.location;
            document.getElementById('apptAddress').value = appointment.address || '';
            document.getElementById('apptNotes').value = appointment.notes || '';
            this.editingId = appointment.id;
        } else {
            document.getElementById('apptModalTitle').textContent = this.t('apptModal.addTitle');
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
            alert(this.t('alerts.requiredFields'));
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
        if (confirm(this.t('alerts.deleteAppt'))) {
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
        const profileData = this.loadProfileData();
        return profileData ? profileData.logs : [];
    }

    saveLogs() {
        this.saveProfileData();
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
                    <p>${allLogsEmpty ? this.t('metrics.noData') : this.t('metrics.noDate')}</p>
                    <p>${this.t('metrics.prompt')}</p>
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
                (log.oxygenation && this.metricsFilter.oxygenation) ||
                (log.sleep && this.metricsFilter.sleep) ||
                (log.notes && this.metricsFilter.notes);
            return hasVisibleMetric;
        });

        if (visibleLogs.length === 0) {
            container.innerHTML = `
                <div class="empty-log">
                    <p>${this.t('metrics.noMatch')}</p>
                    <p>${this.t('metrics.noMatchHint')}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = visibleLogs.map(log => this.renderLogCard(log)).join('');
    }

    renderLogCard(log) {
        const locale = this.language;
        const date = new Date(log.datetime);
        const dateStr = date.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        const timeStr = date.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit'
        });

        const metrics = [];
        // Only add metrics that are enabled in the filter
        if (log.temperature && this.metricsFilter.temperature) {
            metrics.push({ label: this.t('logModal.temperature'), value: log.temperature, unit: '' });
        }
        if (log.bpSystolic && log.bpDiastolic && this.metricsFilter.bloodPressure) {
            metrics.push({ label: this.t('logModal.bloodPressure'), value: `${log.bpSystolic}/${log.bpDiastolic}`, unit: 'mmHg' });
        }
        if (log.heartRate && this.metricsFilter.heartRate) {
            metrics.push({ label: this.t('logModal.heartRate'), value: log.heartRate, unit: 'bpm' });
        }
        if (log.glucose && this.metricsFilter.glucose) {
            metrics.push({ label: this.t('logModal.bloodGlucose'), value: log.glucose, unit: 'mg/dL' });
        }
        if (log.weight && this.metricsFilter.weight) {
            metrics.push({ label: this.t('logModal.weight'), value: log.weight, unit: 'lbs' });
        }
        if (log.steps && this.metricsFilter.steps) {
            metrics.push({ label: this.t('logModal.steps'), value: log.steps.toLocaleString(), unit: '' });
        }
        if (log.oxygenation && this.metricsFilter.oxygenation) {
            metrics.push({ label: this.t('logModal.oxygenation'), value: log.oxygenation, unit: '%' });
        }
        if (log.sleep && this.metricsFilter.sleep) {
            metrics.push({ label: this.t('logModal.sleep'), value: log.sleep, unit: 'hrs' });
        }

        const slotLabel = log.slotNote
            ? `<span class="slot-note-badge">${this.t('timeOfDay.' + log.slotNote)}</span>`
            : '';

        return `
            <div class="log-card${log.slotNote ? ' log-card-slot-note' : ''}">
                <div class="log-card-header">
                    <div class="log-datetime">${dateStr} at ${timeStr}${slotLabel}</div>
                    <div class="log-actions">
                        <button class="log-edit-button" onclick="tracker.editLog('${log.id}')">${this.t('metrics.edit')}</button>
                        <button class="log-delete-button" onclick="tracker.deleteLog('${log.id}')">${this.t('metrics.delete')}</button>
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
                ${log.notes && (this.metricsFilter.notes || log.slotNote) ? `
                    <div class="log-notes-section">
                        <div class="log-notes-label">${this.t('metrics.notes')}</div>
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
            document.getElementById('logModalTitle').textContent = this.t('logModal.editTitle');
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
            if (this.isMetricEnabled('oxygenation')) {
                this.setLogMetric('enableOxygenation', 'logOxygenation', log.oxygenation);
            }
            if (this.isMetricEnabled('sleep')) {
                this.setLogMetric('enableSleep', 'logSleep', log.sleep);
            }
            // Notes are always available
            this.setLogMetric('enableNotes', 'logNotes', log.notes);

            this.editingLogId = log.id;
        } else {
            document.getElementById('logModalTitle').textContent = this.t('logModal.addTitle');
            form.reset();

            // Uncheck all checkboxes
            ['enableTemperature', 'enableBloodPressure', 'enableHeartRate', 'enableGlucose', 'enableWeight', 'enableSteps', 'enableOxygenation', 'enableSleep', 'enableNotes'].forEach(id => {
                const checkbox = document.getElementById(id);
                if (checkbox) checkbox.checked = false;
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
                document.getElementById(id).value = hasValue && value[index] ? value[index] : '';
            });
        } else {
            document.getElementById(inputId).value = hasValue ? value : '';
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
        const oxygenation = document.getElementById('enableOxygenation').checked
            ? parseFloat(document.getElementById('logOxygenation').value) || null
            : null;
        const sleep = document.getElementById('enableSleep').checked
            ? parseFloat(document.getElementById('logSleep').value) || null
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
            document.getElementById('enableOxygenation').checked ||
            document.getElementById('enableSleep').checked ||
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
                    oxygenation,
                    sleep,
                    notes
                };

                // Broadcast update to connected peers
                if (this.p2pSync) {
                    this.p2pSync.broadcastChange('LOG_UPDATED', this.logs[index]);
                }
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
                oxygenation,
                sleep,
                notes
            };
            this.logs.push(log);

            // Broadcast addition to connected peers
            if (this.p2pSync) {
                this.p2pSync.broadcastChange('LOG_ADDED', log);
            }
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
        if (confirm(this.t('alerts.deleteLog'))) {
            this.logs = this.logs.filter(l => l.id !== id);
            this.saveLogs();
            this.renderLogs();

            // Broadcast deletion to connected peers
            if (this.p2pSync) {
                this.p2pSync.broadcastChange('LOG_DELETED', { id });
            }
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
        document.getElementById('weeklyViewPrintButton').addEventListener('click', () => {
            document.body.classList.add('printing-weekly');

            // Use afterprint event to remove class after print dialog closes
            const handleAfterPrint = () => {
                document.body.classList.remove('printing-weekly');
                window.removeEventListener('afterprint', handleAfterPrint);
            };
            window.addEventListener('afterprint', handleAfterPrint);

            window.print();
        });
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
        // Get profile data which contains dailyLogs and asNeededLogs
        const profileData = this.loadProfileData() || {};

        const data = {
            // Include profile info for import on new devices
            profile: {
                name: this.currentProfile?.name || 'Imported Profile',
                createdAt: this.currentProfile?.createdAt || new Date().toISOString()
            },
            medications: this.medications,
            dailyLogs: profileData.dailyLogs || {},
            asNeededLogs: profileData.asNeededLogs || [],
            appointments: this.appointments,
            logs: this.logs,
            metricPreferences: JSON.parse(localStorage.getItem('metricPreferences') || '{}'),
            trackAppointments: localStorage.getItem('trackAppointments') === 'true',
            trackMetrics: localStorage.getItem('trackMetrics') === 'true',
            exportDate: new Date().toISOString(),
            version: '1.2.8'
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

        alert(this.t('alerts.exportSuccess'));
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
                const confirmed = confirm(this.t('alerts.importOverwrite'));

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
                alert(this.t('alerts.importSuccess'));
                location.reload();
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }

            // Reset the file input
            document.getElementById('importFileInput').value = '';
        };

        reader.readAsText(file);
    }

    // Import data from backup file and create profile (for first-time setup)
    importDataWithProfile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // Validate data structure
                if (!data.medications && !data.dailyLogs) {
                    throw new Error('Invalid backup file format');
                }

                // Get profile name from backup or prompt user
                let profileName = data.profile?.name || 'Imported Profile';
                const customName = prompt(`Enter a name for this profile:`, profileName);
                if (customName === null) {
                    // User cancelled
                    return;
                }
                profileName = customName.trim() || profileName;

                // Create new profile
                const profile = {
                    id: Date.now().toString(),
                    name: profileName,
                    createdAt: data.profile?.createdAt || new Date().toISOString()
                };

                // Save the profile
                this.profiles.push(profile);
                this.saveProfiles();

                // Save data with the new profile's ID
                const profileDataKey = `profileData_${profile.id}`;
                const profileData = {
                    medications: data.medications || [],
                    appointments: data.appointments || [],
                    logs: data.logs || [],
                    dailyLogs: data.dailyLogs || {},
                    asNeededLogs: data.asNeededLogs || []
                };
                localStorage.setItem(profileDataKey, JSON.stringify(profileData));

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

                // Set as active profile
                this.setActiveProfile(profile.id);

                // Reload the page
                alert(`Profile "${profileName}" created with imported data! The page will now reload.`);
                location.reload();
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        };

        reader.readAsText(file);
    }

    // Clear all data with confirmation
    clearAllData() {
        const confirmed = confirm(this.t('alerts.clearConfirmMsg'));

        if (!confirmed) return;

        const deleteWord = this.t('alerts.clearConfirmWord');
        const secondConfirm = prompt(this.t('alerts.clearConfirmPrompt'));
        if (secondConfirm !== deleteWord) {
            alert(this.t('alerts.deletionCancelled'));
            return;
        }

        // Clear all localStorage
        localStorage.removeItem('medications');
        localStorage.removeItem('dailyLogs');
        localStorage.removeItem('asNeededLogs');
        localStorage.removeItem('appointments');
        localStorage.removeItem('logs');
        localStorage.removeItem('trackingPreferences');

        alert(this.t('alerts.dataCleared'));
        location.reload();
    }

    // Update tracking preferences
    // Save time of day setting
    saveTimeOfDaySetting(timeOfDay, timeValue) {
        const timeSettings = JSON.parse(localStorage.getItem('timeOfDaySettings') || '{}');
        if (timeValue) {
            timeSettings[timeOfDay.toLowerCase()] = timeValue;
        } else {
            delete timeSettings[timeOfDay.toLowerCase()];
        }
        localStorage.setItem('timeOfDaySettings', JSON.stringify(timeSettings));
    }

    // Load time of day settings
    loadTimeOfDaySettings() {
        const timeSettings = JSON.parse(localStorage.getItem('timeOfDaySettings') || '{}');
        ['Morning', 'Afternoon', 'Evening', 'Bedtime'].forEach(timeOfDay => {
            const input = document.getElementById(`time${timeOfDay}`);
            if (input) {
                input.value = timeSettings[timeOfDay.toLowerCase()] || '';
            }
        });
    }

    updateTrackingPreferences(type, enabled) {
        const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": false, "metrics": true}');
        prefs[type] = enabled;
        localStorage.setItem('trackingPreferences', JSON.stringify(prefs));

        // Update UI visibility
        this.applyTrackingPreferences();
    }

    // Apply tracking preferences to UI
    applyTrackingPreferences() {
        const prefs = JSON.parse(localStorage.getItem('trackingPreferences') || '{"appointments": false, "metrics": true}');

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
        const prefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true, "oxygenation": true, "sleep": true}');
        prefs[metric] = enabled;
        localStorage.setItem('metricPreferences', JSON.stringify(prefs));
    }

    // Check if a metric is enabled
    isMetricEnabled(metric) {
        const prefs = JSON.parse(localStorage.getItem('metricPreferences') || '{"weight": true, "temperature": true, "bloodpressure": true, "heartrate": true, "bloodsugar": true, "steps": true, "oxygenation": true, "sleep": true}');
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
            'steps': 'enableSteps',
            'oxygenation': 'enableOxygenation',
            'sleep': 'enableSleep'
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
            { key: 'temperature', filterId: 'filterTemperature', tKey: 'settings.temperature' },
            { key: 'bloodpressure', filterId: 'filterBloodPressure', tKey: 'settings.bloodPressure' },
            { key: 'heartrate', filterId: 'filterHeartRate', tKey: 'settings.heartRate' },
            { key: 'bloodsugar', filterId: 'filterGlucose', tKey: 'settings.bloodSugar' },
            { key: 'weight', filterId: 'filterWeight', tKey: 'settings.weight' },
            { key: 'steps', filterId: 'filterSteps', tKey: 'settings.steps' },
            { key: 'oxygenation', filterId: 'filterOxygenation', tKey: 'settings.oxygenation' },
            { key: 'sleep', filterId: 'filterSleep', tKey: 'settings.sleep' }
        ];

        let html = `<div style="margin-bottom: 10px; font-weight: bold; color: #333;">${this.t('metrics.showMetrics')}</div>`;
        html += `
            <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px; font-weight: 600;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                <input type="checkbox" id="filterAll" checked style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 1.1rem;">${this.t('metrics.all')}</span>
            </label>
            <div style="height: 1px; background: #ddd; margin: 8px 0;"></div>
        `;

        // Add only enabled metrics
        metricOptions.forEach(metric => {
            if (this.isMetricEnabled(metric.key)) {
                html += `
                    <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                        <input type="checkbox" id="${metric.filterId}" checked style="width: 18px; height: 18px; cursor: pointer;">
                        <span style="font-size: 1.1rem;">${this.t(metric.tKey)}</span>
                    </label>
                `;
            }
        });

        // Always show Notes filter
        html += `
            <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 6px;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                <input type="checkbox" id="filterNotes" checked style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 1.1rem;">${this.t('metrics.notes')}</span>
            </label>
        `;

        return html;
    }

    openPrintModal() {
        const modal = document.getElementById('metricsPrintModal');
        const printContent = document.getElementById('printPreviewContent');

        // Get filtered logs in date range
        const fromDateStr = this.getDateString(this.metricsDateFrom);
        const toDateStr = this.getDateString(this.metricsDateTo);
        const filteredLogs = this.logs.filter(log => {
            const logDate = log.datetime.split('T')[0]; // Get YYYY-MM-DD part
            return logDate >= fromDateStr && logDate <= toDateStr;
        });

        // Sort by datetime (oldest first for printing)
        filteredLogs.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        // Generate print content
        let html = '<div class="print-header">';
        html += `<h3>${this.t('metrics.reportTitle')}</h3>`;
        html += `<div class="print-date-range">`;
        html += `${this.metricsDateFrom.toLocaleDateString(this.language, { month: 'short', day: 'numeric', year: 'numeric' })} to ${this.metricsDateTo.toLocaleDateString(this.language, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        html += `</div>`;
        html += '</div>';

        if (filteredLogs.length === 0) {
            html += `<p style="text-align: center; color: #666; padding: 40px;">${this.t('metrics.noDataRange')}</p>`;
        } else {
            filteredLogs.forEach(log => {
                const logDate = new Date(log.datetime);
                const dateStr = logDate.toLocaleDateString(this.language, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = logDate.toLocaleTimeString(this.language, { hour: 'numeric', minute: '2-digit' });

                // Build metrics line
                const metrics = [];

                if (this.metricsFilter.temperature && log.temperature) {
                    metrics.push(`Temp: ${log.temperature}°F`);
                }

                if (this.metricsFilter.bloodPressure && (log.systolic || log.diastolic)) {
                    metrics.push(`BP: ${log.systolic || '-'}/${log.diastolic || '-'}`);
                }

                if (this.metricsFilter.heartRate && log.heartRate) {
                    metrics.push(`HR: ${log.heartRate} bpm`);
                }

                if (this.metricsFilter.glucose && log.glucose) {
                    metrics.push(`Glucose: ${log.glucose} mg/dL`);
                }

                if (this.metricsFilter.weight && log.weight) {
                    metrics.push(`Weight: ${log.weight} lbs`);
                }

                if (this.metricsFilter.steps && log.steps) {
                    metrics.push(`Steps: ${log.steps.toLocaleString()}`);
                }

                if (this.metricsFilter.oxygenation && log.oxygenation) {
                    metrics.push(`Oxygenation: ${log.oxygenation}%`);
                }

                if (this.metricsFilter.sleep && log.sleep) {
                    metrics.push(`Sleep: ${log.sleep} hrs`);
                }

                // Show entry if there are metrics OR if there are notes (even with no metrics)
                if (metrics.length > 0 || log.notes) {
                    html += '<div class="print-entry-compact">';
                    html += `<span class="print-entry-date-compact">${dateStr} ${timeStr}:</span> `;

                    if (metrics.length > 0) {
                        html += `<span class="print-metrics-line">${metrics.join(' • ')}</span>`;
                    }

                    if (log.notes) {
                        if (metrics.length === 0) {
                            // If only notes, put them on the same line
                            html += `<span class="print-metrics-line">Notes: ${log.notes}</span>`;
                        } else {
                            // If there are metrics, put notes on a separate line
                            html += `<div class="print-notes-compact">Notes: ${log.notes}</div>`;
                        }
                    }

                    html += '</div>';
                }
            });
        }

        printContent.innerHTML = html;
        modal.classList.add('active');
    }

    closePrintModal() {
        const modal = document.getElementById('metricsPrintModal');
        modal.classList.remove('active');
    }

    printMetrics() {
        window.print();
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day; // Adjust to Sunday
        return new Date(d.setDate(diff));
    }

    changeWeek(direction) {
        // Use time-based calculation to avoid month boundary issues
        const currentTime = this.currentWeekStart.getTime();
        const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
        this.currentWeekStart = new Date(currentTime + (direction * oneWeekInMs));
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
            const dayName = date.toLocaleDateString(this.language, { weekday: 'short' });
            const monthDay = date.toLocaleDateString(this.language, { month: 'numeric', day: 'numeric' });
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
                html += `<div class="weekly-time-header-full">${this.t('timeOfDay.' + time.toLowerCase())}</div>`;
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
            // Get the daily log for this date to check taken status
            const dateStr = this.getDateString(date);
            const dayLog = this.loadDailyLog(dateStr);
            const takenIds = dayLog.taken || [];

            medsForTime.forEach(med => {
                // Check if this medication was taken on this day
                const isTaken = takenIds.includes(med.displayId);
                const checkedAttr = isTaken ? 'checked' : '';

                html += `
                    <div class="weekly-med-item ${isTaken ? 'taken' : ''}">
                        <input type="checkbox" class="weekly-checkbox" ${checkedAttr} disabled>
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

    // Alarm System Methods
    saveAlarmSetting(key, value) {
        const alarmSettings = JSON.parse(localStorage.getItem('alarmSettings') || '{"enabled": false}');
        alarmSettings[key] = value;
        localStorage.setItem('alarmSettings', JSON.stringify(alarmSettings));
    }

    saveAlarmSound(timeOfDay, soundFile) {
        const alarmSounds = JSON.parse(localStorage.getItem('alarmSounds') || '{}');
        alarmSounds[timeOfDay] = soundFile;
        localStorage.setItem('alarmSounds', JSON.stringify(alarmSounds));
    }

    loadAlarmSettings() {
        const settings = JSON.parse(localStorage.getItem('alarmSettings') || '{"enabled": false}');
        const sounds = JSON.parse(localStorage.getItem('alarmSounds') || '{"morning": "none", "afternoon": "none", "evening": "none", "bedtime": "none"}');

        const enableCheckbox = document.getElementById('enableAlarms');
        if (enableCheckbox) {
            enableCheckbox.checked = settings.enabled;
            this.toggleAlarmSettings(settings.enabled);
        }

        // Load sound for each time of day
        ['morning', 'afternoon', 'evening', 'bedtime'].forEach(timeOfDay => {
            const soundSelect = document.getElementById(`alarmSound${timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1)}`);
            if (soundSelect) {
                soundSelect.value = sounds[timeOfDay] || 'none';
            }
            // Update test button state for each time of day
            this.updateTestButtonState(timeOfDay);
        });

        return settings;
    }

    updateTestButtonState(timeOfDay) {
        // Find the test button for this time of day (support both class names)
        const testButton = document.querySelector(`.test-alarm-button[data-time="${timeOfDay}"], .test-alarm-compact[data-time="${timeOfDay}"]`);
        if (!testButton) return;

        // Get the alarm sound select
        const capitalizedTime = timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1);
        const alarmSelect = document.getElementById(`alarmSound${capitalizedTime}`);

        if (alarmSelect && alarmSelect.value === 'none') {
            // Disable the test button if no alarm is selected
            testButton.disabled = true;
            testButton.style.opacity = '0.5';
            testButton.style.cursor = 'not-allowed';
        } else {
            // Enable the test button
            testButton.disabled = false;
            testButton.style.opacity = '1';
            testButton.style.cursor = 'pointer';
        }
    }

    toggleAlarmSettings(show) {
        // Show/hide alarm dropdown for each time of day
        ['Morning', 'Afternoon', 'Evening', 'Bedtime'].forEach(timeOfDay => {
            const alarmDiv = document.getElementById(`alarm${timeOfDay}Settings`);
            if (alarmDiv) {
                alarmDiv.style.display = show ? 'flex' : 'none';
            }
        });

        // Show/hide test buttons (support both class names)
        document.querySelectorAll('.test-alarm-button, .test-alarm-compact').forEach(button => {
            button.style.display = show ? 'flex' : 'none';
        });
    }

    testAlarmSound(timeOfDay) {
        const sounds = JSON.parse(localStorage.getItem('alarmSounds') || '{"morning": "none", "afternoon": "none", "evening": "none", "bedtime": "none"}');
        const soundFile = sounds[timeOfDay] || 'none';
        if (soundFile !== 'none') {
            // For testing, don't show the modal, just play the sound once without looping
            const testAudio = new Audio(`sounds/${soundFile}`);
            testAudio.play().catch(err => {
                console.log('Could not play test sound:', err);
            });
        }
    }

    playAlarm(soundFile, timeOfDay) {
        // Stop any currently playing alarm
        if (this.alarmAudio) {
            this.alarmAudio.pause();
            this.alarmAudio.currentTime = 0;
        }

        // Create and play new alarm with looping
        this.alarmAudio = new Audio(`sounds/${soundFile}`);
        this.alarmAudio.loop = true; // Loop the alarm until stopped
        this.alarmAudio.play().catch(err => {
            console.log('Could not play alarm:', err);
            // Fallback: try to show notification if sound fails
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(this.t('alarmModal.notificationTitle'), {
                    body: this.t('alarmModal.title'),
                    icon: 'favicon.png'
                });
            }
        });

        // Show the medication reminder modal
        this.showAlarmModal(timeOfDay);
    }

    stopAlarm() {
        if (this.alarmAudio) {
            this.alarmAudio.pause();
            this.alarmAudio.currentTime = 0;
            this.alarmAudio = null;
        }
    }

    showAlarmModal(timeOfDay) {
        const modal = document.getElementById('alarmReminderModal');
        const timeLabel = modal.querySelector('.alarm-time-label');

        const displayTime = this.t('timeOfDay.' + timeOfDay);
        timeLabel.textContent = this.t('alarmModal.timeLabel', {time: displayTime});

        modal.classList.add('active');
    }

    acknowledgeAlarm() {
        // Stop the alarm sound
        this.stopAlarm();

        // Close the modal
        const modal = document.getElementById('alarmReminderModal');
        modal.classList.remove('active');
    }

    initializeAlarmSystem() {
        const settings = JSON.parse(localStorage.getItem('alarmSettings') || '{"enabled": false, "sound": "alarm_01.mp3"}');

        if (!settings.enabled) {
            return;
        }

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Clear any existing interval
        if (this.alarmCheckInterval) {
            clearInterval(this.alarmCheckInterval);
        }

        // Check for alarms every 30 seconds; also re-apply auto theme if active
        this.alarmCheckInterval = setInterval(() => {
            this.checkForAlarms();
            if (this.theme === 'auto') {
                document.documentElement.dataset.theme = this.getAutoTheme();
            }
        }, 30000);

        // Also check immediately
        this.checkForAlarms();
    }

    stopAlarmSystem() {
        if (this.alarmCheckInterval) {
            clearInterval(this.alarmCheckInterval);
            this.alarmCheckInterval = null;
        }

        if (this.alarmAudio) {
            this.alarmAudio.pause();
            this.alarmAudio = null;
        }
    }

    checkForAlarms() {
        const settings = JSON.parse(localStorage.getItem('alarmSettings') || '{"enabled": false}');
        const timeSettings = JSON.parse(localStorage.getItem('timeOfDaySettings') || '{}');
        const alarmSounds = JSON.parse(localStorage.getItem('alarmSounds') || '{"morning": "none", "afternoon": "none", "evening": "none", "bedtime": "none"}');

        if (!settings.enabled) {
            return;
        }

        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // Don't trigger same alarm twice within 5 minutes
        if (this.lastAlarmTime && (now - this.lastAlarmTime) < 5 * 60 * 1000) {
            return;
        }

        // Check each time of day
        const timesOfDay = ['morning', 'afternoon', 'evening', 'bedtime'];
        for (const timeOfDay of timesOfDay) {
            const setTime = timeSettings[timeOfDay];
            if (setTime && setTime === currentTime) {
                // Check if there are medications scheduled for this time
                const hasMeds = this.hasMedicationsAtTime(timeOfDay);
                if (hasMeds) {
                    // Use the sound specific to this time of day
                    const soundFile = alarmSounds[timeOfDay] || 'none';

                    // Only play alarm if not set to 'none'
                    if (soundFile !== 'none') {
                        this.playAlarm(soundFile, timeOfDay);
                    } else {
                        // If no sound, still show the modal
                        this.showAlarmModal(timeOfDay);
                    }

                    this.lastAlarmTime = now;

                    // Show notification
                    if ('Notification' in window && Notification.permission === 'granted') {
                        const timeLabel = this.t('timeOfDay.' + timeOfDay);
                        new Notification(this.t('alarmModal.notificationTitle'), {
                            body: this.t('alarmModal.notificationBody', {time: timeLabel}),
                            icon: 'favicon.png',
                            requireInteraction: true
                        });
                    }
                    break;
                }
            }
        }
    }

    hasMedicationsAtTime(timeOfDay) {
        const today = this.getDateString(new Date());
        const dailyLog = this.loadDailyLog(today);
        const expanded = this.expandMedications();

        // Capitalize first letter to match time format
        const timeLabel = timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1);

        // Check if there are any medications for this time today
        const medsAtTime = expanded.filter(med => {
            if (med.time !== timeLabel) return false;
            return this.isMedicationActiveToday(med);
        });

        return medsAtTime.length > 0;
    }

    // ── i18n ──────────────────────────────────────────────────────────────────
    t(key, vars = {}) {
        const lang = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS[this.language])
            ? TRANSLATIONS[this.language]
            : null;
        const fallback = (typeof TRANSLATIONS !== 'undefined' && TRANSLATIONS['en']) || {};
        // dot-notation lookup: 'timeOfDay.morning' → obj.timeOfDay.morning
        const resolve = (obj, k) => k.split('.').reduce((o, p) => o?.[p], obj);
        let str = resolve(lang, key) ?? resolve(fallback, key) ?? key;
        Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{{${k}}}`, v); });
        return str;
    }

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const val = this.t(el.getAttribute('data-i18n'));
            if (val) el.textContent = val;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.getAttribute('data-i18n-title'));
        });
    }

    setLanguage(lang) {
        this.language = lang;
        localStorage.setItem('language', lang);
        document.documentElement.lang = lang;
        document.documentElement.dir = ['ar', 'fa', 'ur'].includes(lang) ? 'rtl' : 'ltr';
        this.applyTranslations();
        this.updateHeader(this.currentTab);
        this.renderMedications();
        this.renderAppointments();
        this.renderLogs();
    }

    getAutoTheme() {
        const h = new Date().getHours();
        return (h >= 6 && h < 20) ? 'clean' : 'dark';
    }

    setTheme(theme) {
        this.theme = theme;
        localStorage.setItem('theme', theme);
        document.documentElement.dataset.theme = theme === 'auto' ? this.getAutoTheme() : theme;
        this.updateThemeSelector();
    }

    updateThemeSelector() {
        document.querySelectorAll('.theme-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === this.theme);
        });
    }

    // Version Check Methods
    startVersionCheck() {
        // Get current version from meta tag
        const metaVersion = document.querySelector('meta[name="app-version"]');
        if (metaVersion) {
            this.currentVersion = metaVersion.getAttribute('content');
        }

        // Check for updates every 5 minutes
        setInterval(() => {
            this.checkForUpdate();
        }, 5 * 60 * 1000);

        // Also check when page becomes visible (user returns to app)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkForUpdate();
            }
        });
    }

    async checkForUpdate() {
        try {
            // Fetch index.html with cache-busting parameter
            const response = await fetch(`/index.html?t=${Date.now()}`, {
                cache: 'no-cache'
            });

            if (!response.ok) return;

            const html = await response.text();

            // Parse the HTML to get the version meta tag
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const versionMeta = doc.querySelector('meta[name="app-version"]');

            if (versionMeta) {
                const serverVersion = versionMeta.getAttribute('content');

                // If versions don't match, prompt user to reload
                if (serverVersion !== this.currentVersion) {
                    this.promptUpdate(serverVersion);
                }
            }
        } catch (err) {
            // Silently fail - don't disrupt user experience
            console.log('Version check failed:', err);
        }
    }

    promptUpdate(newVersion) {
        // Check if we've already shown this update prompt
        const lastPromptVersion = localStorage.getItem('lastUpdatePromptVersion');
        if (lastPromptVersion === newVersion) {
            return; // Don't spam the user
        }

        // Remove any existing update banner
        const existingBanner = document.getElementById('updateBanner');
        if (existingBanner) {
            existingBanner.remove();
        }

        // Show update notification
        const updateBanner = document.createElement('div');
        updateBanner.id = 'updateBanner';
        updateBanner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #6b7c93;
            color: white;
            padding: 15px;
            text-align: center;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;

        const messageDiv = document.createElement('div');
        messageDiv.style.marginBottom = '10px';
        messageDiv.innerHTML = `
            <strong>${this.t('updateBanner.title')}</strong><br>
            ${this.t('updateBanner.message', {version: newVersion})}
        `;

        const updateNowBtn = document.createElement('button');
        updateNowBtn.textContent = this.t('updateBanner.updateNow');
        updateNowBtn.style.cssText = `
            background: white;
            color: #6b7c93;
            border: none;
            padding: 8px 20px;
            border-radius: 5px;
            font-weight: 600;
            cursor: pointer;
            margin-right: 10px;
        `;
        updateNowBtn.addEventListener('click', () => {
            localStorage.setItem('lastUpdatePromptVersion', newVersion);
            window.location.reload(true);
        });

        const updateLaterBtn = document.createElement('button');
        updateLaterBtn.textContent = this.t('updateBanner.later');
        updateLaterBtn.style.cssText = `
            background: transparent;
            color: white;
            border: 2px solid white;
            padding: 8px 20px;
            border-radius: 5px;
            font-weight: 600;
            cursor: pointer;
        `;
        updateLaterBtn.addEventListener('click', () => {
            localStorage.setItem('lastUpdatePromptVersion', newVersion);
            updateBanner.remove();
        });

        updateBanner.appendChild(messageDiv);
        updateBanner.appendChild(updateNowBtn);
        updateBanner.appendChild(updateLaterBtn);

        document.body.appendChild(updateBanner);
    }

    checkMorningMissedMeds() {
        // Show at most once per app session
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = this.getDateString(yesterday);

        // Expand yesterday's meds and find which are active + critical
        const savedDate = this.selectedDate;
        this.selectedDate = yesterday;
        const expanded = this.expandMedications(yesterday);
        const activeCritical = expanded.filter(med => this.isMedicationActiveToday(med) && med.critical !== false);
        this.selectedDate = savedDate;

        if (activeCritical.length === 0) return;

        // Find the last time slot that had critical meds scheduled
        const timeOrder = ['Morning', 'Afternoon', 'Evening', 'Bedtime'];
        const slotsWithCritical = timeOrder.filter(slot => activeCritical.some(med => med.time === slot));
        if (slotsWithCritical.length === 0) return;
        const lastSlot = slotsWithCritical[slotsWithCritical.length - 1];

        // Check if any critical meds in that last slot were not taken and not already skipped
        const yesterdayLog = this.loadDailyLog(yesterdayStr);
        const takenYesterday = yesterdayLog.taken || [];
        const skippedYesterday = yesterdayLog.skipped || [];
        const missed = activeCritical.filter(med => {
            const displayId = med.displayId || med.id;
            return med.time === lastSlot && !takenYesterday.includes(displayId) && !skippedYesterday.includes(displayId);
        });

        if (missed.length === 0) return;

        this._morningCheckDateStr = yesterdayStr;

        const translatedSlot = this.t('timeOfDay.' + lastSlot.toLowerCase());
        document.getElementById('morningCheckSubtext').innerHTML = this.t('morningCheck.message', {slot: `<strong>${translatedSlot}</strong>`});
        const list = document.getElementById('morningCheckList');
        list.innerHTML = missed.map(med => {
            const displayId = med.displayId || med.id;
            return `
            <div class="morning-check-item" id="mci-${displayId}">
                <div class="morning-check-med-info">
                    <span class="morning-check-med-name">${med.name}</span>
                    <span class="morning-check-med-detail">${med.dosage}</span>
                </div>
                <button type="button" class="mark-missed-btn" onclick="tracker.skipMedFromMorningCheck('${displayId}', '${yesterdayStr}')">${this.t('meds.missed')}</button>
            </div>`;
        }).join('');

        const modal = document.getElementById('morningCheckModal');
        modal.style.display = '';
        modal.classList.add('active');
    }

    skipMedFromMorningCheck(displayId, dateStr) {
        this.skipMed(displayId, dateStr);
        const item = document.getElementById(`mci-${displayId}`);
        if (item) item.style.display = 'none';
        // Dismiss modal if all items are now hidden
        const list = document.getElementById('morningCheckList');
        const remaining = list ? list.querySelectorAll('.morning-check-item:not([style*="none"])') : [];
        if (remaining.length === 0) this.dismissMorningCheck();
    }

    dismissMorningCheck() {
        const modal = document.getElementById('morningCheckModal');
        modal.style.display = 'none';
        modal.classList.remove('active');
        this._morningCheckDateStr = null;
    }

    viewYesterdayMeds() {
        const yesterdayStr = this._morningCheckDateStr;
        this.dismissMorningCheck();
        if (!yesterdayStr) return;
        this.selectedDate = new Date(yesterdayStr + 'T00:00:00');
        this.dailyLog = this.loadDailyLog(yesterdayStr);
        this.asNeededLogs = this.loadAsNeededLogs(yesterdayStr);
        this.switchTab('medications');
        this.renderMedications();
    }
}

// Initialize the app
const tracker = new HealthTracker();

// Check for new day every minute
setInterval(() => {
    tracker.checkNewDay();
}, 60000);
