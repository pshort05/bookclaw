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

// ================================================================
// NAVIGATION
// ================================================================
var panelTitles = { home: 'Home', hq: 'Author HQ', projects: 'Projects', personas: 'Personas', library: 'Library', settings: 'Settings' };
var navItems = document.querySelectorAll('.nav-item');

function switchPanel(name) {
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
// HOME PANEL — Active Project Cards
// ================================================================
export function renderHomeProjects() {
  var container = document.getElementById('homeProjectScroll');
  var active = state.allProjects.filter(function(p) { return p.status === 'active' || p.status === 'paused'; });
  if (active.length === 0) {
    container.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;width:100%;">No active projects. Go to Projects to create one.</div>';
    return;
  }
  container.innerHTML = '';
  active.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'project-scroll-card';
    var currentStep = '';
    if (p.steps) {
      var act = p.steps.find(function(s) { return s.status === 'active'; });
      if (act) currentStep = act.label || act.name || '';
    }
    var personaText = p.persona ? p.persona.penName || p.persona : '';
    card.innerHTML =
      '<div class="psc-title">' + esc(p.title) + '</div>' +
      '<div class="psc-meta">' +
        '<span class="badge badge-type">' + esc(p.type || 'general') + '</span>' +
        '<span class="badge badge-status badge-' + esc(p.status) + '">' + esc(p.status) + '</span>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + (p.progress || 0) + '%">' + (p.progress || 0) + '%</div></div>' +
      (currentStep ? '<div class="psc-step">Current: ' + esc(currentStep) + '</div>' : '') +
      (personaText ? '<div class="psc-step" style="color:var(--info);">Persona: ' + esc(typeof personaText === 'string' ? personaText : '') + '</div>' : '');
    card.addEventListener('click', function() {
      switchPanel('projects');
      setTimeout(function() { openProjectDetail(p.id); }, 100);
    });
    container.appendChild(card);
  });
}

// ================================================================
// CHAT INTERFACE
// ================================================================
function addChatMsg(text, role) {
  var el = document.getElementById('chatMessages');
  var msg = document.createElement('div');
  msg.className = 'chat-msg ' + role;
  msg.textContent = text;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
}

function showTyping() {
  removeTyping();
  var el = document.getElementById('chatMessages');
  var ind = document.createElement('div');
  ind.className = 'typing-indicator';
  ind.id = 'typingIndicator';
  ind.innerHTML = '<span>.</span><span>.</span><span>.</span> BookClaw is thinking';
  el.appendChild(ind);
  el.scrollTop = el.scrollHeight;
}

function removeTyping() {
  var ind = document.getElementById('typingIndicator');
  if (ind) ind.remove();
}

function sendChat() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || state.chatWaiting) return;
  addChatMsg(text, 'user');
  input.value = '';
  state.chatWaiting = true;
  showTyping();

  api('POST', '/api/chat', { message: text }).then(function(data) {
    removeTyping();
    state.chatWaiting = false;
    addChatMsg(data.response || 'No response received.', 'bot');
    // Refresh projects if a command might have created/changed one
    if (text.startsWith('/')) { loadProjects(); }
  }).catch(function(e) {
    removeTyping();
    state.chatWaiting = false;
    addChatMsg('Error: ' + e.message, 'system');
  });
}

document.getElementById('btnChatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
document.getElementById('btnChatClear').addEventListener('click', function() {
  var el = document.getElementById('chatMessages');
  el.innerHTML = '<div class="chat-msg bot">Hello! I\'m BookClaw, your AI writing partner. How can I help you today?</div>';
  state.chatWaiting = false;
});

// ================================================================
// LIBRARY PANEL
// ================================================================
function loadDocuments() {
  api('GET', '/api/documents').then(function(data) {
    var docs = data.documents || data || [];
    renderDocuments(docs);
    loadCompiledOutputs();
  }).catch(function() {
    document.getElementById('docList').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">Could not load documents.</div>';
  });
}

function renderDocuments(docs) {
  var el = document.getElementById('docList');
  if (!docs || docs.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">No documents uploaded yet.</div>';
    return;
  }
  el.innerHTML = '';
  docs.forEach(function(d) {
    var row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML =
      '<span>&#128196;</span>' +
      '<span class="doc-name">' + esc(d.name || d.filename) + '</span>' +
      '<span class="doc-meta">' + formatBytes(d.size || 0) + '</span>' +
      '<span class="doc-meta">' + esc(d.type || '') + '</span>' +
      '<span class="doc-meta">' + esc(formatDate(d.uploadedAt || d.date)) + '</span>';
    el.appendChild(row);
  });
}

function loadCompiledOutputs() {
  // Try to find manuscripts from completed projects
  var completed = state.allProjects.filter(function(p) { return p.status === 'completed'; });
  var el = document.getElementById('compiledOutputs');
  if (completed.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">No compiled outputs yet. Complete a project to generate one.</div>';
    return;
  }

  el.innerHTML = '';
  completed.forEach(function(p) {
    var row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML =
      '<span class="file-icon">&#128214;</span>' +
      '<div class="file-info">' +
        '<div class="file-name">' + esc(p.title) + '</div>' +
        '<div class="file-size">Completed project</div>' +
      '</div>' +
      '<button class="small secondary btn-view-files" data-id="' + esc(p.id) + '">View Files</button>';
    el.appendChild(row);
  });

  el.querySelectorAll('.btn-view-files').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchPanel('projects');
      setTimeout(function() { openProjectDetail(btn.getAttribute('data-id')); }, 100);
    });
  });
}

// Upload
document.getElementById('btnUploadDoc').addEventListener('click', function() {
  document.getElementById('fileUploadInput').click();
});

document.getElementById('fileUploadInput').addEventListener('change', function() {
  var file = this.files[0];
  if (!file) return;
  var formData = new FormData();
  formData.append('file', file);
  showToast('Uploading ' + file.name + '...', 'info');
  apiRaw('POST', '/api/documents/upload', formData).then(function() {
    showToast('Document uploaded!', 'success');
    loadDocuments();
  }).catch(function(e) { showToast('Upload failed: ' + e.message, 'error'); });
  this.value = '';
});

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
// ACTIVITY FEED
// ================================================================
function loadHomeStats() {
  // Word count progress
  api('GET', '/api/agent/status').then(function(data) {
    var count = data.todayWords || 0;
    var goal = data.dailyWordGoal || 1000;
    var pct = Math.min(100, Math.round((count / goal) * 100));
    var countEl = document.getElementById('homeWordCount');
    var goalEl = document.getElementById('homeWordGoal');
    var barEl = document.getElementById('homeWordBar');
    if (countEl) countEl.textContent = count.toLocaleString();
    if (goalEl) goalEl.textContent = goal.toLocaleString();
    if (barEl) {
      barEl.style.width = pct + '%';
      barEl.style.background = pct >= 100 ? 'var(--success)' : 'var(--accent)';
    }
  }).catch(function() {});

  // Idle task count
  api('GET', '/api/autonomous/idle-tasks').then(function(data) {
    var queue = data.queue || [];
    var history = data.history || [];
    var enabled = queue.filter(function(t) { return t.enabled !== false; }).length;
    var countEl = document.getElementById('homeIdleCount');
    var compEl = document.getElementById('homeIdleCompleted');
    if (countEl) countEl.textContent = enabled;
    if (compEl) compEl.textContent = history.length + ' completed';
  }).catch(function() {});
}

function loadActivity() {
  api('GET', '/api/activity?count=15').then(function(data) {
    var feed = document.getElementById('activityFeed');
    var entries = data.entries || [];
    if (!entries.length) { feed.innerHTML = '<div style="color:var(--muted);text-align:center;padding:16px;">No activity yet.</div>'; return; }
    feed.innerHTML = '';
    entries.forEach(function(e) {
      var row = document.createElement('div');
      row.className = 'activity-entry';
      var ago = formatTimeAgo(e.timestamp);
      row.innerHTML = '<div class="activity-dot ' + esc(e.type) + '"></div><div style="flex:1;">' + esc(e.message) + '</div><div class="activity-time">' + esc(ago) + '</div>';
      feed.appendChild(row);
    });
  }).catch(function() {
    document.getElementById('activityFeed').innerHTML = '<div style="color:var(--muted);text-align:center;padding:16px;">Could not load activity.</div>';
  });
}
function formatTimeAgo(iso) {
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}


// ================================================================
// AUTHOR HQ — single-page aggregate of everything in flight
// ================================================================
// Pulls existing endpoints (no backend changes) and renders 4 cards:
// today-at-a-glance, active projects, per-persona breakdown, recent activity.
// Plus optional "what BookClaw knows about you" from the user-model service.
function loadHQ() {
  Promise.all([
    api('GET', '/api/projects').catch(function() { return { projects: [] }; }),
    api('GET', '/api/personas').catch(function() { return { personas: [] }; }),
    api('GET', '/api/activity?limit=12').catch(function() { return { events: [] }; }),
    api('GET', '/api/status').catch(function() { return {}; }),
    api('GET', '/api/user-model').catch(function() { return { snapshot: null }; }),
    api('GET', '/api/memory/stats').catch(function() { return {}; }),
  ]).then(function(results) {
    var projData = results[0];
    var personaData = results[1];
    var activityData = results[2];
    var statusData = results[3];
    var userModelData = results[4];
    var memStats = results[5];

    var projects = projData.projects || [];
    var personas = personaData.personas || [];
    var events = activityData.events || activityData || [];

    // ── At a glance (5 stats) ──
    var active = projects.filter(function(p) { return p.status === 'active'; });
    var completed = projects.filter(function(p) { return p.status === 'completed'; });
    var failed = projects.filter(function(p) { return p.status === 'failed' || p.steps?.some(function(s){return s.status==='failed';}); });
    var totalWords = 0;
    projects.forEach(function(p) {
      (p.steps || []).forEach(function(s) {
        if (s.status === 'completed' && s.result) {
          totalWords += String(s.result).split(/\s+/).filter(Boolean).length;
        }
      });
    });
    var providers = (statusData.providers || []).map(function(p) { return p.id; });

    var glance = document.getElementById('hqGlance');
    if (glance) {
      var statBox = function(label, value, sub) {
        return '<div style="background:var(--bg-secondary);border-radius:8px;padding:12px;">' +
          '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;">' + esc(label) + '</div>' +
          '<div style="font-size:22px;font-weight:700;margin-top:4px;">' + esc(String(value)) + '</div>' +
          (sub ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + esc(sub) + '</div>' : '') +
          '</div>';
      };
      glance.innerHTML =
        statBox('Active projects', active.length, completed.length + ' done · ' + failed.length + ' have failures') +
        statBox('Words on disk', totalWords.toLocaleString(), 'across ' + projects.length + ' project' + (projects.length === 1 ? '' : 's')) +
        statBox('Personas', personas.length, personas.length > 0 ? personas.slice(0, 2).map(function(p){return p.penName||p.name;}).join(', ') + (personas.length > 2 ? ', …' : '') : 'none yet') +
        statBox('AI providers', providers.length, providers.join(', ') || 'configure in Settings') +
        statBox('Memory index', (memStats.totalEntries || 0).toLocaleString(), memStats.available ? 'searchable' : 'unavailable');
    }

    // ── Active projects ──
    var activeEl = document.getElementById('hqActiveProjects');
    var countEl = document.getElementById('hqActiveCount');
    if (countEl) countEl.textContent = active.length === 1 ? '1 in flight' : active.length + ' in flight';
    if (activeEl) {
      if (active.length === 0) {
        activeEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">No active projects. Start one from the <a href="#" onclick="navItems[2].click();return false;">Projects</a> panel.</div>';
      } else {
        activeEl.innerHTML = active.slice(0, 8).map(function(p) {
          var pct = p.progress || 0;
          var stepsTotal = (p.steps || []).length;
          var stepsDone = (p.steps || []).filter(function(s){return s.status==='completed';}).length;
          var activeStep = (p.steps || []).find(function(s){return s.status==='active';});
          return '<div style="padding:10px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:8px;cursor:pointer;" ' +
            'onclick="document.querySelector(\'[data-panel=projects]\').click(); setTimeout(function(){openProjectDetail(\'' + esc(p.id) + '\');}, 100);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<div style="font-weight:600;">' + esc(p.title) + '</div>' +
              '<div style="font-size:11px;color:var(--muted);">' + esc(p.type || 'general') + '</div>' +
            '</div>' +
            '<div style="margin-top:6px;background:var(--card-hover);height:6px;border-radius:3px;overflow:hidden;">' +
              '<div style="background:var(--success);height:100%;width:' + pct + '%;"></div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:4px;">' +
              stepsDone + '/' + stepsTotal + ' steps · ' + pct + '%' +
              (activeStep ? ' · running: ' + esc(activeStep.label || '') : '') +
            '</div>' +
            '</div>';
        }).join('');
      }
    }

    // ── Per-persona breakdown ──
    var personaEl = document.getElementById('hqPersonas');
    if (personaEl) {
      if (personas.length === 0) {
        personaEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">No personas yet. Add one in the Personas panel for per-pen-name memory + voice.</div>';
      } else {
        personaEl.innerHTML = personas.map(function(p) {
          var pen = p.penName || p.name || p.id;
          var theirProjects = projects.filter(function(pr) { return pr.personaId === p.id; });
          var words = 0;
          theirProjects.forEach(function(pr) {
            (pr.steps || []).forEach(function(s) {
              if (s.status === 'completed' && s.result) words += String(s.result).split(/\s+/).filter(Boolean).length;
            });
          });
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px;font-size:13px;">' +
            '<div><strong>' + esc(pen) + '</strong>' +
              (p.genre ? ' <span style="color:var(--muted);">· ' + esc(p.genre) + '</span>' : '') +
            '</div>' +
            '<div style="color:var(--muted);font-size:12px;">' + theirProjects.length + ' project' + (theirProjects.length === 1 ? '' : 's') + ' · ' + words.toLocaleString() + ' words</div>' +
            '</div>';
        }).join('');
      }
    }

    // ── Recent activity ──
    var activityEl = document.getElementById('hqRecentActivity');
    if (activityEl) {
      if (events.length === 0) {
        activityEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">No activity yet. Start writing!</div>';
      } else {
        activityEl.innerHTML = events.slice(0, 12).map(function(e) {
          var when = e.timestamp ? new Date(e.timestamp) : null;
          var ago = when ? humanAgo(when) : '';
          var icon = e.type === 'step_completed' ? '✓' :
                     e.type === 'step_failed' || e.type === 'error' ? '✗' :
                     e.type === 'project_created' ? '+' :
                     e.type === 'file_saved' ? '📄' :
                     e.type === 'preference_detected' ? '💡' : '·';
          return '<div style="display:flex;gap:10px;padding:6px 0;font-size:12px;border-bottom:1px solid var(--border);">' +
            '<div style="width:18px;color:var(--muted);">' + icon + '</div>' +
            '<div style="flex:1;">' + esc(e.message || e.type || 'event') + '</div>' +
            '<div style="color:var(--muted);font-size:11px;white-space:nowrap;">' + ago + '</div>' +
            '</div>';
        }).join('');
      }
    }

    // ── User model narrative ──
    var umCard = document.getElementById('hqUserModelCard');
    var umEl = document.getElementById('hqUserModel');
    if (umCard && umEl) {
      var snap = userModelData.snapshot;
      if (snap && snap.narrative && snap.narrative.text && !snap.narrative.text.startsWith('(narrative not yet')) {
        umCard.style.display = '';
        umEl.innerHTML = '<div>' + esc(snap.narrative.text).replace(/\n/g, '<br>') + '</div>' +
          '<div style="margin-top:10px;font-size:11px;color:var(--muted);">' +
            'Confidence: ' + Math.round((snap.narrative.confidence || 0) * 100) + '% · ' +
            'observations: ' + (snap.observationCount || 0) +
          '</div>';
      } else {
        umCard.style.display = 'none';
      }
    }
  }).catch(function() {
    document.getElementById('hqGlance').innerHTML = '<div style="color:var(--danger);">Could not load HQ data — check the server log.</div>';
  });
}

// Compact relative time formatter for HQ activity feed.
function humanAgo(date) {
  var s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ================================================================
// INITIALIZATION
// ================================================================
renderKeyProviders();
startPolling();

