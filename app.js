/* ==========================================================================
   TIMECOP CORE APPLICATION ENGINE
   Continuous Punch Chain Controller, SVG Analytics, and Drag-and-Drop
   ========================================================================== */

// --- Audio Effects Module (Web Audio API Synthesizer) ---
let soundEnabled = true;
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.05);
    } else if (type === 'switch') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(550, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === 'repair') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08); // E5
      gain.gain.setValueAtTime(0.025, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch (e) {
    console.warn("Audio Context playback failed or blocked: ", e);
  }
}

// --- App State & Data Structures ---
let state = {
  version: '1.2.0',
  projects: [],
  punches: [],
  activePunchId: null,
  selectedDay: new Date(), // For the punch editor
  showArchived: false,
  googleClientId: localStorage.getItem('tc_gdrive_client_id') || '',
  googleAccessToken: localStorage.getItem('tc_gdrive_token') || '',
  googleTokenExpiry: parseInt(localStorage.getItem('tc_gdrive_token_expiry') || '0', 10),
  googleUserEmail: localStorage.getItem('tc_gdrive_user_email') || '',
  syncStatus: 'disabled', // 'disabled' | 'idle' | 'syncing' | 'connected' | 'error'
  lastUpdated: parseInt(localStorage.getItem('tc_last_updated') || '0', 10),
};

// Default Project Definitions
const DEFAULT_PROJECTS = [
  { id: 'idle', name: 'Idle', category: 'System', gradient: 'gradient-idle', order: 0 },
  { id: 'proj-1', name: 'Coding Refactor', category: 'Development', gradient: 'gradient-cyan-blue', order: 1 },
  { id: 'proj-2', name: 'Product UI Design', category: 'Design', gradient: 'gradient-pink-rose', order: 2 },
  { id: 'proj-3', name: 'Daily Standup & Sync', category: 'Meeting', gradient: 'gradient-amber-orange', order: 3 },
  { id: 'proj-4', name: 'Server Diagnostics', category: 'Operations', gradient: 'gradient-forest-mint', order: 4 }
];

// --- Database & Storage Manager ---
const DB = {
  load() {
    const raw = localStorage.getItem('timecop_db');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state.projects = parsed.projects || [];
        state.punches = parsed.punches || [];
        state.activePunchId = parsed.activePunchId || null;
      } catch (e) {
        console.error("Local Storage database corrupt, loading defaults", e);
        this.loadDefaults();
      }
    } else {
      this.loadDefaults();
    }
    
    // Safety check: ensure Idle project exists and is first
    if (!state.projects.find(p => p.id === 'idle')) {
      state.projects.unshift(DEFAULT_PROJECTS[0]);
    }
    
    // Ensure chronological sorting
    state.punches.sort((a, b) => a.startTime - b.startTime);
    
    // Safety check: ensure there is always an active punch running in the system
    this.ensureActivePunch();
    this.save(false);
  },
  
  save(updateTimestamp = true) {
    if (updateTimestamp) {
      state.lastUpdated = Date.now();
      localStorage.setItem('tc_last_updated', state.lastUpdated);
    }
    localStorage.setItem('timecop_db', JSON.stringify({
      projects: state.projects,
      punches: state.punches,
      activePunchId: state.activePunchId
    }));
    if (typeof GDriveSync !== 'undefined') {
      GDriveSync.triggerAutoSync();
    }
  },
  
  loadDefaults() {
    state.projects = [...DEFAULT_PROJECTS];
    state.punches = [];
    state.activePunchId = null;
    this.generateSampleData();
  },
  
  ensureActivePunch() {
    // Look for a punch with no endTime
    let active = state.punches.find(p => p.endTime === null);
    if (!active) {
      // Create a brand new active punch on Idle
      const now = Date.now();
      const punchId = 'punch-' + now;
      state.punches.push({
        id: punchId,
        projectId: 'idle',
        startTime: now,
        endTime: null
      });
      state.activePunchId = punchId;
    } else {
      state.activePunchId = active.id;
    }
  },
  
  generateSampleData() {
    // Generates a fully continuous punch history for yesterday and today
    const now = new Date();
    
    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(9, 0, 0, 0);
    let current = yesterday.getTime();
    
    const sampleTimelineYesterday = [
      { proj: 'proj-1', duration: 1.5 * 3600000 },  // Coding
      { proj: 'idle', duration: 0.75 * 3600000 },   // Idle
      { proj: 'proj-2', duration: 1.25 * 3600000 },  // Design
      { proj: 'idle', duration: 1.0 * 3600000 },    // Idle
      { proj: 'proj-1', duration: 1.75 * 3600000 },  // Coding
      { proj: 'proj-3', duration: 1.0 * 3600000 },   // Standup
      { proj: 'idle', duration: 1.0 * 3600000 }     // Idle
    ];
    
    sampleTimelineYesterday.forEach(item => {
      state.punches.push({
        id: 'punch-' + Math.random().toString(36).substr(2, 9),
        projectId: item.proj,
        startTime: current,
        endTime: current + item.duration
      });
      current += item.duration;
    });
    
    // Today
    const today = new Date(now);
    today.setHours(9, 0, 0, 0);
    current = today.getTime();
    const timeLimit = now.getTime() - 1.2 * 3600000; // Let's stop sample data 1.2 hours ago
    
    const sampleTimelineToday = [
      { proj: 'proj-1', duration: 2.0 * 3600000 },  // Coding
      { proj: 'proj-2', duration: 1.0 * 3600000 },  // Design
      { proj: 'idle', duration: 0.75 * 3600000 },   // Idle
      { proj: 'proj-4', duration: 1.5 * 3600000 },  // Server
      { proj: 'proj-3', duration: 0.5 * 3600000 }   // Standup
    ];
    
    sampleTimelineToday.forEach(item => {
      if (current + item.duration < timeLimit) {
        state.punches.push({
          id: 'punch-' + Math.random().toString(36).substr(2, 9),
          projectId: item.proj,
          startTime: current,
          endTime: current + item.duration
        });
        current += item.duration;
      }
    });
    
    // Create the final active punch stretching to present
    const finalPunchId = 'punch-' + Date.now();
    state.punches.push({
      id: finalPunchId,
      projectId: 'proj-1', // Active on coding
      startTime: current,
      endTime: null
    });
    state.activePunchId = finalPunchId;
  }
};

// --- Punch Chain Controller (Continuous Logic) ---
const ChainController = {
  
  /**
   * Switches to a new project instantly.
   * Closes the active punch, sets its endTime to NOW, and opens a new punch starting at NOW.
   */
  startProject(projectId) {
    const now = Date.now();
    const active = state.punches.find(p => p.id === state.activePunchId);
    
    // If clicking the project that is already active, do nothing
    if (active && active.projectId === projectId) return;
    
    playSound('switch');
    
    if (active) {
      active.endTime = now;
    }
    
    const newPunchId = 'punch-' + now;
    state.punches.push({
      id: newPunchId,
      projectId: projectId,
      startTime: now,
      endTime: null
    });
    state.activePunchId = newPunchId;
    
    // Auto-normalize
    this.repairPunchChain(false);
    DB.save();
    UI.renderAll();
    UI.showToast(`Switched tracking to "${UI.getProjectName(projectId)}"`);
  },
  
  /**
   * Switches active punch to Idle (corresponds to "Stop Tracking" or pausing).
   */
  stopToIdle() {
    this.startProject('idle');
  },
  
  /**
   * Self-healing continuous logic loop (Admin Repair Engine).
   * 1. Sorts punches chronologically.
   * 2. Overlaps are truncated.
   * 3. Gaps are padded with "Idle" punches.
   * 4. Active punch is preserved at the very end.
   */
  repairPunchChain(alertUser = true) {
    if (state.punches.length === 0) return;
    
    let originalCount = state.punches.length;
    
    // 1. Separate running punch and closed punches
    const runningIndex = state.punches.findIndex(p => p.endTime === null);
    let runningPunch = null;
    if (runningIndex !== -1) {
      runningPunch = state.punches.splice(runningIndex, 1)[0];
    }
    
    // 2. Sort closed punches
    state.punches.sort((a, b) => a.startTime - b.startTime);
    
    let repairedPunches = [];
    
    // 3. Process closed punches to ensure perfect alignment
    for (let i = 0; i < state.punches.length; i++) {
      let p = state.punches[i];
      
      // Filter out invalid punches (startTime > endTime)
      if (p.startTime > p.endTime) continue;
      
      if (repairedPunches.length === 0) {
        repairedPunches.push(p);
      } else {
        let prev = repairedPunches[repairedPunches.length - 1];
        
        if (p.startTime === prev.endTime) {
          // Perfect fit
          repairedPunches.push(p);
        } else if (p.startTime < prev.endTime) {
          // Overlap! Truncate the previous punch
          prev.endTime = p.startTime;
          if (prev.startTime >= prev.endTime) {
            // Previous punch was completely swallowed, replace it
            repairedPunches[repairedPunches.length - 1] = p;
          } else {
            repairedPunches.push(p);
          }
        } else if (p.startTime > prev.endTime) {
          // Gap! Fill gap with an Idle punch
          repairedPunches.push({
            id: 'idle-gap-' + prev.endTime,
            projectId: 'idle',
            startTime: prev.endTime,
            endTime: p.startTime
          });
          repairedPunches.push(p);
        }
      }
    }
    
    // 4. Align running punch
    if (runningPunch) {
      if (repairedPunches.length > 0) {
        let prev = repairedPunches[repairedPunches.length - 1];
        if (runningPunch.startTime !== prev.endTime) {
          // Adjust running punch start time to perfectly match the end of the last closed punch
          runningPunch.startTime = prev.endTime;
        }
      }
      repairedPunches.push(runningPunch);
      state.activePunchId = runningPunch.id;
    }
    
    state.punches = repairedPunches;
    
    if (alertUser) {
      playSound('repair');
      let difference = state.punches.length - originalCount;
      UI.showToast(`Timeline repaired successfully. Normalized ${state.punches.length} punches.`, 'success');
      UI.renderAll();
    }
  },
  
  /**
   * Updates a single punch's bounds. Surrounding punches automatically conform!
   */
  updatePunchTime(punchId, newStartStr, newEndStr) {
    const punch = state.punches.find(p => p.id === punchId);
    if (!punch) return;
    
    const dayDate = new Date(punch.startTime);
    
    // Parse start time
    const startParsed = UI.parseTimeStr(newStartStr);
    if (!startParsed) {
      UI.showToast("Invalid start time format. Use HH:MM or HHMM", "error");
      return;
    }
    const startObj = new Date(dayDate);
    startObj.setHours(startParsed.hours, startParsed.minutes, 0, 0);
    const newStartTime = startObj.getTime();
    
    let newEndTime = null;
    if (punch.endTime !== null && newEndStr) {
      // Parse end time
      const endParsed = UI.parseTimeStr(newEndStr);
      if (!endParsed) {
        UI.showToast("Invalid end time format. Use HH:MM or HHMM", "error");
        return;
      }
      const endObj = new Date(dayDate);
      endObj.setHours(endParsed.hours, endParsed.minutes, 0, 0);
      newEndTime = endObj.getTime();
      
      if (newStartTime > newEndTime) {
        UI.showToast("Start time must be before or equal to end time!", "error");
        return;
      }
    }
    
    punch.startTime = newStartTime;
    if (newEndTime !== null) {
      punch.endTime = newEndTime;
    }
    
    // Let the chain heal gaps and overlaps!
    this.repairPunchChain(false);
    DB.save();
    UI.renderAll();
    UI.showToast("Punch timeline boundaries adjusted & synchronized");
  },
  
  /**
   * Deleting a punch.
   * To keep timeline continuity, we simply reassign its projectId to "idle" and run repair!
   */
  deletePunch(punchId) {
    const punch = state.punches.find(p => p.id === punchId);
    if (!punch) return;
    
    if (punch.endTime === null) {
      UI.showToast("Cannot delete the active running punch! Switch to Idle instead.", "error");
      return;
    }
    
    playSound('click');
    
    // Find punches of the current day
    const day = state.selectedDay;
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const startMs = startOfDay.getTime();
    
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);
    const endMs = endOfDay.getTime();

    // Filter and sort punches within the selected day
    const punchesForDay = state.punches
      .filter(p => {
        const pEnd = p.endTime === null ? Date.now() : p.endTime;
        return pEnd > startMs && p.startTime < endMs;
      })
      .sort((a, b) => a.startTime - b.startTime);

    const idx = punchesForDay.findIndex(p => p.id === punchId);
    
    if (idx !== -1) {
      const deletedPunch = punchesForDay[idx];
      const preceding = punchesForDay[idx - 1];
      const succeeding = punchesForDay[idx + 1];
      
      // Remove the punch from the global array
      state.punches = state.punches.filter(p => p.id !== punchId);
      
      if (preceding && succeeding) {
        preceding.endTime = succeeding.startTime;
      } else if (preceding && !succeeding) {
        preceding.endTime = deletedPunch.endTime;
      } else if (!preceding && succeeding) {
        succeeding.startTime = deletedPunch.startTime;
      }
    } else {
      // Fallback: just remove from global array if not found in current day's view
      state.punches = state.punches.filter(p => p.id !== punchId);
    }
    
    // Let the chain heal gaps and overlaps!
    this.repairPunchChain(false);
    DB.save();
    UI.renderAll();
    UI.showToast("Punch deleted and timeline re-aligned.");
  },
  
  /**
   * Inserts a custom punch at a specific time range.
   * The repair engine will swallow/split underlying punches automatically.
   */
  insertCustomPunch(projectId, startStr, endStr) {
    const day = state.selectedDay;
    
    const startParsed = UI.parseTimeStr(startStr);
    const endParsed = UI.parseTimeStr(endStr);
    
    if (!startParsed || !endParsed) {
      UI.showToast("Invalid time format. Use HH:MM or HHMM", "error");
      return false;
    }
    
    const startObj = new Date(day);
    startObj.setHours(startParsed.hours, startParsed.minutes, 0, 0);
    
    const endObj = new Date(day);
    endObj.setHours(endParsed.hours, endParsed.minutes, 0, 0);
    
    const startTime = startObj.getTime();
    const endTime = endObj.getTime();
    
    if (startTime > endTime) {
      UI.showToast("Start time must be before or equal to end time!", "error");
      return false;
    }
    
    state.punches.push({
      id: 'punch-' + Math.random().toString(36).substr(2, 9),
      projectId: projectId,
      startTime: startTime,
      endTime: endTime
    });
    
    // Sort and repair chain propagates this insertion!
    this.repairPunchChain(false);
    DB.save();
    UI.renderAll();
    UI.showToast(`Inserted custom "${UI.getProjectName(projectId)}" punch.`);
    return true;
  }
};

// --- UI Sync & Rendering Engine ---
const UI = {
  
  init() {
    // Set active sound state based on preference
    const soundPref = localStorage.getItem('timecop_sound');
    soundEnabled = soundPref !== 'false';
    this.updateSoundBadgeIcon();
    
    // Inject centralized application version
    const versionLabels = document.querySelectorAll('.app-version-label');
    versionLabels.forEach(el => {
      el.textContent = 'v' + state.version;
    });
    
    // Bind all static DOM Event Listeners
    this.bindEvents();
    
    // Set initial archived toggle button state
    this.updateArchivedButtonState();
    
    // Run continuous UI ticking (Smooth clock / timers)
    this.startTicker();
    
    // Initial Render
    this.renderAll();
    
    // Initialize Google Drive Sync Integration
    GDriveSync.init();
  },
  
  bindEvents() {
    // Header Actions
    document.getElementById('btn-repair').addEventListener('click', () => ChainController.repairPunchChain(true));
    
    const syncDrawer = document.getElementById('sync-drawer');
    document.getElementById('btn-sync-panel').addEventListener('click', () => {
      playSound('click');
      syncDrawer.classList.remove('hidden');
      this.generateSyncToken();
    });
    document.getElementById('btn-close-sync-drawer').addEventListener('click', () => {
      playSound('click');
      syncDrawer.classList.add('hidden');
    });
    
    // Hero controls
    document.getElementById('btn-toggle-punch').addEventListener('click', () => {
      const active = state.punches.find(p => p.id === state.activePunchId);
      if (active) {
        if (active.projectId === 'idle') {
          // Switch to first non-idle project
          const nonIdle = state.projects.find(p => p.id !== 'idle');
          if (nonIdle) {
            ChainController.startProject(nonIdle.id);
          } else {
            this.showToast("Create a project to start tracking!", "error");
          }
        } else {
          // Pause / return to Idle
          ChainController.stopToIdle();
        }
      }
    });
    
    document.getElementById('btn-switch-idle').addEventListener('click', () => ChainController.stopToIdle());
    
    // Project Editor Modal Controls
    const projectModal = document.getElementById('project-modal');
    document.getElementById('btn-add-project').addEventListener('click', () => {
      playSound('click');
      document.getElementById('project-modal-title').textContent = "Add Project";
      document.getElementById('modal-project-id').value = "";
      document.getElementById('project-name').value = "";
      document.getElementById('project-category').value = "";
      projectModal.classList.remove('hidden');
    });
    
    const closeProjModal = () => {
      playSound('click');
      projectModal.classList.add('hidden');
    };
    document.getElementById('btn-close-project-modal').addEventListener('click', closeProjModal);
    document.getElementById('btn-cancel-project').addEventListener('click', closeProjModal);
    
    document.getElementById('project-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleProjectFormSubmit();
    });
    
    // Drag and Drop Grid Sorting
    const grid = document.getElementById('project-grid');
    grid.addEventListener('dragstart', (e) => this.handleDragStart(e));
    grid.addEventListener('dragover', (e) => this.handleDragOver(e));
    grid.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    grid.addEventListener('drop', (e) => this.handleDrop(e));
    grid.addEventListener('dragend', (e) => this.handleDragEnd(e));
    
    // Toggle Archived Button
    document.getElementById('btn-toggle-archived').addEventListener('click', () => {
      playSound('click');
      state.showArchived = !state.showArchived;
      this.updateArchivedButtonState();
      this.renderProjectGrid();
    });
    
    // Day Paginations for History Editor
    document.getElementById('btn-prev-day').addEventListener('click', () => this.changeEditorDay(-1));
    document.getElementById('btn-next-day').addEventListener('click', () => this.changeEditorDay(1));
    
    document.getElementById('btn-add-punch').addEventListener('click', () => this.handleInsertRowClick());
    
    // Backup & Sync panel triggers
    document.getElementById('btn-export-json').addEventListener('click', () => this.exportDatabaseJSON());
    document.getElementById('btn-trigger-upload').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', (e) => this.importDatabaseJSON(e));
    document.getElementById('btn-copy-sync-token').addEventListener('click', () => this.copySyncTokenToClipboard());
    document.getElementById('btn-paste-sync-token').addEventListener('click', () => this.pasteSyncTokenFromClipboard());
    document.getElementById('btn-reset-db').addEventListener('click', () => this.resetDatabaseConfirm());
    
    // Sound Toggle Badge
    document.getElementById('btn-toggle-sound').addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('timecop_sound', soundEnabled);
      this.updateSoundBadgeIcon();
      if (soundEnabled) {
        initAudio();
        playSound('click');
      }
    });
  },
  
  updateSoundBadgeIcon() {
    const icon = document.getElementById('sound-icon');
    if (soundEnabled) {
      icon.setAttribute('data-lucide', 'volume-2');
      document.getElementById('btn-toggle-sound').style.color = 'var(--text-active-accent)';
    } else {
      icon.setAttribute('data-lucide', 'volume-x');
      document.getElementById('btn-toggle-sound').style.color = 'var(--text-muted)';
    }
    lucide.createIcons();
  },
  
  // --- Getters & Formatting Helpers ---
  getProjectName(id) {
    const p = state.projects.find(proj => proj.id === id);
    return p ? p.name : 'Unknown';
  },
  
  getProjectGradient(id) {
    const p = state.projects.find(proj => proj.id === id);
    return p ? p.gradient : 'gradient-idle';
  },
  
  getProjectCategory(id) {
    const p = state.projects.find(proj => proj.id === id);
    return p ? p.category : 'System';
  },
  
  formatHM(timestamp) {
    const d = new Date(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },
  
  parseTimeStr(str) {
    if (!str) return null;
    const clean = str.replace(/\s+/g, '');
    
    // Pattern 1: HH:MM or H:MM
    if (clean.includes(':')) {
      const parts = clean.split(':');
      if (parts.length === 2) {
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(h) && h >= 0 && h < 24 && !isNaN(m) && m >= 0 && m < 60) {
          return { hours: h, minutes: m };
        }
      }
      return null;
    }
    
    // Pattern 2: HHMM or HMM (only digits)
    if (/^\d{3,4}$/.test(clean)) {
      let hStr, mStr;
      if (clean.length === 3) {
        hStr = clean.substring(0, 1);
        mStr = clean.substring(1);
      } else {
        hStr = clean.substring(0, 2);
        mStr = clean.substring(2);
      }
      
      const h = parseInt(hStr, 10);
      const m = parseInt(mStr, 10);
      if (!isNaN(h) && h >= 0 && h < 24 && !isNaN(m) && m >= 0 && m < 60) {
        return { hours: h, minutes: m };
      }
    }
    
    return null;
  },
  
  formatDuration(ms) {
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  },
  
  formatDurationDecimal(ms) {
    return (ms / 3600000).toFixed(1) + 'h';
  },
  
  // --- Core Ticker Module ---
  startTicker() {
    let lastSecond = -1;
    
    const tick = () => {
      const now = new Date();
      const s = now.getSeconds();
      
      // Update Live Clock Panel
      if (s !== lastSecond) {
        lastSecond = s;
        document.getElementById('live-time').textContent = 
          String(now.getHours()).padStart(2, '0') + ':' + 
          String(now.getMinutes()).padStart(2, '0') + ':' + 
          String(s).padStart(2, '0');
          
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        document.getElementById('live-date').textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
        
        // Tick running timer values
        this.updateActiveTimerHMS();
      }
      
      requestAnimationFrame(tick);
    };
    
    requestAnimationFrame(tick);
  },
  
  updateActiveTimerHMS() {
    const active = state.punches.find(p => p.id === state.activePunchId);
    if (!active) return;
    
    const delta = Math.max(0, Date.now() - active.startTime);
    const h = String(Math.floor(delta / 3600000)).padStart(2, '0');
    const m = String(Math.floor((delta % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((delta % 60000) / 1000)).padStart(2, '0');
    
    document.getElementById('active-timer-hms').textContent = `${h}:${m}:${s}`;
    
    // Sweep the circular outline overlay once per minute
    const secondsFraction = (delta % 60000) / 60000;
    const offset = 276 - (secondsFraction * 276);
    document.getElementById('timer-progress-ring').setAttribute('stroke-dashoffset', offset);
  },
  
  // --- Main Layout Render ---
  renderAll() {
    this.renderHeroPanel();
    this.renderProjectGrid();
    this.renderWeeklySummary();
    this.renderDailyTimeline();
    this.renderPunchEditor();
    
    // Refresh Icons
    lucide.createIcons();
  },
  
  renderHeroPanel() {
    const active = state.punches.find(p => p.id === state.activePunchId);
    const badge = document.getElementById('active-project-badge');
    const btnText = document.getElementById('text-toggle-punch');
    const btnIcon = document.getElementById('icon-toggle-punch');
    
    if (active) {
      const projId = active.projectId;
      badge.textContent = this.getProjectName(projId);
      badge.className = `badge ${this.getProjectGradient(projId)}`;
      
      if (projId === 'idle') {
        btnText.textContent = "Start Tracking";
        btnIcon.setAttribute('data-lucide', 'play');
        document.getElementById('btn-toggle-punch').className = "btn btn-primary btn-large";
      } else {
        btnText.textContent = "Stop (to Idle)";
        btnIcon.setAttribute('data-lucide', 'pause');
        document.getElementById('btn-toggle-punch').className = "btn btn-danger btn-large";
      }
    }
  },
  
  renderProjectGrid() {
    const grid = document.getElementById('project-grid');
    grid.innerHTML = "";
    
    // Get weekly aggregation metrics
    const weeklyTotals = this.calculateWeeklyProjectTotals();
    
    // Sort projects according to order
    state.projects.sort((a, b) => a.order - b.order);
    
    state.projects.forEach(p => {
      if (p.archived && !state.showArchived) return; // Skip archived unless toggled on
      
      const isIdle = p.id === 'idle';
      const isActive = this.isActiveProject(p.id);
      const isArchived = p.archived === true;
      
      const card = document.createElement('div');
      card.className = `project-card ${isActive ? 'active-project-active' : ''} ${isArchived ? 'project-card-archived' : ''}`;
      card.setAttribute('draggable', isIdle || isArchived ? 'false' : 'true');
      card.setAttribute('data-id', p.id);
      
      const totalWeeklyMs = weeklyTotals[p.id] || 0;
      
      card.innerHTML = `
        ${isIdle || isArchived ? '<div style="width: 14px;"></div>' : `
          <div class="project-drag-handle" title="Drag to reorder project cards">
            <i data-lucide="grip-vertical" style="width:14px;height:14px;"></i>
          </div>
        `}
        
        <div class="project-card-body" onclick="${isArchived ? '' : `window.TimecopStart('${p.id}')`}">
          <div class="project-card-name">${p.name} ${isArchived ? '<span style="font-size:0.65rem; opacity:0.6; font-weight:normal; margin-left:0.35rem;">(Archived)</span>' : ''}</div>
          <span class="project-card-category">${p.category}</span>
        </div>
        
        <div class="project-card-stats">
          <div class="project-hours-badge" title="Productive hours tracked this calendar week">${this.formatDurationDecimal(totalWeeklyMs)}</div>
          
          <div class="project-card-actions">
            ${isIdle ? '' : (isArchived ? `
              <button class="btn-card-action btn-card-restore" onclick="window.TimecopRestoreProj('${p.id}', event)" title="Restore project back to switcher">
                <i data-lucide="rotate-ccw"></i>
              </button>
            ` : `
              <button class="btn-card-action" onclick="window.TimecopEditProj('${p.id}', event)" title="Edit Project Properties">
                <i data-lucide="pencil"></i>
              </button>
              <button class="btn-card-action btn-card-delete" onclick="window.TimecopDeleteProj('${p.id}', event)" title="Archive project (hides from switcher, historical punches fully preserved)">
                <i data-lucide="archive"></i>
              </button>
            `)}
            ${isArchived ? '' : `
              <button class="btn-card-action btn-card-play" onclick="window.TimecopStart('${p.id}', event)" title="Quick-Switch Tracking to this Project">
                <i data-lucide="${isActive ? (p.id === 'idle' ? 'play' : 'pause-circle') : 'play-circle'}"></i>
              </button>
            `}
          </div>
        </div>
      `;
      
      grid.appendChild(card);
    });
  },
  
  isActiveProject(id) {
    const active = state.punches.find(p => p.id === state.activePunchId);
    return active && active.projectId === id;
  },
  
  // --- Weekly Summary Calculations & Rendering ---
  calculateWeeklyProjectTotals() {
    const totals = {};
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMon = currentDay === 0 ? 6 : currentDay - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - distanceToMon);
    monday.setHours(0, 0, 0, 0);
    const startOfWeek = monday.getTime();
    
    state.punches.forEach(p => {
      const start = Math.max(p.startTime, startOfWeek);
      const end = p.endTime === null ? Date.now() : p.endTime;
      
      if (end > start) {
        totals[p.projectId] = (totals[p.projectId] || 0) + (end - start);
      }
    });
    
    return totals;
  },
  
  renderWeeklySummary() {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMon = currentDay === 0 ? 6 : currentDay - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - distanceToMon);
    monday.setHours(0, 0, 0, 0);
    const startOfWeek = monday.getTime();
    
    // 1. Calculate Productive Time (excluding Idle)
    let totalProductiveMs = 0;
    const dailyTotalsMs = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    const categoryTotalsMs = {};
    
    state.punches.forEach(p => {
      const pStart = Math.max(p.startTime, startOfWeek);
      const pEnd = p.endTime === null ? Date.now() : p.endTime;
      
      if (pEnd > pStart) {
        const duration = pEnd - pStart;
        
        // Aggregate daily totals (Mon=0...Sun=6)
        const punchDay = new Date(pStart);
        let dayIndex = punchDay.getDay(); // Sun=0, Mon=1...
        dayIndex = dayIndex === 0 ? 6 : dayIndex - 1; // Mon=0...Sun=6
        
        if (p.projectId !== 'idle') {
          totalProductiveMs += duration;
          dailyTotalsMs[dayIndex] += duration;
          
          // Group by Category
          const category = this.getProjectCategory(p.projectId);
          categoryTotalsMs[category] = (categoryTotalsMs[category] || 0) + duration;
        }
      }
    });
    
    document.getElementById('stats-total-hours').textContent = this.formatDurationDecimal(totalProductiveMs);
    
    // 2. Render Bar Chart (Daily Productive Breakdowns)
    const barChart = document.getElementById('weekly-bar-chart');
    barChart.innerHTML = "";
    
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const maxDayVal = Math.max(...dailyTotalsMs, 3600000); // Scale relative to max day, minimum 1 hour scale
    const currentCalendarDay = now.getDay() === 0 ? 6 : now.getDay() - 1; // index for today
    
    dailyTotalsMs.forEach((ms, index) => {
      const pct = (ms / maxDayVal) * 100;
      const isToday = index === currentCalendarDay;
      
      const col = document.createElement('div');
      col.className = `bar-column ${isToday ? 'today-column' : ''}`;
      col.innerHTML = `
        <div class="bar-tooltip">${this.formatDurationDecimal(ms)} tracked</div>
        <div class="bar-fill-wrapper">
          <div class="bar-fill" style="height: ${pct}%;"></div>
        </div>
        <span class="bar-label">${dayLabels[index]}</span>
      `;
      barChart.appendChild(col);
    });
    
    // 3. Render dynamic SVG Donut Chart for Categories
    this.renderCategoryDonut(categoryTotalsMs);
  },
  
  renderCategoryDonut(categoryTotals) {
    const svg = document.getElementById('donut-chart-svg');
    const legend = document.getElementById('donut-chart-legend');
    svg.innerHTML = "";
    legend.innerHTML = "";
    
    const categories = Object.keys(categoryTotals);
    let totalMs = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);
    
    if (totalMs === 0) {
      // Empty placeholder state
      svg.innerHTML = `
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="8"></circle>
        <text x="50" y="54" text-anchor="middle" fill="var(--text-muted)" font-size="7" font-weight="700">NO DATA</text>
      `;
      legend.innerHTML = `<span class="section-desc" style="margin-bottom:0;">Start tracking non-idle tasks to view category metrics.</span>`;
      return;
    }
    
    // Palette Gradients to matching category dots
    const catColors = {
      'Development': '#00f2fe',
      'Design': '#f857a6',
      'Meeting': '#fda085',
      'Operations': '#38ef7d',
      'Personal': '#a18cd1',
      'System': '#475569'
    };
    const defaultColor = '#94a3b8';
    
    let cumAngle = 0;
    
    categories.forEach((cat, index) => {
      const ms = categoryTotals[cat];
      const fraction = ms / totalMs;
      const pct = (fraction * 100).toFixed(0);
      
      const strokeDash = 251.2; // 2 * pi * r (r=40)
      const offset = strokeDash - (fraction * strokeDash);
      const angle = cumAngle;
      cumAngle += fraction * 360;
      
      const color = catColors[cat] || defaultColor;
      
      // Draw segment path
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute('class', 'donut-segment');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '50');
      circle.setAttribute('r', '40');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-dasharray', strokeDash);
      circle.setAttribute('stroke-dashoffset', offset);
      circle.setAttribute('style', `transform: rotate(${-90 + angle}deg);`);
      svg.appendChild(circle);
      
      // Draw Legend Entry
      const entry = document.createElement('div');
      entry.className = 'donut-legend-item';
      entry.innerHTML = `
        <div class="donut-legend-color-label">
          <span class="donut-color-dot" style="background:${color};"></span>
          <span>${cat}</span>
        </div>
        <span class="donut-legend-value">${pct}% (${this.formatDurationDecimal(ms)})</span>
      `;
      legend.appendChild(entry);
    });
  },
  
  // --- Today's Continuous Timeline Bar ---
  renderDailyTimeline() {
    const bar = document.getElementById('timeline-visual-bar-today');
    const legend = document.getElementById('timeline-visual-legend');
    bar.innerHTML = "";
    legend.innerHTML = "";
    
    // Get punches for today
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const startMs = todayStart.getTime();
    
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const endMs = todayEnd.getTime();
    
    const punchesToday = state.punches.filter(p => {
      const pEnd = p.endTime === null ? Date.now() : p.endTime;
      return pEnd > startMs && p.startTime < endMs;
    });
    
    if (punchesToday.length === 0) {
      bar.innerHTML = `<div style="padding:0.25rem 1rem; font-size:0.75rem; color:var(--text-muted);">No logs logged today.</div>`;
      return;
    }
    
    // We scale the timeline bounds from the very first punch's start time (or 08:00) to current time (or 18:00)
    let timelineMin = new Date(now);
    timelineMin.setHours(8, 0, 0, 0);
    let minMs = Math.min(punchesToday[0].startTime, timelineMin.getTime());
    
    let maxMs = Math.max(Date.now(), timelineMin.getTime() + 10 * 3600000); // at least 10 hrs displayed
    
    const timelineSpan = maxMs - minMs;
    
    punchesToday.forEach(p => {
      const pStart = Math.max(p.startTime, minMs);
      const pEnd = Math.min(p.endTime === null ? Date.now() : p.endTime, maxMs);
      
      if (pEnd > pStart) {
        const pctWidth = ((pEnd - pStart) / timelineSpan) * 100;
        const grad = this.getProjectGradient(p.projectId);
        
        const block = document.createElement('div');
        block.className = `timeline-block ${grad}`;
        block.style.width = `${pctWidth}%`;
        
        // Hover Tooltip
        block.innerHTML = `
          <div class="timeline-block-tooltip">
            <span class="timeline-block-tooltip-title">${this.getProjectName(p.projectId)}</span>
            <span class="timeline-block-tooltip-times">
              ${this.formatHM(p.startTime)} - ${p.endTime === null ? 'ACTIVE' : this.formatHM(p.endTime)} 
              (${this.formatDuration(pEnd - pStart)})
            </span>
          </div>
        `;
        
        // One-Click switch via clicking blocks
        block.onclick = () => ChainController.startProject(p.projectId);
        bar.appendChild(block);
      }
    });
    
    // Generate scale ticks in legend (e.g. 5 indicators across the day)
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const tickTime = minMs + (timelineSpan * (i / (tickCount - 1)));
      const span = document.createElement('span');
      span.className = 'timeline-legend-tick';
      span.textContent = this.formatHM(tickTime);
      legend.appendChild(span);
    }
  },
  
  // --- Punch History & Boundary Editor ---
  renderPunchEditor() {
    const container = document.getElementById('punch-editor-rows');
    container.innerHTML = "";
    
    const day = state.selectedDay;
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const startMs = startOfDay.getTime();
    
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);
    const endMs = endOfDay.getTime();
    
    // Header Day indicator
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const today = new Date();
    const isToday = today.toDateString() === day.toDateString();
    
    document.getElementById('punch-editor-date').textContent = 
      isToday ? 'Today' : `${days[day.getDay()]}, ${months[day.getMonth()]} ${day.getDate()}`;
      
    // Filter punches within this selected day
    const punchesForDay = state.punches.filter(p => {
      const pEnd = p.endTime === null ? Date.now() : p.endTime;
      return pEnd > startMs && p.startTime < endMs;
    });
    
    if (punchesForDay.length === 0) {
      container.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color:var(--text-muted)">No continuous punches logged on this day.</td></tr>`;
      return;
    }
    
    punchesForDay.forEach(p => {
      const isRunning = p.endTime === null;
      const duration = (isRunning ? Date.now() : p.endTime) - p.startTime;
      
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', p.id);
      
      tr.innerHTML = `
        <td>
          <span class="table-tag" style="color:var(--text-primary); border:1px solid rgba(255,255,255,0.06); background:var(--bg-panel);">
            <span class="table-tag-circle ${this.getProjectGradient(p.projectId)}"></span>
            ${this.getProjectName(p.projectId)}
          </span>
        </td>
        <td>
          <input type="text" class="time-input" value="${this.formatHM(p.startTime)}" 
            onchange="window.TimecopChangeBound('${p.id}', this.value, 'start')" />
        </td>
        <td>
          ${isRunning ? `
            <span class="badge gradient-cyan-blue" style="font-size:0.6rem; padding: 0.15rem 0.45rem;">RUNNING</span>
          ` : `
            <input type="text" class="time-input" value="${this.formatHM(p.endTime)}" 
              onchange="window.TimecopChangeBound('${p.id}', this.value, 'end')" />
          `}
        </td>
        <td class="duration-td">${this.formatDuration(duration)}</td>
        <td>
          <div class="punch-editor-row-actions">
            ${isRunning ? `
              <button class="btn btn-secondary-outline btn-sm btn-icon" onclick="window.TimecopStopIdle()" title="Switch active tracking to Idle"><i data-lucide="pause"></i></button>
            ` : `
              <button class="btn btn-secondary-outline btn-sm btn-icon danger-text" onclick="window.TimecopDeletePunch('${p.id}')" title="Delete punch (re-allocates slot back to Idle)"><i data-lucide="trash-2"></i></button>
            `}
          </div>
        </td>
      `;
      container.appendChild(tr);
    });
    
    lucide.createIcons();
  },
  
  changeEditorDay(dir) {
    playSound('click');
    const newDay = new Date(state.selectedDay);
    newDay.setDate(state.selectedDay.getDate() + dir);
    state.selectedDay = newDay;
    this.renderPunchEditor();
  },
  
  handleInsertRowClick() {
    playSound('click');
    
    // Prompt custom quick inserts on this day
    const timeStr = prompt("Enter insertion Start & End Times (24h format HH:MM - HH:MM or HHMM - HHMM), e.g. 10:00 - 11:30 or 1000 - 1130");
    if (!timeStr) return;
    
    const parts = timeStr.split('-').map(s => s.trim());
    if (parts.length !== 2) {
      this.showToast("Invalid format. Use HH:MM - HH:MM or HHMM - HHMM", "error");
      return;
    }
    
    // Choose project (only active unarchived ones)
    const projs = state.projects.filter(p => p.id !== 'idle' && !p.archived);
    let promptMsg = "Choose project number:\n" + projs.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
    const choice = prompt(promptMsg);
    if (!choice) return;
    
    const num = parseInt(choice, 10);
    if (isNaN(num) || num < 1 || num > projs.length) {
      this.showToast("Invalid project selected.", "error");
      return;
    }
    
    const selectedProj = projs[num - 1];
    ChainController.insertCustomPunch(selectedProj.id, parts[0], parts[1]);
  },
  
  // --- Drag and Drop Sorting Handlers ---
  handleDragStart(e) {
    const card = e.target.closest('.project-card');
    if (!card || card.getAttribute('draggable') === 'false') return;
    
    card.classList.add('sortable-drag');
    e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
    e.dataTransfer.effectAllowed = 'move';
  },
  
  handleDragOver(e) {
    e.preventDefault();
    const card = e.target.closest('.project-card');
    if (!card || card.getAttribute('draggable') === 'false') return;
    
    card.classList.add('sortable-ghost');
  },
  
  handleDragLeave(e) {
    const card = e.target.closest('.project-card');
    if (card) {
      card.classList.remove('sortable-ghost');
    }
  },
  
  handleDrop(e) {
    e.preventDefault();
    const dragId = e.dataTransfer.getData('text/plain');
    const dropCard = e.target.closest('.project-card');
    if (!dropCard || dropCard.getAttribute('data-id') === dragId) return;
    
    const dropId = dropCard.getAttribute('data-id');
    
    // Find index in state
    const dragIdx = state.projects.findIndex(p => p.id === dragId);
    const dropIdx = state.projects.findIndex(p => p.id === dropId);
    
    if (dragIdx !== -1 && dropIdx !== -1) {
      // Re-splice the project in array
      const [moved] = state.projects.splice(dragIdx, 1);
      state.projects.splice(dropIdx, 0, moved);
      
      // Update order field
      state.projects.forEach((p, idx) => {
        p.order = idx;
      });
      
      playSound('click');
      DB.save();
      this.renderProjectGrid();
      this.showToast("Project card order saved.");
    }
  },
  
  handleDragEnd(e) {
    const cards = document.querySelectorAll('.project-card');
    cards.forEach(c => {
      c.classList.remove('sortable-drag');
      c.classList.remove('sortable-ghost');
    });
  },
  
  // --- Project Add/Edit Form Handlers ---
  handleProjectFormSubmit() {
    const id = document.getElementById('modal-project-id').value;
    const name = document.getElementById('project-name').value.trim();
    const cat = document.getElementById('project-category').value.trim();
    
    // Get checked gradient radio
    const gradient = document.querySelector('input[name="project-gradient"]:checked').value;
    
    if (!name || !cat) return;
    
    playSound('click');
    
    if (id) {
      // Edit
      const p = state.projects.find(proj => proj.id === id);
      if (p) {
        p.name = name;
        p.category = cat;
        p.gradient = gradient;
        this.showToast(`Updated project "${name}"`);
      }
    } else {
      // Add
      const newId = 'proj-' + Date.now();
      state.projects.push({
        id: newId,
        name: name,
        category: cat,
        gradient: gradient,
        order: state.projects.length
      });
      this.showToast(`Created project "${name}"`);
    }
    
    DB.save();
    document.getElementById('project-modal').classList.add('hidden');
    this.renderAll();
  },
  
  editProject(id) {
    const p = state.projects.find(proj => proj.id === id);
    if (!p) return;
    
    document.getElementById('project-modal-title').textContent = "Edit Project";
    document.getElementById('modal-project-id').value = p.id;
    document.getElementById('project-name').value = p.name;
    document.getElementById('project-category').value = p.category;
    
    // Check correct radio gradient
    const radio = document.querySelector(`input[name="project-gradient"][value="${p.gradient}"]`);
    if (radio) radio.checked = true;
    
    document.getElementById('project-modal').classList.remove('hidden');
  },
  
  deleteProject(id) {
    if (id === 'idle') return;
    
    const p = state.projects.find(proj => proj.id === id);
    if (!p) return;
    
    const countPunches = state.punches.filter(punch => punch.projectId === id).length;
    let msg = `Are you sure you want to archive "${p.name}"?`;
    if (countPunches > 0) {
      msg += `\nThis will hide the project from the switcher, but keep all ${countPunches} historical punch logs intact.`;
    } else {
      msg += `\nThis will hide the project from your switcher.`;
    }
    
    if (confirm(msg)) {
      playSound('click');
      
      // If currently active, switch tracking to Idle first!
      const active = state.punches.find(p => p.id === state.activePunchId);
      if (active && active.projectId === id) {
        ChainController.stopToIdle();
      }
      
      // Archive definition
      p.archived = true;
      
      DB.save();
      this.renderAll();
      this.showToast(`Archived "${p.name}". Historical logs preserved.`, 'success');
    }
  },
  
  restoreProject(id) {
    const p = state.projects.find(proj => proj.id === id);
    if (!p) return;
    
    playSound('click');
    p.archived = false;
    DB.save();
    this.renderAll();
    this.showToast(`Restored project "${p.name}" back to switcher!`, 'success');
  },
  
  updateArchivedButtonState() {
    const btn = document.getElementById('btn-toggle-archived');
    if (!btn) return;
    
    const icon = btn.querySelector('i') || btn.querySelector('svg');
    const span = btn.querySelector('span');
    if (state.showArchived) {
      btn.className = "btn btn-primary btn-sm";
      if (span) span.textContent = "Hide Archived";
      if (icon) icon.setAttribute('data-lucide', 'archive-restore');
    } else {
      btn.className = "btn btn-secondary-outline btn-sm";
      if (span) span.textContent = "Show Archived";
      if (icon) icon.setAttribute('data-lucide', 'archive');
    }
    lucide.createIcons();
  },
  
  // --- Toast Manager ---
  showToast(message, type = 'default') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    
    t.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info'}" style="width:16px;height:16px;"></i>
      <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(t);
    lucide.createIcons();
    
    // Auto remove after 3s
    setTimeout(() => {
      t.style.animation = "none";
      t.style.opacity = "0";
      t.style.transform = "translateX(20px)";
      t.style.transition = "all 0.3s ease";
      setTimeout(() => t.remove(), 300);
    }, 3000);
  },
  
  // --- Backup Sync Importers & Exporters ---
  generateSyncToken() {
    const payload = JSON.stringify({
      projects: state.projects,
      punches: state.punches,
      activePunchId: state.activePunchId
    });
    
    // Simple Base64 compression
    try {
      const b64 = btoa(unescape(encodeURIComponent(payload)));
      document.getElementById('sync-payload-textarea').value = b64;
    } catch (e) {
      document.getElementById('sync-payload-textarea').value = payload;
    }
  },
  
  async copySyncTokenToClipboard() {
    playSound('click');
    const area = document.getElementById('sync-payload-textarea');
    if (!area || !area.value || area.value === "Generating sync token...") {
      this.showToast("No sync token generated yet!", "error");
      return;
    }
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(area.value);
        this.showToast("Sync token copied to clipboard! Paste it on another device.", "success");
      } else {
        area.select();
        document.execCommand('copy');
        this.showToast("Sync token copied to clipboard! Paste it on another device.", "success");
      }
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      area.select();
      this.showToast("Please select and copy the token text from the box manually.", "error");
    }
  },
  
  pasteSyncTokenFromClipboard() {
    playSound('click');
    const token = prompt("Paste the Timecop Sync Token / Payload here:");
    if (!token) return;
    
    try {
      let decoded = "";
      try {
        decoded = decodeURIComponent(escape(atob(token)));
      } catch (e) {
        decoded = token; // fallback if raw JSON
      }
      
      const parsed = JSON.parse(decoded);
      if (parsed.projects && parsed.punches) {
        state.projects = parsed.projects;
        state.punches = parsed.punches;
        state.activePunchId = parsed.activePunchId || null;
        
        ChainController.repairPunchChain(false);
        DB.save();
        this.renderAll();
        document.getElementById('sync-drawer').classList.add('hidden');
        this.showToast("Database restored successfully!", "success");
      } else {
        this.showToast("Invalid sync token payload structures.", "error");
      }
    } catch (e) {
      this.showToast("Failed to parse token. Ensure you copied the entire payload.", "error");
    }
  },
  
  exportDatabaseJSON() {
    playSound('click');
    const payload = {
      projects: state.projects,
      punches: state.punches,
      activePunchId: state.activePunchId
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", "timecop_database.json");
    dlAnchorElem.click();
    this.showToast("database.json exported successfully", "success");
  },
  
  importDatabaseJSON(e) {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.projects && parsed.punches) {
          state.projects = parsed.projects;
          state.punches = parsed.punches;
          state.activePunchId = parsed.activePunchId || null;
          
          ChainController.repairPunchChain(false);
          DB.save();
          this.renderAll();
          document.getElementById('sync-drawer').classList.add('hidden');
          this.showToast("database.json imported successfully!", "success");
        } else {
          this.showToast("Invalid JSON file template structures.", "error");
        }
      } catch (err) {
        this.showToast("Corrupt or invalid JSON file.", "error");
      }
    };
    if (e.target.files.length > 0) {
      fileReader.readAsText(e.target.files[0]);
    }
  },
  
  resetDatabaseConfirm() {
    playSound('click');
    if (confirm("DANGER! This will delete ALL tracked time history, punches, and custom project titles. There is no undo.\n\nType 'RESET' to confirm:")) {
      const confirmStr = prompt("Type 'RESET' to wipe data:");
      if (confirmStr === 'RESET') {
        localStorage.removeItem('timecop_db');
        DB.loadDefaults();
        DB.save();
        this.renderAll();
        document.getElementById('sync-drawer').classList.add('hidden');
        this.showToast("Database nuked. Restored default setup.", "success");
      } else {
        this.showToast("Reset aborted.");
      }
    }
  }
};

// --- Google Drive Cloud Sync Module ---
const GDriveSync = {
  debounceTimer: null,
  
  init() {
    // Connect listener for accordion toggle
    const helpBtn = document.getElementById('btn-toggle-gdrive-help');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        const content = document.getElementById('gdrive-help-content');
        const arrow = helpBtn.querySelector('.accordion-arrow');
        if (content) {
          content.classList.toggle('hidden');
          arrow.classList.toggle('rotated');
        }
      });
    }

    // Toggle Client ID visibility
    const visBtn = document.getElementById('btn-toggle-client-id-vis');
    if (visBtn) {
      visBtn.addEventListener('click', () => {
        const input = document.getElementById('gdrive-client-id');
        const icon = visBtn.querySelector('i') || visBtn.querySelector('svg');
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) icon.setAttribute('data-lucide', 'eye-off');
        } else {
          input.type = 'password';
          if (icon) icon.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
      });
    }

    // Connect trigger button
    const connectBtn = document.getElementById('btn-connect-gdrive');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.connect());
    }

    // Disconnect button
    const disconnectBtn = document.getElementById('btn-disconnect-gdrive');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => this.disconnect());
    }

    // Sync Now button
    const syncBtn = document.getElementById('btn-sync-gdrive-now');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        playSound('click');
        this.sync(true);
      });
    }

    // Fill configured Client ID in input
    const input = document.getElementById('gdrive-client-id');
    if (input && state.googleClientId) {
      input.value = state.googleClientId;
    }

    // Hook cloud badge click
    const badge = document.getElementById('cloud-sync-badge');
    if (badge) {
      badge.addEventListener('click', () => {
        playSound('click');
        document.getElementById('sync-drawer').classList.remove('hidden');
        UI.generateSyncToken();
      });
    }

    // Recover previous active connection if tokens exist and aren't expired
    if (state.googleClientId && state.googleAccessToken) {
      if (Date.now() < state.googleTokenExpiry) {
        state.syncStatus = 'connected';
        this.updateUI();
        // Silent initial sync
        this.sync();
      } else {
        // Token expired, silently request a new one in background or set status to error/disconnected
        state.syncStatus = 'disabled';
        this.updateUI();
      }
    } else {
      state.syncStatus = 'disabled';
      this.updateUI();
    }

    // Low-Cost Frequent Synchronization Triggers
    // 1. Silent periodic background check every 30 seconds
    setInterval(() => {
      if (state.syncStatus === 'connected') {
        this.sync();
      }
    }, 30000);

    // 2. Perform a silent metadata check whenever the tab regains focus or visibility shifts to visible
    window.addEventListener('focus', () => {
      if (state.syncStatus === 'connected') {
        this.sync();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.syncStatus === 'connected') {
        this.sync();
      }
    });
  },

  updateUI() {
    const badge = document.getElementById('cloud-sync-badge');
    const badgeText = badge ? badge.querySelector('span') : null;
    const badgeIcon = badge ? (badge.querySelector('i') || badge.querySelector('svg')) : null;

    const setupArea = document.getElementById('gdrive-setup-area');
    const statusArea = document.getElementById('gdrive-status-area');
    const emailSpan = document.getElementById('gdrive-user-email');

    // Update state based badge
    if (badge) {
      if (state.syncStatus === 'disabled') {
        badge.className = 'cloud-sync-badge badge-disabled';
        if (badgeText) badgeText.textContent = 'Sync Off';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'cloud-off');
      } else if (state.syncStatus === 'connected') {
        badge.className = 'cloud-sync-badge badge-connected';
        if (badgeText) badgeText.textContent = 'Synced';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'cloud');
      } else if (state.syncStatus === 'syncing') {
        badge.className = 'cloud-sync-badge badge-syncing';
        if (badgeText) badgeText.textContent = 'Syncing...';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'refresh-cw');
      } else if (state.syncStatus === 'error') {
        badge.className = 'cloud-sync-badge badge-error';
        if (badgeText) badgeText.textContent = 'Sync Error';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'alert-triangle');
      }
      lucide.createIcons();
    }

    // Update Drawer view
    if (state.syncStatus === 'disabled') {
      if (setupArea) setupArea.classList.remove('hidden');
      if (statusArea) statusArea.classList.add('hidden');
    } else {
      if (setupArea) setupArea.classList.add('hidden');
      if (statusArea) statusArea.classList.remove('hidden');
      if (emailSpan) {
        emailSpan.textContent = state.googleUserEmail || 'Google Drive Active';
      }
    }
  },

  connect() {
    playSound('click');
    const clientId = document.getElementById('gdrive-client-id').value.trim();
    if (!clientId) {
      UI.showToast("Please enter a valid Google OAuth Client ID first!", "error");
      return;
    }

    state.googleClientId = clientId;
    localStorage.setItem('tc_gdrive_client_id', clientId);

    // Verify GIS client library is loaded
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      UI.showToast("Google Identity Services script not loaded. Check connection.", "error");
      return;
    }

    state.syncStatus = 'syncing';
    this.updateUI();

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error("GIS connection error: ", tokenResponse);
            state.syncStatus = 'error';
            this.updateUI();
            UI.showToast("Login failed: " + tokenResponse.error, "error");
            return;
          }

          if (tokenResponse.access_token) {
            state.googleAccessToken = tokenResponse.access_token;
            state.googleTokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
            
            localStorage.setItem('tc_gdrive_token', state.googleAccessToken);
            localStorage.setItem('tc_gdrive_token_expiry', state.googleTokenExpiry);

            // Fetch user info from Google to display active email
            try {
              const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${state.googleAccessToken}` }
              });
              if (profileRes.ok) {
                const profile = await profileRes.json();
                state.googleUserEmail = profile.email || 'Google Active';
                localStorage.setItem('tc_gdrive_user_email', state.googleUserEmail);
              }
            } catch (err) {
              console.warn("Could not fetch user profile info, proceeding anyway.", err);
              state.googleUserEmail = 'Connected Account';
            }

            state.syncStatus = 'connected';
            this.updateUI();
            UI.showToast("Google Drive connected successfully!", "success");

            // Perform initial full two-way sync
            await this.sync(true);
          }
        },
      });

      client.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      console.error(e);
      state.syncStatus = 'error';
      this.updateUI();
      UI.showToast("OAuth client initialization failed.", "error");
    }
  },

  disconnect() {
    playSound('click');
    state.googleAccessToken = '';
    state.googleTokenExpiry = 0;
    state.googleUserEmail = '';
    state.syncStatus = 'disabled';
    
    localStorage.removeItem('tc_gdrive_token');
    localStorage.removeItem('tc_gdrive_token_expiry');
    localStorage.removeItem('tc_gdrive_user_email');
    
    this.updateUI();
    UI.showToast("Google Drive disconnected.", "success");
  },

  triggerAutoSync() {
    if (state.syncStatus !== 'connected' && state.syncStatus !== 'syncing') return;
    
    // Check if token expired
    if (Date.now() >= state.googleTokenExpiry) {
      this.refreshConnectionTokenSilent();
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    
    this.debounceTimer = setTimeout(() => {
      this.sync();
    }, 3000); // 3-second debounce to aggregate contiguous changes
  },

  async refreshConnectionTokenSilent() {
    if (!state.googleClientId) return;
    
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: state.googleClientId,
        scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email',
        prompt: 'none', // background refresh with no pop-up
        callback: (tokenResponse) => {
          if (tokenResponse.access_token) {
            state.googleAccessToken = tokenResponse.access_token;
            state.googleTokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
            localStorage.setItem('tc_gdrive_token', state.googleAccessToken);
            localStorage.setItem('tc_gdrive_token_expiry', state.googleTokenExpiry);
            state.syncStatus = 'connected';
            this.updateUI();
            this.sync();
          }
        }
      });
      client.requestAccessToken({ prompt: 'none' });
    } catch (e) {
      console.warn("Silent token refresh failed, user consent required.", e);
      state.syncStatus = 'error';
      this.updateUI();
    }
  },

  async sync(forceUpload = false) {
    if (!state.googleAccessToken || Date.now() >= state.googleTokenExpiry) {
      if (forceUpload) {
        UI.showToast("Please connect to Google Drive first!", "error");
      }
      return;
    }

    const oldStatus = state.syncStatus;
    state.syncStatus = 'syncing';
    this.updateUI();

    const headers = { Authorization: `Bearer ${state.googleAccessToken}` };

    try {
      // 1. Search for existing backup file in hidden appDataFolder
      const searchRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name="timecop_db.json"&fields=files(id,modifiedTime)',
        { headers }
      );
      
      if (!searchRes.ok) {
        let errMsg = "Failed to query appDataFolder";
        try {
          const errData = await searchRes.json();
          if (errData && errData.error && errData.error.message) {
            errMsg = errData.error.message;
            console.error("Google Drive API Error details:", errData.error);
          }
        } catch (e) {}
        throw new Error(errMsg);
      }
      
      const searchData = await searchRes.json();
      const files = searchData.files || [];
      
      const localData = {
        projects: state.projects,
        punches: state.punches,
        activePunchId: state.activePunchId,
        lastUpdated: state.lastUpdated
      };

      if (files.length === 0) {
        // A. No remote backup exists yet. Upload the local data.
        const fileMeta = await this.uploadNewBackup(localData, headers);
        if (fileMeta && fileMeta.modifiedTime) {
          localStorage.setItem('tc_gdrive_last_modified_time', fileMeta.modifiedTime);
          localStorage.setItem('tc_last_sync_local_time', state.lastUpdated);
        }
      } else {
        const fileId = files[0].id;
        const remoteModifiedTime = files[0].modifiedTime;
        
        const lastSyncTime = localStorage.getItem('tc_gdrive_last_modified_time') || '';
        const lastSyncLocalTime = parseInt(localStorage.getItem('tc_last_sync_local_time') || '0', 10);
        
        const hasLocalChanges = state.lastUpdated > lastSyncLocalTime;
        const hasRemoteChanges = remoteModifiedTime !== lastSyncTime;
        
        // If there are no local changes and no remote changes, and sync was not forced, exit immediately!
        if (!hasLocalChanges && !hasRemoteChanges && !forceUpload) {
          state.syncStatus = 'connected';
          this.updateUI();
          return;
        }

        if (hasRemoteChanges || forceUpload) {
          // B. Remote backup exists and has changes (or sync was forced). Download and resolve conflict.
          const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers });
          if (!downloadRes.ok) throw new Error("Failed to download cloud backup");

          const remoteData = await downloadRes.json();
          const remoteUpdated = remoteData.lastUpdated || 0;

          if (forceUpload || localData.lastUpdated > remoteUpdated) {
            // Local is newer -> update the existing file in the cloud
            const fileMeta = await this.updateExistingBackup(fileId, localData, headers);
            if (fileMeta && fileMeta.modifiedTime) {
              localStorage.setItem('tc_gdrive_last_modified_time', fileMeta.modifiedTime);
              localStorage.setItem('tc_last_sync_local_time', state.lastUpdated);
            }
          } else if (remoteUpdated > localData.lastUpdated) {
            // Cloud is newer -> pull cloud data locally and refresh
            state.projects = remoteData.projects || [];
            state.punches = remoteData.punches || [];
            state.activePunchId = remoteData.activePunchId || null;
            state.lastUpdated = remoteUpdated;

            localStorage.setItem('tc_last_updated', state.lastUpdated);
            localStorage.setItem('timecop_db', JSON.stringify({
              projects: state.projects,
              punches: state.punches,
              activePunchId: state.activePunchId
            }));

            localStorage.setItem('tc_gdrive_last_modified_time', remoteModifiedTime);
            localStorage.setItem('tc_last_sync_local_time', state.lastUpdated);

            UI.renderAll();
            UI.showToast("Synchronized newest timeline logs from Google Drive!", "success");
          }
        } else if (hasLocalChanges) {
          // Local is newer and cloud has no changes. Just upload local!
          const fileMeta = await this.updateExistingBackup(fileId, localData, headers);
          if (fileMeta && fileMeta.modifiedTime) {
            localStorage.setItem('tc_gdrive_last_modified_time', fileMeta.modifiedTime);
            localStorage.setItem('tc_last_sync_local_time', state.lastUpdated);
          }
        }
      }

      state.syncStatus = 'connected';
      this.updateUI();
      
      // Update sync timestamp inside drawer
      const lastSyncEl = document.getElementById('gdrive-last-sync');
      if (lastSyncEl) {
        const now = new Date();
        lastSyncEl.textContent = `Last Synced: Today at ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}`;
      }

    } catch (e) {
      console.error("Cloud synchronization failed: ", e);
      state.syncStatus = 'error';
      this.updateUI();
      UI.showToast("Cloud sync failed. Will retry later.", "error");
    }
  },

  async uploadNewBackup(payload, headers) {
    const metadata = {
      name: 'timecop_db.json',
      parents: ['appDataFolder']
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
      method: 'POST',
      headers,
      body: form
    });
    
    if (!res.ok) {
      let errMsg = "Upload failed";
      try {
        const errData = await res.json();
        if (errData && errData.error && errData.error.message) {
          errMsg = errData.error.message;
          console.error("Google Drive API upload error:", errData.error);
        }
      } catch (e) {}
      throw new Error(errMsg);
    }
    
    return await res.json();
  },

  async updateExistingBackup(fileId, payload, headers) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      let errMsg = "Patch update failed";
      try {
        const errData = await res.json();
        if (errData && errData.error && errData.error.message) {
          errMsg = errData.error.message;
          console.error("Google Drive API patch error:", errData.error);
        }
      } catch (e) {}
      throw new Error(errMsg);
    }
    
    return await res.json();
  }
};

// --- Globals hooks for inline markup buttons ---
window.TimecopStart = (id, event) => {
  if (event) event.stopPropagation();
  ChainController.startProject(id);
};
window.TimecopStopIdle = () => ChainController.stopToIdle();
window.TimecopEditProj = (id, event) => {
  if (event) event.stopPropagation();
  UI.editProject(id);
};
window.TimecopDeleteProj = (id, event) => {
  if (event) event.stopPropagation();
  UI.deleteProject(id);
};
window.TimecopRestoreProj = (id, event) => {
  if (event) event.stopPropagation();
  UI.restoreProject(id);
};
window.TimecopChangeBound = (punchId, newVal, field) => {
  const punch = state.punches.find(p => p.id === punchId);
  if (!punch) return;
  
  const startStr = field === 'start' ? newVal : UI.formatHM(punch.startTime);
  const endStr = field === 'end' ? newVal : UI.formatHM(punch.endTime);
  ChainController.updatePunchTime(punchId, startStr, endStr);
};
window.TimecopDeletePunch = (punchId) => ChainController.deletePunch(punchId);

// --- Run Client Bootstrapping ---
document.addEventListener('DOMContentLoaded', () => {
  DB.load();
  UI.init();
});
