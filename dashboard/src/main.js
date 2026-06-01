import { state } from './lib/state.js';
import { api, apiRaw, authHeaders, authUrl } from './lib/api.js';
import { showToast } from './lib/ui.js';
import { esc, formatBytes, formatDate, avatarColor, initials } from './lib/format.js';
import { loadPersonas } from './panels/personas.js';
import { loadIdleTasks } from './panels/idle-tasks.js';
import { loadLessons, loadPreferences, loadOrchestrator, loadHub } from './panels/insights.js';
import {
  renderKeyProviders, loadKeys, loadOpenrouterConfig, loadOllamaConfig, updateQuickStartBanner,
  loadGlobalProvider, loadGlobalImageProvider, loadTelegramStatus, loadVoices,
  loadResearchDomains, loadBackups, loadAutonomousStatus,
} from './panels/settings.js';
import { loadTemplates, loadProjects, showProjectList, openProjectDetail } from './panels/projects.js';
import { loadDocuments } from './panels/library.js';
import { loadHQ } from './panels/hq.js';
import { loadHomeStats, loadActivity } from './panels/home.js';
import './panels/chat.js';

// ================================================================
// NAVIGATION
// ================================================================
var panelTitles = { home: 'Home', hq: 'Author HQ', projects: 'Projects', personas: 'Personas', library: 'Library', settings: 'Settings' };
var navItems = document.querySelectorAll('.nav-item');

// Exported: home + library panels call switchPanel to navigate.
export function switchPanel(name) {
  state.currentPanel = name;
  navItems.forEach(function(n) { n.classList.toggle('active', n.getAttribute('data-panel') === name); });
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');
  document.getElementById('panelTitle').textContent = panelTitles[name] || name;

  // Load data for the panel
  if (name === 'projects') {
    loadTemplates();
    loadProjects();
    showProjectList();
  } else if (name === 'personas') {
    loadPersonas();
  } else if (name === 'library') {
    loadDocuments();
  } else if (name === 'settings') {
    updateQuickStartBanner();
    loadKeys();
    loadOllamaConfig();
    loadOpenrouterConfig();
    loadGlobalProvider();
    loadGlobalImageProvider();
    loadResearchDomains();
    loadAutonomousStatus();
    loadTelegramStatus();
    loadVoices();
    loadIdleTasks();
    loadBackups();
    loadLessons();
    loadPreferences();
    loadOrchestrator();
  } else if (name === 'home') {
    loadProjects();
    loadHomeStats();
    loadHub();
  } else if (name === 'hq') {
    loadHQ();
  }
}

navItems.forEach(function(n) {
  n.addEventListener('click', function() {
    switchPanel(n.getAttribute('data-panel'));
  });
});

// ================================================================
// STATUS POLLING
// ================================================================
// Exported: panel modules (settings) call loadStatus to refresh after a change.
export function loadStatus() {
  api('GET', '/api/status').then(function(data) {
    // Heartbeat dot
    var dot = document.getElementById('heartbeatDot');
    var label = document.getElementById('heartbeatLabel');
    dot.className = 'heartbeat-dot ok';
    label.textContent = 'Online';

    // Header status
    var headerSt = document.getElementById('headerStatus');
    if (data.providers && data.providers.length > 0) {
      headerSt.textContent = data.providers.length + ' provider(s) active';
    } else {
      headerSt.textContent = 'No AI providers';
    }

    // Home stats
    var activeCount = 0;
    var totalWords = 0;
    if (data.projects) {
      activeCount = data.projects.active || 0;
      totalWords = data.projects.totalWords || 0;
    }
    // Fallback: count from state.allProjects
    if (state.allProjects.length > 0) {
      activeCount = state.allProjects.filter(function(p) { return p.status === 'active'; }).length;
    }
    document.getElementById('statProjects').textContent = activeCount;
    document.getElementById('statWords').textContent = totalWords ? totalWords.toLocaleString() : '0';

    // Heartbeat stat
    var hbStat = document.getElementById('statHeartbeat');
    if (data.heartbeat && data.heartbeat.enabled !== false) {
      hbStat.textContent = 'OK';
      hbStat.style.color = '';
    } else {
      hbStat.textContent = 'OK';
    }

    // Personas stat
    document.getElementById('statPersonas').textContent = state.allPersonas.length || (data.personas ? data.personas.count || 0 : 0);

  }).catch(function() {
    document.getElementById('heartbeatDot').className = 'heartbeat-dot err';
    document.getElementById('heartbeatLabel').textContent = 'Offline';
    document.getElementById('headerStatus').textContent = 'Disconnected';
  });
}

function startPolling() {
  loadStatus();
  loadProjects();
  loadPersonas();
  loadActivity();
  loadHomeStats();
  state.statusPollTimer = setInterval(loadStatus, 10000);
  state.projectPollTimer = setInterval(function() {
    if (state.currentPanel === 'home' || state.currentPanel === 'projects') {
      loadProjects();
    }
    if (state.currentPanel === 'home') {
      loadActivity();
      loadHomeStats();
    }
  }, 15000);
}

// ================================================================
// THEME TOGGLE
// ================================================================
var themeToggle = document.getElementById('themeToggle');
var savedTheme = localStorage.getItem('bookclaw-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bookclaw-theme', next);
  // Swap icon
  var icon = document.getElementById('themeIcon');
  if (next === 'light') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
});
// Set initial icon
if (savedTheme === 'light') {
  document.getElementById('themeIcon').innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

// ================================================================
// INITIALIZATION
// ================================================================
renderKeyProviders();
startPolling();

