
// ================================================================
// GLOBALS & STATE
// ================================================================
var API = '';
// Auth token injected by the server into the served HTML. Empty when auth is disabled.
var AUTH_TOKEN = '__BOOKCLAW_AUTH_TOKEN__';
function authHeaders(base) {
  base = base || {};
  if (AUTH_TOKEN) base['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  return base;
}
// For native-element GETs (img/href/Audio) that can't send an Authorization header,
// the server also accepts the token as a ?token= query param.
function authUrl(path) {
  if (!AUTH_TOKEN) return path;
  return path + (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(AUTH_TOKEN);
}
var currentPanel = 'home';
var projectFilter = 'all';
var allProjects = [];
var allPersonas = [];
var allTemplates = [];
var chatWaiting = false;
var statusPollTimer = null;
var projectPollTimer = null;
var currentDetailProject = null;

// ================================================================
// UTILITIES
// ================================================================
function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function showToast(message, type) {
  type = type || 'info';
  document.querySelectorAll('.toast').forEach(function(t) { t.remove(); });
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4500);
}

function api(method, path, body) {
  var opts = { method: method, headers: authHeaders({ 'Content-Type': 'application/json' }) };
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts).then(function(res) {
    var ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      if (ct.indexOf('application/json') !== -1) {
        return res.json().then(function(d) { throw new Error(d.error || ('HTTP ' + res.status)); });
      }
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }
    if (ct.indexOf('application/json') === -1) {
      throw new Error('Server returned non-JSON response');
    }
    return res.json();
  });
}

function apiRaw(method, path, body) {
  var opts = { method: method, headers: authHeaders() };
  if (body) { opts.body = body; }
  return fetch(API + path, opts).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDate(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function avatarColor(name) {
  var colors = ['#e67e22','#2980b9','#8e44ad','#c0392b','#27ae60','#d35400','#2c3e50','#16a085'];
  var hash = 0;
  for (var i = 0; i < (name||'').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name) {
  if (!name) return '?';
  var parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ================================================================
// NAVIGATION
// ================================================================
var panelTitles = { home: 'Home', hq: 'Author HQ', projects: 'Projects', personas: 'Personas', library: 'Library', settings: 'Settings' };
var navItems = document.querySelectorAll('.nav-item');

function switchPanel(name) {
  currentPanel = name;
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
function loadStatus() {
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
    // Fallback: count from allProjects
    if (allProjects.length > 0) {
      activeCount = allProjects.filter(function(p) { return p.status === 'active'; }).length;
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
    document.getElementById('statPersonas').textContent = allPersonas.length || (data.personas ? data.personas.count || 0 : 0);

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
  statusPollTimer = setInterval(loadStatus, 10000);
  projectPollTimer = setInterval(function() {
    if (currentPanel === 'home' || currentPanel === 'projects') {
      loadProjects();
    }
    if (currentPanel === 'home') {
      loadActivity();
      loadHomeStats();
    }
  }, 15000);
}

// ================================================================
// HOME PANEL — Active Project Cards
// ================================================================
function renderHomeProjects() {
  var container = document.getElementById('homeProjectScroll');
  var active = allProjects.filter(function(p) { return p.status === 'active' || p.status === 'paused'; });
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
  if (!text || chatWaiting) return;
  addChatMsg(text, 'user');
  input.value = '';
  chatWaiting = true;
  showTyping();

  api('POST', '/api/chat', { message: text }).then(function(data) {
    removeTyping();
    chatWaiting = false;
    addChatMsg(data.response || 'No response received.', 'bot');
    // Refresh projects if a command might have created/changed one
    if (text.startsWith('/')) { loadProjects(); }
  }).catch(function(e) {
    removeTyping();
    chatWaiting = false;
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
  chatWaiting = false;
});

// ================================================================
// PROJECTS PANEL
// ================================================================

// ── Template Tiles ──
var defaultTemplates = [
  { id: 'book-planning', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>', name: 'Book Planning', desc: 'Outline and plan your book structure', steps: '5-8 steps', type: 'book-planning' },
  { id: 'book-bible', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></svg>', name: 'Book Bible', desc: 'Build your story world bible', steps: '6-10 steps', type: 'book-bible' },
  { id: 'book-production', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>', name: 'Book Production', desc: 'Write chapters from outline to draft', steps: '10-30 steps', type: 'book-production' },
  { id: 'deep-revision', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', name: 'Deep Revision', desc: 'Analyze and revise your manuscript', steps: '8-12 steps', type: 'deep-revision' },
  { id: 'format-export', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>', name: 'Format & Export', desc: 'Format manuscript for publishing', steps: '4-6 steps', type: 'format-export' },
  { id: 'book-launch', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>', name: 'Book Launch', desc: 'Marketing copy and launch materials', steps: '6-10 steps', type: 'book-launch' },
  { id: 'custom', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>', name: 'Custom', desc: 'Describe your project freely', steps: 'AI-planned', type: 'custom' },
  { id: 'pipeline', icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>', name: 'Full Pipeline', desc: 'Complete book pipeline: plan, bible, write, revise, format, launch — all 6 phases from one idea', steps: '30+ steps', type: 'novel-pipeline', highlighted: true, span2: true }
];

function loadTemplates() {
  api('GET', '/api/projects/templates').then(function(data) {
    allTemplates = data.templates || [];
    renderTemplates();
  }).catch(function() {
    allTemplates = [];
    renderTemplates();
  });
}

function renderTemplates() {
  var grid = document.getElementById('templateGrid');
  grid.innerHTML = '';
  // Use defaults, but map in server template data if available
  defaultTemplates.forEach(function(dt) {
    var serverT = allTemplates.find(function(st) { return st.type === dt.type || st.id === dt.id; });
    var tile = document.createElement('div');
    tile.className = 'template-tile' + (dt.highlighted ? ' highlighted' : '') + (dt.span2 ? ' span-2' : '');
    var stepsText = serverT ? (serverT.stepCountLabel || serverT.stepCount + ' steps') : dt.steps;
    tile.innerHTML =
      '<div class="tile-icon">' + dt.icon + '</div>' +
      '<div class="tile-name">' + esc(serverT ? (serverT.label || serverT.title || dt.name) : dt.name) + '</div>' +
      '<div class="tile-desc">' + esc(serverT ? serverT.description : dt.desc) + '</div>' +
      '<div class="tile-steps">' + esc(stepsText) + '</div>';
    tile.addEventListener('click', function() {
      openCreateProjectModal(dt, serverT);
    });
    grid.appendChild(tile);
  });
}

// ── Create Project Modal ──
function openCreateProjectModal(template, serverTemplate) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'createProjectModal';

  var isPipeline = template.type === 'novel-pipeline';
  var isProduction = template.type === 'book-production';
  var isCustom = template.type === 'custom';

  var personaOpts = '<option value="">None</option>';
  allPersonas.forEach(function(p) {
    personaOpts += '<option value="' + esc(p.id) + '">' + esc(p.penName || p.name) + '</option>';
  });

  var extraFields = '';
  if (isProduction || isPipeline) {
    extraFields =
      '<div class="form-group-inline">' +
        '<div class="form-group"><label>Chapters</label><input type="number" id="modalChapters" value="12" min="1" max="100"></div>' +
        '<div class="form-group"><label>Words per Chapter</label><input type="number" id="modalWordsPerCh" value="3000" min="500" max="20000"></div>' +
      '</div>';
  }

  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-title">' + (isCustom ? 'Create Custom Project' : 'Create ' + esc(template.name) + ' Project') + '</div>' +
      '<div class="form-group">' +
        '<label>Title</label>' +
        '<input type="text" id="modalTitle" placeholder="Project title...">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Description</label>' +
        '<textarea id="modalDesc" rows="3" placeholder="Describe what you want to accomplish...">' + esc(isCustom ? '' : (serverTemplate ? serverTemplate.description : template.desc)) + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Persona</label>' +
        '<select id="modalPersona">' + personaOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>AI Model</label>' +
        '<select id="modalProvider">' +
          '<option value="">Auto — smart tiered routing (recommended)</option>' +
          '<option value="gemini">Gemini (free tier)</option>' +
          '<option value="deepseek">DeepSeek (cheap tier)</option>' +
          '<option value="claude">Claude (premium tier)</option>' +
          '<option value="openai">OpenAI GPT (premium tier)</option>' +
          '<option value="ollama">Ollama (local, free)</option>' +
        '</select>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Auto uses free models for research/marketing, mid-tier for writing, premium for final edits. Override to force one model for all steps.</div>' +
      '</div>' +
      extraFields +
      '<div class="modal-actions">' +
        '<button class="secondary" id="modalCancel">Cancel</button>' +
        '<button class="success" id="modalCreate">Create Project</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.querySelector('#modalCancel').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#modalCreate').addEventListener('click', function() {
    var title = document.getElementById('modalTitle').value.trim();
    var desc = document.getElementById('modalDesc').value.trim();
    var persona = document.getElementById('modalPersona').value;
    var provider = document.getElementById('modalProvider').value;
    if (!desc && !title) { showToast('Please enter a title or description', 'error'); return; }

    var body = {
      title: title || desc.slice(0, 60),
      description: desc || title,
      type: isCustom ? undefined : template.type,
      planning: isCustom ? 'dynamic' : undefined,
      personaId: persona || undefined,
      preferredProvider: provider || undefined
    };

    if (isProduction || isPipeline) {
      var chs = parseInt(document.getElementById('modalChapters').value);
      var wpc = parseInt(document.getElementById('modalWordsPerCh').value);
      if (!isNaN(chs)) body.chapters = chs;
      if (!isNaN(wpc)) body.wordsPerChapter = wpc;
    }

    var endpoint = isPipeline ? '/api/pipeline/create' : '/api/projects/create';

    document.getElementById('modalCreate').disabled = true;
    document.getElementById('modalCreate').textContent = 'Creating...';

    api('POST', endpoint, body).then(function(data) {
      overlay.remove();

      // Get the project ID from the response
      var projectId = null;
      if (data.project && data.project.id) {
        projectId = data.project.id;
      } else if (data.phases && data.phases.length > 0) {
        projectId = data.phases[0].id;
      }

      if (projectId) {
        showToast('Project created! Starting execution...', 'success');
        loadProjects();
        // Auto-execute: fire in background, open detail view, poll for progress
        setTimeout(function() {
          openProjectDetail(projectId);
          // Fire auto-execute (this is a long-running request — we don't block on it)
          api('POST', '/api/projects/' + projectId + '/auto-execute').then(function(result) {
            var completed = (result.results || []).filter(function(r) { return r.success; }).length;
            showToast('Project finished! ' + completed + ' steps completed.', 'success');
            loadProjects();
            if (currentDetailProject === projectId) openProjectDetail(projectId);
          }).catch(function(err) {
            showToast('Execution error: ' + err.message, 'error');
            loadProjects();
            if (currentDetailProject === projectId) openProjectDetail(projectId);
          });
          // Poll for step progress while running
          var pollId = setInterval(function() {
            loadProjects();
            if (currentDetailProject === projectId) openProjectDetail(projectId);
          }, 8000);
          setTimeout(function() { clearInterval(pollId); }, 600000); // 10 min max poll
        }, 500);
      } else {
        showToast('Project created!', 'success');
        loadProjects();
      }
    }).catch(function(e) {
      showToast('Failed: ' + e.message, 'error');
      document.getElementById('modalCreate').disabled = false;
      document.getElementById('modalCreate').textContent = 'Create Project';
    });
  });
}

// ── Load Projects ──
function loadProjects() {
  api('GET', '/api/projects/list').then(function(data) {
    allProjects = data.projects || [];
    if (currentPanel === 'projects' && !currentDetailProject) {
      renderProjectList();
    }
    renderHomeProjects();
    // Update active count stat
    var ac = allProjects.filter(function(p) { return p.status === 'active'; }).length;
    document.getElementById('statProjects').textContent = ac;
  }).catch(function() {});
}

// ── Filter Tabs ──
document.querySelectorAll('#projectFilterTabs .filter-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('#projectFilterTabs .filter-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    projectFilter = tab.getAttribute('data-filter');
    renderProjectList();
  });
});

function renderProjectList() {
  var el = document.getElementById('projectList');
  var filtered = allProjects;
  if (projectFilter !== 'all') {
    filtered = allProjects.filter(function(p) { return p.status === projectFilter; });
  }
  if (filtered.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;">No ' + (projectFilter === 'all' ? '' : projectFilter + ' ') + 'projects found.</div>';
    return;
  }
  el.innerHTML = '';
  filtered.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'project-list-card';

    var personaName = '';
    if (p.persona) {
      personaName = typeof p.persona === 'string' ? p.persona : (p.persona.penName || p.persona.name || '');
    }

    var completedSteps = 0;
    var totalSteps = 0;
    if (p.steps) {
      totalSteps = p.steps.length;
      completedSteps = p.steps.filter(function(s) { return s.status === 'completed'; }).length;
    }

    card.innerHTML =
      '<div class="plc-header">' +
        '<span class="plc-title">' + esc(p.title) + '</span>' +
        '<div class="plc-badges">' +
          '<span class="badge badge-type">' + esc(p.type || 'general') + '</span>' +
          (personaName ? '<span class="badge badge-persona">' + esc(personaName) + '</span>' : '') +
          '<span class="badge badge-status badge-' + esc(p.status) + '">' + esc(p.status) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="progress-bar" style="margin-bottom:8px;"><div class="progress-fill" style="width:' + (p.progress || 0) + '%">' + (p.progress || 0) + '%</div></div>' +
      '<div class="plc-info">' + completedSteps + '/' + totalSteps + ' steps' +
        (p.createdAt ? ' &mdash; Created ' + esc(formatDate(p.createdAt)) : '') +
      '</div>';

    // Action buttons
    var actions = document.createElement('div');
    actions.className = 'plc-actions';

    if (p.status === 'pending') {
      actions.innerHTML += '<button class="success small btn-start" data-id="' + esc(p.id) + '">Start</button>';
    }
    if (p.status === 'active') {
      actions.innerHTML +=
        '<button class="success small btn-auto" data-id="' + esc(p.id) + '">Auto-Execute</button>' +
        '<button class="secondary small btn-pause" data-id="' + esc(p.id) + '">Pause</button>';
    }
    if (p.status === 'paused') {
      actions.innerHTML += '<button class="success small btn-resume" data-id="' + esc(p.id) + '">Resume</button>';
    }
    actions.innerHTML += '<button class="danger small btn-delete" data-id="' + esc(p.id) + '">Delete</button>';

    card.appendChild(actions);
    el.appendChild(card);

    // Click title to open detail
    card.querySelector('.plc-title').addEventListener('click', function() {
      openProjectDetail(p.id);
    });
  });

  // Wire action buttons — Start triggers auto-execute (Start alone only marks step active, doesn't run AI)
  el.querySelectorAll('.btn-start').forEach(function(btn) {
    btn.addEventListener('click', function() { projectAction('auto-execute', btn.getAttribute('data-id')); });
  });
  el.querySelectorAll('.btn-auto').forEach(function(btn) {
    btn.addEventListener('click', function() { projectAction('auto-execute', btn.getAttribute('data-id')); });
  });
  el.querySelectorAll('.btn-pause').forEach(function(btn) {
    btn.addEventListener('click', function() { projectAction('pause', btn.getAttribute('data-id')); });
  });
  el.querySelectorAll('.btn-resume').forEach(function(btn) {
    btn.addEventListener('click', function() { projectAction('resume', btn.getAttribute('data-id')); });
  });
  el.querySelectorAll('.btn-delete').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteProject(btn.getAttribute('data-id')); });
  });
}

function projectAction(action, id) {
  var endpoint = '/api/projects/' + id + '/' + action;
  var msg = action === 'auto-execute' ? 'Auto-executing all steps... this may take a while.' : (action.charAt(0).toUpperCase() + action.slice(1) + 'ing project...');
  showToast(msg, 'info');
  api('POST', endpoint).then(function(data) {
    if (action === 'auto-execute') {
      var completed = (data.results || []).filter(function(r) { return r.success; }).length;
      showToast('Auto-execute done! ' + completed + ' steps completed.', 'success');
    } else {
      showToast('Project ' + action + 'd!', 'success');
    }
    loadProjects();
    if (currentDetailProject === id) openProjectDetail(id);
  }).catch(function(e) {
    showToast('Failed: ' + e.message, 'error');
    loadProjects();
  });

  // Poll during auto-execute
  if (action === 'auto-execute') {
    var pollId = setInterval(function() { loadProjects(); }, 8000);
    setTimeout(function() { clearInterval(pollId); }, 300000);
  }
}

function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  api('DELETE', '/api/projects/' + id).then(function() {
    showToast('Project deleted', 'info');
    if (currentDetailProject === id) showProjectList();
    loadProjects();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
}

// ── Project Detail View ──
function showProjectList() {
  currentDetailProject = null;
  document.getElementById('projectTemplatesCard').style.display = '';
  document.getElementById('projectListCard').style.display = '';
  document.getElementById('projectDetailView').style.display = 'none';
}

// Map project types to logical next phases
function getContinuationOptions(type) {
  var map = {
    'book-planning': [
      { type: 'book-bible', label: 'Book Bible', desc: 'World-building, characters, continuity' },
      { type: 'book-production', label: 'Book Production', desc: 'Write chapters with full context' },
    ],
    'book-bible': [
      { type: 'book-production', label: 'Book Production', desc: 'Write chapters with full context' },
    ],
    'book-production': [
      { type: 'deep-revision', label: 'Deep Revision', desc: '21-step editing: macro, scene, line-level' },
    ],
    'deep-revision': [
      { type: 'format-export', label: 'Format & Export', desc: 'Front/back matter, DOCX, EPUB' },
    ],
    'format-export': [
      { type: 'book-launch', label: 'Book Launch', desc: 'Blurb, Amazon desc, keywords, ad copy' },
    ],
  };
  return map[type] || [
    { type: 'book-bible', label: 'Book Bible', desc: 'World-building, characters, continuity' },
    { type: 'book-production', label: 'Book Production', desc: 'Write chapters with full context' },
    { type: 'deep-revision', label: 'Deep Revision', desc: '21-step editing passes' },
    { type: 'format-export', label: 'Format & Export', desc: 'DOCX, EPUB export' },
    { type: 'book-launch', label: 'Book Launch', desc: 'Blurb, keywords, ad copy' },
  ];
}

// Continue a completed project into the next phase
function continueProjectToPhase(sourceProject, targetType) {
  // Build context from completed project steps
  var stepSummaries = [];
  if (sourceProject.steps) {
    sourceProject.steps.forEach(function(s) {
      if (s.status === 'completed' && (s.output || s.result)) {
        var output = (s.output || s.result || '').substring(0, 2000);
        stepSummaries.push('## ' + (s.label || 'Step') + '\n' + output);
      }
    });
  }

  var contextDesc = 'Continuing from completed project: "' + sourceProject.title + '" (' + (sourceProject.type || 'general') + ')\n\n' +
    'Use the following output from the previous phase as your foundation:\n\n' +
    stepSummaries.join('\n\n---\n\n');

  var body = {
    title: sourceProject.title,
    description: contextDesc.substring(0, 30000),
    type: targetType,
    personaId: sourceProject.personaId || (sourceProject.persona && typeof sourceProject.persona === 'object' ? sourceProject.persona.id : undefined),
    preferredProvider: sourceProject.preferredProvider || undefined,
  };

  showToast('Creating ' + targetType + ' project...', 'info');
  api('POST', '/api/projects/create', body).then(function(data) {
    var projectId = data.project && data.project.id;
    if (projectId) {
      showToast('Project created! Starting execution...', 'success');
      loadProjects();
      setTimeout(function() {
        openProjectDetail(projectId);
        api('POST', '/api/projects/' + projectId + '/auto-execute').then(function(result) {
          var completed = (result.results || []).filter(function(r) { return r.success; }).length;
          showToast('Done! ' + completed + ' steps completed.', 'success');
          loadProjects();
          if (currentDetailProject === projectId) openProjectDetail(projectId);
        }).catch(function(err) {
          showToast('Execution error: ' + err.message, 'error');
          loadProjects();
        });
        var pollId = setInterval(function() {
          loadProjects();
          if (currentDetailProject === projectId) openProjectDetail(projectId);
        }, 8000);
        setTimeout(function() { clearInterval(pollId); }, 600000);
      }, 500);
    } else {
      showToast('Project created!', 'success');
      loadProjects();
    }
  }).catch(function(e) {
    showToast('Failed: ' + e.message, 'error');
  });
}

function openProjectDetail(id) {
  var project = allProjects.find(function(p) { return p.id === id; });
  if (!project) { showToast('Project not found', 'error'); return; }

  currentDetailProject = id;
  document.getElementById('projectTemplatesCard').style.display = 'none';
  document.getElementById('projectListCard').style.display = 'none';
  var detail = document.getElementById('projectDetailView');
  detail.style.display = 'block';

  var personaName = '';
  if (project.persona) {
    personaName = typeof project.persona === 'string' ? project.persona : (project.persona.penName || project.persona.name || '');
  }

  var stepsHtml = '';
  var hasFailed = false;
  if (project.steps && project.steps.length > 0) {
    project.steps.forEach(function(s, i) {
      if (s.status === 'failed') hasFailed = true;
      // Per-step retry button: visible for failed/active/completed steps so users
      // can re-run without restarting the whole project.
      var retryBtn = '';
      if (s.status === 'failed' || s.status === 'active' || s.status === 'completed') {
        retryBtn = '<button class="small pd-retry-step" data-step-id="' + esc(s.id) + '" data-step-label="' + esc(s.label || '') + '" ' +
          'style="font-size:10px;padding:3px 8px;margin-left:4px;" ' +
          'title="Reset this step to pending so it can be re-run">' + (s.status === 'failed' ? 'Retry' : 'Re-run') + '</button>';
      }
      // Per-step model picker: provider dropdown ("Inherit" = project/tier
      // default) + optional exact model id (needed for OpenRouter ids).
      var ov = s.modelOverride || {};
      var provOpts = ['', 'gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'].map(function(p) {
        var label = p === '' ? 'Inherit (default)' : p;
        return '<option value="' + p + '"' + (ov.provider === p ? ' selected' : '') + '>' + label + '</option>';
      }).join('');
      var ctlStyle = 'font-size:10px;padding:2px 4px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;';
      var modelCtl =
        '<div class="step-model-ctl" style="margin-top:5px;display:flex;gap:6px;align-items:center;">' +
          '<select class="pd-step-provider" data-step-id="' + esc(s.id) + '" style="' + ctlStyle + '">' + provOpts + '</select>' +
          '<input class="pd-step-model" data-step-id="' + esc(s.id) + '" value="' + esc(ov.model || '') + '" placeholder="model id (optional)" style="' + ctlStyle + 'flex:1;max-width:220px;">' +
        '</div>';
      stepsHtml +=
        '<div class="step-item" data-step-idx="' + i + '">' +
          '<span class="step-dot ' + esc(s.status) + '"></span>' +
          '<div style="flex:1;">' +
            '<div>' + esc(s.label || s.name || 'Step ' + (i+1)) + '</div>' +
            '<div style="font-size:11px;color:var(--muted);">' + esc(s.status) + (s.error ? ' - ' + esc(s.error.slice(0, 120)) : '') + '</div>' +
            modelCtl +
          '</div>' +
          '<span class="badge badge-' + esc(s.status) + '" style="font-size:10px;">' + esc(s.status) + '</span>' +
          retryBtn +
        '</div>' +
        '<div class="step-output" id="stepOutput' + i + '">' + esc(s.output || s.result || 'No output available.') + '</div>';
    });
  }

  var actionsHtml = '';
  if (project.status === 'pending') {
    actionsHtml += '<button class="success" id="pdStart">Start Project</button> ';
  }
  if (project.status === 'active') {
    actionsHtml += '<button class="success" id="pdAuto">Auto-Execute All</button> ';
    actionsHtml += '<button class="secondary" id="pdPause">Pause</button> ';
  }
  if (project.status === 'paused') {
    actionsHtml += '<button class="success" id="pdResume">Resume</button> ';
  }
  actionsHtml += '<button id="pdCompile">Compile Files</button> ';

  // Restart options — visible whenever the project has any non-pending state.
  // Two flavors:
  //   "Restart Failed Steps" — only resets failed/active steps, keeps completed work
  //   "Restart Project (clean)" — wipes everything including completed steps and output files
  var canRestart = project.status !== 'pending' || hasFailed;
  if (canRestart) {
    actionsHtml += '<button class="warning" id="pdRestartFailed" title="Reset only failed/active steps to pending. Completed work is kept.">' +
      'Restart Failed Steps' +
      (hasFailed ? ' <span style="background:#ef4444;color:white;border-radius:8px;padding:1px 6px;font-size:10px;margin-left:4px;">⚠</span>' : '') +
      '</button> ';
    actionsHtml += '<button class="danger" id="pdRestartClean" title="Reset everything to pending and delete all output files. Cannot be undone.">Restart Project (clean)</button> ';
  }

  // "Continue to..." button for completed projects
  if (project.status === 'completed') {
    var nextPhases = getContinuationOptions(project.type);
    if (nextPhases.length > 0) {
      actionsHtml += '<div style="display:inline-block;position:relative;">' +
        '<button class="success" id="pdContinue">Continue to &rarr;</button>' +
        '<div id="pdContinueMenu" style="display:none;position:absolute;top:calc(100% + 4px);left:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 0;min-width:240px;z-index:1000;box-shadow:0 4px 16px rgba(0,0,0,0.4);">';
      nextPhases.forEach(function(phase) {
        actionsHtml += '<div class="continue-option" data-type="' + esc(phase.type) + '" style="padding:10px 16px;cursor:pointer;font-size:13px;transition:background 0.15s;">' +
          '<strong>' + esc(phase.label) + '</strong><br>' +
          '<span style="font-size:11px;color:var(--muted);">' + esc(phase.desc) + '</span>' +
        '</div>';
      });
      actionsHtml += '</div></div> ';
    }
  }

  actionsHtml += '<button class="danger" id="pdDelete">Delete Project</button>';

  detail.innerHTML =
    '<div class="project-detail">' +
      '<div class="pd-back" id="pdBack">&#8592; Back to Projects</div>' +
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">' +
          '<h3 style="font-size:20px;font-weight:700;">' + esc(project.title) + '</h3>' +
          '<div style="display:flex;gap:6px;">' +
            '<span class="badge badge-type">' + esc(project.type || 'general') + '</span>' +
            (personaName ? '<span class="badge badge-persona">' + esc(personaName) + '</span>' : '') +
            '<select id="pdProviderSelect" style="font-size:11px;padding:2px 6px;border-radius:6px;background:var(--surface);color:var(--text);border:1px solid var(--border);cursor:pointer;">' +
              '<option value=""' + (!project.preferredProvider ? ' selected' : '') + '>Auto</option>' +
              '<option value="ollama"' + (project.preferredProvider === 'ollama' ? ' selected' : '') + '>Ollama</option>' +
              '<option value="gemini"' + (project.preferredProvider === 'gemini' ? ' selected' : '') + '>Gemini</option>' +
              '<option value="deepseek"' + (project.preferredProvider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
              '<option value="openrouter"' + (project.preferredProvider === 'openrouter' ? ' selected' : '') + '>OpenRouter</option>' +
              '<option value="claude"' + (project.preferredProvider === 'claude' ? ' selected' : '') + '>Claude</option>' +
              '<option value="openai"' + (project.preferredProvider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '</select>' +
            '<span class="badge badge-status badge-' + esc(project.status) + '">' + esc(project.status) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="progress-bar" style="margin-bottom:12px;"><div class="progress-fill" style="width:' + (project.progress || 0) + '%">' + (project.progress || 0) + '%</div></div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' + actionsHtml + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border);">' +
        '<button class="pd-tab active" data-tab="steps" style="padding:10px 20px;background:none;border:none;color:var(--text);font-weight:700;cursor:pointer;border-bottom:2px solid var(--accent);margin-bottom:-2px;font-size:13px;">Steps</button>' +
        '<button class="pd-tab" data-tab="context" style="padding:10px 20px;background:none;border:none;color:var(--muted);font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;">Context</button>' +
        '<button class="pd-tab" data-tab="continuity" style="padding:10px 20px;background:none;border:none;color:var(--muted);font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:13px;">Continuity</button>' +
      '</div>' +
      '<div class="card pd-tab-content" id="pdTabSteps">' +
        '<div class="card-title">Steps</div>' +
        '<div class="step-list">' + stepsHtml + '</div>' +
      '</div>' +
      '<div class="card pd-tab-content" id="pdTabContext" style="display:none;">' +
        '<div class="card-title">Story Context</div>' +
        '<div id="pdContextContent" style="color:var(--muted);font-size:13px;">Loading...</div>' +
      '</div>' +
      '<div class="card pd-tab-content" id="pdTabContinuity" style="display:none;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '<div class="card-title" style="margin-bottom:0;">Continuity Report</div>' +
          '<button class="success" id="pdRunContinuity" style="font-size:12px;padding:6px 14px;">Run Check</button>' +
        '</div>' +
        '<div id="pdContinuityContent" style="color:var(--muted);font-size:13px;">No report yet. Click "Run Check" to scan for inconsistencies.</div>' +
      '</div>' +
      '<div class="card" id="pdFilePanel">' +
        '<div class="card-title">Project Files</div>' +
        '<div id="pdFiles" style="color:var(--muted);">Loading files...</div>' +
      '</div>' +
    '</div>';

  // Wire back button
  detail.querySelector('#pdBack').addEventListener('click', showProjectList);

  // Wire action buttons
  var pdStart = detail.querySelector('#pdStart');
  if (pdStart) pdStart.addEventListener('click', function() { projectAction('auto-execute', id); });
  var pdAuto = detail.querySelector('#pdAuto');
  if (pdAuto) pdAuto.addEventListener('click', function() { projectAction('auto-execute', id); });
  var pdPause = detail.querySelector('#pdPause');
  if (pdPause) pdPause.addEventListener('click', function() { projectAction('pause', id); });
  var pdResume = detail.querySelector('#pdResume');
  if (pdResume) pdResume.addEventListener('click', function() { projectAction('resume', id); });
  var pdDelete = detail.querySelector('#pdDelete');
  if (pdDelete) pdDelete.addEventListener('click', function() { deleteProject(id); });
  // Wire provider change
  var pdProviderSelect = detail.querySelector('#pdProviderSelect');
  if (pdProviderSelect) {
    pdProviderSelect.addEventListener('change', function() {
      var newProvider = pdProviderSelect.value;
      api('POST', '/api/projects/' + id + '/provider', { provider: newProvider }).then(function() {
        showToast(newProvider ? 'Provider set to ' + newProvider : 'Provider set to Auto', 'success');
      }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
    });
  }
  var pdCompile = detail.querySelector('#pdCompile');
  if (pdCompile) pdCompile.addEventListener('click', function() { compileProject(id); });

  // Per-step retry / re-run buttons
  detail.querySelectorAll('.pd-retry-step').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var stepId = btn.getAttribute('data-step-id');
      var stepLabel = btn.getAttribute('data-step-label') || stepId;
      var deleteFile = confirm('Retry step "' + stepLabel + '"?\n\nClick OK to retry AND delete the previous output file.\nClick Cancel to keep the previous output file (it will be overwritten on retry).');
      api('POST', '/api/projects/' + id + '/steps/' + stepId + '/retry',
          { deleteOutputFile: deleteFile }).then(function() {
        showToast('Step reset to pending. Click Auto-Execute to run it.', 'success');
        if (currentDetailProject === id) openProjectDetail(id);
      }).catch(function(e2) { showToast('Retry failed: ' + e2.message, 'error'); });
    });
  });

  // Wire per-step model pickers (provider dropdown + optional model id).
  // POSTs on change (not per keystroke) and does NOT re-render, so focus and
  // the step's open/closed output are preserved.
  function saveStepModel(stepId) {
    var prov = detail.querySelector('.pd-step-provider[data-step-id="' + stepId + '"]');
    var modelEl = detail.querySelector('.pd-step-model[data-step-id="' + stepId + '"]');
    var provider = prov ? prov.value : '';
    var model = modelEl ? modelEl.value.trim() : '';
    api('POST', '/api/projects/' + id + '/steps/' + stepId + '/model', { provider: provider, model: model })
      .then(function() {
        showToast(provider ? ('Step model: ' + provider + (model ? ' / ' + model : ' (default model)')) : 'Step model cleared — inherits default', 'success');
      })
      .catch(function(e2) { showToast('Set model failed: ' + e2.message, 'error'); });
  }
  detail.querySelectorAll('.pd-step-provider').forEach(function(sel) {
    sel.addEventListener('click', function(e) { e.stopPropagation(); });
    sel.addEventListener('change', function(e) {
      e.stopPropagation();
      // Clearing the provider (Inherit) also clears any stale model text.
      if (!sel.value) {
        var m = detail.querySelector('.pd-step-model[data-step-id="' + sel.getAttribute('data-step-id') + '"]');
        if (m) m.value = '';
      }
      saveStepModel(sel.getAttribute('data-step-id'));
    });
  });
  detail.querySelectorAll('.pd-step-model').forEach(function(inp) {
    inp.addEventListener('click', function(e) { e.stopPropagation(); });
    inp.addEventListener('change', function(e) {  // fires on blur / Enter
      e.stopPropagation();
      saveStepModel(inp.getAttribute('data-step-id'));
    });
  });

  // Restart Failed Steps — reset failed/active steps to pending, keep completed
  var pdRestartFailed = detail.querySelector('#pdRestartFailed');
  if (pdRestartFailed) {
    pdRestartFailed.addEventListener('click', function() {
      if (!confirm('Reset all failed and active steps to pending? Completed work will be kept.')) return;
      api('POST', '/api/projects/' + id + '/restart',
          { keepCompleted: true, deleteOutputFiles: false }).then(function(data) {
        showToast('Reset ' + (data.reset?.length || 0) + ' step(s). Click Auto-Execute to continue.', 'success');
        if (currentDetailProject === id) openProjectDetail(id);
      }).catch(function(e) { showToast('Restart failed: ' + e.message, 'error'); });
    });
  }

  // Restart Project (clean) — full reset including completed steps + delete files
  var pdRestartClean = detail.querySelector('#pdRestartClean');
  if (pdRestartClean) {
    pdRestartClean.addEventListener('click', function() {
      if (!confirm('Reset EVERY step to pending and DELETE ALL output files?\n\nThis will wipe completed chapters, drafts, and analyses for this project. Cannot be undone.')) return;
      api('POST', '/api/projects/' + id + '/restart',
          { keepCompleted: false, deleteOutputFiles: true }).then(function(data) {
        showToast('Project fully reset. ' + (data.reset?.length || 0) + ' step(s) cleared.', 'info');
        if (currentDetailProject === id) openProjectDetail(id);
      }).catch(function(e) { showToast('Restart failed: ' + e.message, 'error'); });
    });
  }

  // Wire "Continue to..." button
  var pdContinue = detail.querySelector('#pdContinue');
  if (pdContinue) {
    pdContinue.addEventListener('click', function(e) {
      e.stopPropagation();
      var menu = detail.querySelector('#pdContinueMenu');
      var isVisible = menu.style.display !== 'none';
      menu.style.display = isVisible ? 'none' : 'block';
      // Add outside-click listener each time menu opens
      if (!isVisible) {
        setTimeout(function() {
          var closeHandler = function(evt) {
            if (!menu.contains(evt.target) && evt.target !== pdContinue) {
              menu.style.display = 'none';
              document.removeEventListener('click', closeHandler);
            }
          };
          document.addEventListener('click', closeHandler);
        }, 10);
      }
    });
    detail.querySelectorAll('.continue-option').forEach(function(opt) {
      opt.addEventListener('mouseenter', function() { opt.style.background = 'var(--hover)'; });
      opt.addEventListener('mouseleave', function() { opt.style.background = 'none'; });
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        detail.querySelector('#pdContinueMenu').style.display = 'none';
        continueProjectToPhase(project, opt.getAttribute('data-type'));
      });
    });
  }

  // Wire step output toggle
  detail.querySelectorAll('.step-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var idx = item.getAttribute('data-step-idx');
      var out = document.getElementById('stepOutput' + idx);
      if (out) out.classList.toggle('open');
    });
  });

  // Wire tabs
  detail.querySelectorAll('.pd-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      detail.querySelectorAll('.pd-tab').forEach(function(t) {
        t.style.color = 'var(--muted)';
        t.style.borderBottomColor = 'transparent';
        t.style.fontWeight = '600';
      });
      tab.style.color = 'var(--text)';
      tab.style.borderBottomColor = 'var(--accent)';
      tab.style.fontWeight = '700';

      var tabName = tab.getAttribute('data-tab');
      detail.querySelectorAll('.pd-tab-content').forEach(function(c) { c.style.display = 'none'; });
      var target = detail.querySelector('#pdTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
      if (target) target.style.display = 'block';

      // Lazy load data
      if (tabName === 'context' && !detail._contextLoaded) {
        detail._contextLoaded = true;
        loadProjectContext(id);
      }
      if (tabName === 'continuity' && !detail._continuityLoaded) {
        detail._continuityLoaded = true;
        loadContinuityReport(id);
      }
    });
  });

  // Wire continuity run button
  var pdRunCont = detail.querySelector('#pdRunContinuity');
  if (pdRunCont) {
    pdRunCont.addEventListener('click', function() {
      pdRunCont.disabled = true;
      pdRunCont.textContent = 'Running...';
      showToast('Continuity check started...', 'info');
      api('POST', '/api/projects/' + id + '/continuity-check').then(function() {
        // Poll for completion
        var pollCount = 0;
        var pollId = setInterval(function() {
          pollCount++;
          api('GET', '/api/projects/' + id + '/continuity-report').then(function(data) {
            if (data.report) {
              clearInterval(pollId);
              pdRunCont.disabled = false;
              pdRunCont.textContent = 'Run Check';
              renderContinuityReport(data.report);
              showToast('Continuity check complete! Found ' + data.report.totalIssues + ' issue(s).', 'success');
            }
          });
          if (pollCount > 60) { // 5 minutes max
            clearInterval(pollId);
            pdRunCont.disabled = false;
            pdRunCont.textContent = 'Run Check';
            showToast('Continuity check timed out. Check again later.', 'error');
          }
        }, 5000);
      }).catch(function(e) {
        pdRunCont.disabled = false;
        pdRunCont.textContent = 'Run Check';
        showToast('Failed: ' + e.message, 'error');
      });
    });
  }

  // Load files
  loadProjectFiles(id);
}

function loadProjectFiles(id) {
  api('GET', '/api/projects/' + id + '/files').then(function(data) {
    var el = document.getElementById('pdFiles');
    if (!data.files || data.files.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);">No output files yet.</div>';
      return;
    }
    el.innerHTML = '';
    data.files.forEach(function(f) {
      var isMd = f.type === 'md' || (f.name && f.name.endsWith('.md'));
      var isImage = f.name && (f.name.endsWith('.png') || f.name.endsWith('.jpg') || f.name.endsWith('.jpeg'));
      var iconSvg = isImage
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        : isMd
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      var row = document.createElement('div');
      row.className = 'file-row';
      var docxBtn = isMd
        ? '<button class="small secondary btn-export-docx" data-project="' + esc(id) + '" data-file="' + esc(f.name) + '" style="font-size:11px;padding:3px 8px;margin-right:6px;" title="Export as Word document">DOCX</button>'
        : '';
      var thumbHtml = isImage
        ? '<div style="margin:6px 0;"><img src="' + authUrl('/api/projects/' + encodeURIComponent(id) + '/download/' + encodeURIComponent(f.name)) + '" style="max-width:200px;max-height:280px;border-radius:6px;border:1px solid var(--border);"></div>'
        : '';
      row.innerHTML =
        '<span class="file-icon" style="display:flex;align-items:center;color:var(--accent);">' + iconSvg + '</span>' +
        '<div class="file-info">' +
          '<div class="file-name">' + esc(f.name) + '</div>' +
          '<div class="file-size">' + formatBytes(f.size || 0) + '</div>' +
          thumbHtml +
        '</div>' +
        '<div style="display:flex;align-items:center;">' +
          docxBtn +
          '<a class="file-dl" href="' + authUrl('/api/projects/' + encodeURIComponent(id) + '/download/' + encodeURIComponent(f.name)) + '" download="' + esc(f.name) + '">Download</a>' +
        '</div>';
      el.appendChild(row);
    });

    // Wire DOCX export buttons
    el.querySelectorAll('.btn-export-docx').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var projectId = btn.getAttribute('data-project');
        var filename = btn.getAttribute('data-file');
        btn.textContent = 'Exporting...';
        btn.disabled = true;
        api('POST', '/api/projects/' + encodeURIComponent(projectId) + '/export-docx', { filename: filename }).then(function(data) {
          if (data.downloadUrl) {
            var a = document.createElement('a');
            a.href = data.downloadUrl;
            a.download = filename.replace(/\.md$/i, '.docx');
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast('DOCX downloaded!', 'success');
          } else {
            showToast(data.error || 'Export failed', 'error');
          }
          btn.textContent = 'DOCX';
          btn.disabled = false;
        }).catch(function(e) {
          showToast('DOCX export failed: ' + e.message, 'error');
          btn.textContent = 'DOCX';
          btn.disabled = false;
        });
      });
    });
  }).catch(function(e) {
    var el = document.getElementById('pdFiles');
    if (el) el.innerHTML = '<div style="color:var(--muted);">Could not load files.</div>';
  });
}

function compileProject(id) {
  showToast('Compiling project files...', 'info');
  api('POST', '/api/projects/' + id + '/compile').then(function(data) {
    if (data.success) {
      showToast('Compiled! ' + (data.sections || 0) + ' sections, ~' + ((data.totalWords || 0).toLocaleString()) + ' words. Files: ' + (data.files || []).join(', '), 'success');
      loadProjectFiles(id);
    } else {
      showToast(data.error || 'Compile failed', 'error');
    }
  }).catch(function(e) { showToast('Compile failed: ' + e.message, 'error'); });
}

// ================================================================
// CONTEXT & CONTINUITY
// ================================================================

function loadProjectContext(projectId) {
  var el = document.getElementById('pdContextContent');
  if (!el) return;
  api('GET', '/api/projects/' + projectId + '/context').then(function(data) {
    if ((!data.summaries || data.summaries.length === 0) && (!data.entities || data.entities.length === 0)) {
      el.innerHTML = '<span style="color:var(--muted);">No context data yet. Context is built automatically as project steps complete.</span>';
      return;
    }
    var html = '';

    // Chapter summaries
    if (data.summaries && data.summaries.length > 0) {
      html += '<h4 style="font-size:14px;margin-bottom:10px;color:var(--text);">Chapter Summaries (' + data.summaries.length + ')</h4>';
      data.summaries.forEach(function(s) {
        html += '<div style="margin-bottom:12px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;">' +
          '<div style="font-weight:700;font-size:13px;margin-bottom:4px;">' + esc(s.title || ('Chapter ' + s.chapterNumber)) + '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">' +
            (s.timelineMarker ? '\ud83d\udd50 ' + esc(s.timelineMarker) + ' \u00b7 ' : '') +
            (s.characters ? s.characters.length + ' characters \u00b7 ' : '') +
            (s.locations ? s.locations.length + ' locations' : '') +
          '</div>' +
          '<div style="font-size:12px;line-height:1.5;">' + esc(s.summary || '').substring(0, 300) + (s.summary && s.summary.length > 300 ? '...' : '') + '</div>' +
        '</div>';
      });
    }

    // Entity index
    if (data.entities && data.entities.length > 0) {
      html += '<h4 style="font-size:14px;margin:16px 0 10px;color:var(--text);">Entity Index (' + data.entities.length + ')</h4>';
      var byType = {};
      data.entities.forEach(function(e) {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      });
      var typeIcons = { character: '\ud83d\udc64', location: '\ud83d\udccd', item: '\ud83d\udd2e', event: '\ud83d\udcc5', rule: '\ud83d\udcdc' };
      Object.keys(byType).forEach(function(type) {
        html += '<div style="margin-bottom:10px;">' +
          '<div style="font-weight:600;font-size:12px;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">' + (typeIcons[type] || '\u2022') + ' ' + esc(type) + 's (' + byType[type].length + ')</div>';
        byType[type].forEach(function(e) {
          var attrs = e.attributes ? Object.entries(e.attributes).map(function(kv) { return esc(kv[0]) + ': ' + esc(kv[1]); }).join(', ') : '';
          html += '<div style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:4px;font-size:12px;">' +
            '<strong>' + esc(e.name) + '</strong>' +
            (e.aliases && e.aliases.length ? ' <span style="color:var(--muted);">(' + e.aliases.map(esc).join(', ') + ')</span>' : '') +
            (e.description ? ' \u2014 ' + esc(e.description).substring(0, 150) : '') +
            (attrs ? '<div style="color:var(--muted);margin-top:2px;">' + attrs + '</div>' : '') +
            (e.changes && e.changes.length ? '<div style="color:var(--warning);margin-top:2px;font-size:11px;">\u26a0 ' + e.changes.length + ' change(s) tracked</div>' : '') +
          '</div>';
        });
        html += '</div>';
      });
    }

    el.innerHTML = html;
  }).catch(function(err) {
    el.innerHTML = '<span style="color:var(--danger);">Failed to load context: ' + esc(err.message) + '</span>';
  });
}

function loadContinuityReport(projectId) {
  api('GET', '/api/projects/' + projectId + '/continuity-report').then(function(data) {
    if (data.report) renderContinuityReport(data.report);
  });
}

function renderContinuityReport(report) {
  var el = document.getElementById('pdContinuityContent');
  if (!el || !report) return;

  if (report.totalIssues === 0) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--success);"><div style="font-size:32px;margin-bottom:8px;">\u2705</div><strong>No issues found!</strong><br><span style="font-size:12px;color:var(--muted);">Your manuscript looks consistent.</span></div>';
    return;
  }

  var html = '';
  // Summary bar
  var errors = report.issues.filter(function(i) { return i.severity === 'error'; }).length;
  var warnings = report.issues.filter(function(i) { return i.severity === 'warning'; }).length;
  var infos = report.issues.filter(function(i) { return i.severity === 'info'; }).length;

  html += '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">';
  if (errors) html += '<div style="padding:8px 14px;background:rgba(231,76,60,0.15);border-radius:6px;font-size:13px;font-weight:600;">\ud83d\udd34 ' + errors + ' Error' + (errors > 1 ? 's' : '') + '</div>';
  if (warnings) html += '<div style="padding:8px 14px;background:rgba(241,196,15,0.15);border-radius:6px;font-size:13px;font-weight:600;">\ud83d\udfe1 ' + warnings + ' Warning' + (warnings > 1 ? 's' : '') + '</div>';
  if (infos) html += '<div style="padding:8px 14px;background:rgba(52,152,219,0.15);border-radius:6px;font-size:13px;font-weight:600;">\u2139\ufe0f ' + infos + ' Info</div>';
  html += '</div>';

  // Issues grouped by category
  var categories = {};
  report.issues.forEach(function(issue) {
    if (!categories[issue.category]) categories[issue.category] = [];
    categories[issue.category].push(issue);
  });

  var catLabels = { character: '\ud83d\udc64 Character', timeline: '\ud83d\udd50 Timeline', setting: '\ud83d\udccd Setting', naming: '\ud83d\udcdd Naming', plot_thread: '\ud83e\uddf5 Plot Thread' };

  Object.keys(categories).forEach(function(cat) {
    html += '<div style="margin-bottom:16px;">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">' + (catLabels[cat] || esc(cat)) + ' (' + categories[cat].length + ')</div>';

    categories[cat].forEach(function(issue) {
      var severityColor = issue.severity === 'error' ? 'var(--danger)' : issue.severity === 'warning' ? '#f1c40f' : 'var(--muted)';
      html += '<div style="padding:10px;background:var(--bg);border-left:3px solid ' + severityColor + ';border-radius:4px;margin-bottom:6px;font-size:12px;">' +
        '<div style="font-weight:600;margin-bottom:4px;">' + esc(issue.description) + '</div>' +
        (issue.chapters && issue.chapters.length ? '<div style="color:var(--muted);margin-bottom:4px;">Chapters: ' + issue.chapters.map(esc).join(', ') + '</div>' : '') +
        (issue.evidence && issue.evidence.length ? '<div style="font-style:italic;color:var(--muted);margin-bottom:4px;">"' + issue.evidence.map(esc).join('" vs "') + '"</div>' : '') +
        (issue.suggestion ? '<div style="color:var(--success);">\ud83d\udca1 ' + esc(issue.suggestion) + '</div>' : '') +
      '</div>';
    });
    html += '</div>';
  });

  html += '<div style="font-size:11px;color:var(--muted);margin-top:12px;">Generated: ' + esc(report.generatedAt || '') + '</div>';

  el.innerHTML = html;
}

// ================================================================
// PERSONAS PANEL
// ================================================================
function loadPersonas() {
  api('GET', '/api/personas').then(function(data) {
    allPersonas = data.personas || data || [];
    if (Array.isArray(data) && !data.personas) allPersonas = data;
    renderPersonas();
    document.getElementById('statPersonas').textContent = allPersonas.length;
  }).catch(function() {
    allPersonas = [];
    renderPersonas();
  });
}

function renderPersonas() {
  var grid = document.getElementById('personaGrid');
  grid.innerHTML = '';

  allPersonas.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'persona-card';
    var name = p.penName || p.name || 'Unnamed';
    var color = avatarColor(name);
    var tags = '';
    if (p.styleMarkers && p.styleMarkers.length > 0) {
      var markers = typeof p.styleMarkers === 'string' ? p.styleMarkers.split(',') : p.styleMarkers;
      markers.slice(0, 5).forEach(function(t) {
        tags += '<span class="pa-tag">' + esc(t.trim()) + '</span>';
      });
    }

    card.innerHTML =
      '<div class="pa-top">' +
        '<div class="persona-avatar" style="background:' + color + ';">' + esc(initials(name)) + '</div>' +
        '<div>' +
          '<div class="pa-name">' + esc(name) + '</div>' +
          '<div class="pa-genre">' + esc((p.genre || '') + (p.subgenre ? ' / ' + p.subgenre : '')) + '</div>' +
        '</div>' +
      '</div>' +
      (tags ? '<div class="pa-tags">' + tags + '</div>' : '') +
      (p.ttsVoice ? '<div class="pa-voice">Voice: ' + esc(p.ttsVoice) + '</div>' : '') +
      '<div class="pa-actions">' +
        '<button class="small secondary btn-edit-persona" data-id="' + esc(p.id) + '">Edit</button>' +
        '<button class="small danger btn-del-persona" data-id="' + esc(p.id) + '">Delete</button>' +
      '</div>';
    grid.appendChild(card);
  });

  // "Create New" card
  var newCard = document.createElement('div');
  newCard.className = 'persona-card persona-new';
  newCard.innerHTML = '<div class="plus">+</div><div class="plus-label">Create New Persona</div>';
  newCard.addEventListener('click', function() { openPersonaModal(null); });
  grid.appendChild(newCard);

  // Wire edit/delete
  grid.querySelectorAll('.btn-edit-persona').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var p = allPersonas.find(function(x) { return x.id === btn.getAttribute('data-id'); });
      if (p) openPersonaModal(p);
    });
  });
  grid.querySelectorAll('.btn-del-persona').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deletePersona(btn.getAttribute('data-id'));
    });
  });
}

function openPersonaModal(persona) {
  var isEdit = !!persona;
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'personaModal';

  var markers = '';
  if (persona && persona.styleMarkers) {
    markers = Array.isArray(persona.styleMarkers) ? persona.styleMarkers.join(', ') : persona.styleMarkers;
  }

  overlay.innerHTML =
    '<div class="modal">' +
      '<div class="modal-title">' + (isEdit ? 'Edit Persona' : 'Create New Persona') + '</div>' +
      '<div class="form-group">' +
        '<label>Pen Name</label>' +
        '<input type="text" id="pmName" value="' + esc(persona ? (persona.penName || persona.name || '') : '') + '" placeholder="Author pen name...">' +
      '</div>' +
      '<div class="form-group-inline">' +
        '<div class="form-group"><label>Genre</label><input type="text" id="pmGenre" value="' + esc(persona ? persona.genre || '' : '') + '" placeholder="e.g. Fantasy"></div>' +
        '<div class="form-group"><label>Subgenre</label><input type="text" id="pmSubgenre" value="' + esc(persona ? persona.subgenre || '' : '') + '" placeholder="e.g. Epic Fantasy"></div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Voice Description</label>' +
        '<textarea id="pmVoice" rows="3" placeholder="Describe the writing voice...">' + esc(persona ? persona.voiceDescription || '' : '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Style Markers (comma-separated)</label>' +
        '<input type="text" id="pmMarkers" value="' + esc(markers) + '" placeholder="e.g. lyrical, dark, atmospheric">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>TTS Voice</label>' +
        '<select id="pmTTS">' +
          '<option value="">None</option>' +
          '<option value="narrator_female"' + (persona && persona.ttsVoice === 'narrator_female' ? ' selected' : '') + '>Narrator Female — Versatile, expressive</option>' +
          '<option value="narrator_male"' + (persona && persona.ttsVoice === 'narrator_male' ? ' selected' : '') + '>Narrator Male — Literary fiction, thrillers</option>' +
          '<option value="narrator_deep"' + (persona && persona.ttsVoice === 'narrator_deep' ? ' selected' : '') + '>Narrator Deep — Epic fantasy, sci-fi</option>' +
          '<option value="narrator_warm"' + (persona && persona.ttsVoice === 'narrator_warm' ? ' selected' : '') + '>Narrator Warm — Romance, memoir</option>' +
          '<option value="british_male"' + (persona && persona.ttsVoice === 'british_male' ? ' selected' : '') + '>British Male — Period pieces, cozy mysteries</option>' +
          '<option value="british_female"' + (persona && persona.ttsVoice === 'british_female' ? ' selected' : '') + '>British Female — Elegant literary fiction</option>' +
          '<option value="storyteller"' + (persona && persona.ttsVoice === 'storyteller' ? ' selected' : '') + '>Storyteller — Adventure, YA</option>' +
          '<option value="snarky_nerd"' + (persona && persona.ttsVoice === 'snarky_nerd' ? ' selected' : '') + '>Snarky Nerd — Witty banter, smart humor, sci-fi</option>' +
          '<option value="curious_kid"' + (persona && persona.ttsVoice === 'curious_kid' ? ' selected' : '') + '>Curious Kid — Full of wonder, MG, whimsical</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Bio</label>' +
        '<textarea id="pmBio" rows="3" placeholder="Author biography...">' + esc(persona ? persona.bio || '' : '') + '</textarea>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Also By (comma-separated book titles)</label>' +
        '<input type="text" id="pmAlsoBy" value="' + esc(persona && persona.alsoBy ? (Array.isArray(persona.alsoBy) ? persona.alsoBy.join(', ') : persona.alsoBy) : '') + '" placeholder="Book Title 1, Book Title 2">' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="secondary" id="pmGenerate">Generate with AI</button>' +
        '<button class="secondary" id="pmCancel">Cancel</button>' +
        '<button class="success" id="pmSave">' + (isEdit ? 'Update' : 'Create') + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.querySelector('#pmCancel').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  // Generate with AI
  overlay.querySelector('#pmGenerate').addEventListener('click', function() {
    var genre = document.getElementById('pmGenre').value.trim();
    var desc = document.getElementById('pmVoice').value.trim();
    if (!genre && !desc) { showToast('Enter a genre or voice description first', 'error'); return; }
    showToast('Generating persona with AI...', 'info');
    api('POST', '/api/personas/generate', { genre: genre, description: desc }).then(function(data) {
      var gen = data.persona || data;
      if (gen.penName || gen.name) document.getElementById('pmName').value = gen.penName || gen.name;
      if (gen.genre) document.getElementById('pmGenre').value = gen.genre;
      if (gen.subgenre) document.getElementById('pmSubgenre').value = gen.subgenre;
      if (gen.voiceDescription) document.getElementById('pmVoice').value = gen.voiceDescription;
      if (gen.styleMarkers) document.getElementById('pmMarkers').value = Array.isArray(gen.styleMarkers) ? gen.styleMarkers.join(', ') : gen.styleMarkers;
      if (gen.bio) document.getElementById('pmBio').value = gen.bio;
      showToast('Persona generated! Review and save.', 'success');
    }).catch(function(e) { showToast('Generation failed: ' + e.message, 'error'); });
  });

  // Save
  overlay.querySelector('#pmSave').addEventListener('click', function() {
    var body = {
      penName: document.getElementById('pmName').value.trim(),
      genre: document.getElementById('pmGenre').value.trim(),
      subgenre: document.getElementById('pmSubgenre').value.trim(),
      voiceDescription: document.getElementById('pmVoice').value.trim(),
      styleMarkers: document.getElementById('pmMarkers').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      ttsVoice: document.getElementById('pmTTS').value,
      bio: document.getElementById('pmBio').value.trim(),
      alsoBy: document.getElementById('pmAlsoBy').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    };
    if (!body.penName) { showToast('Pen name is required', 'error'); return; }

    var method = isEdit ? 'PUT' : 'POST';
    var path = isEdit ? '/api/personas/' + persona.id : '/api/personas';

    api(method, path, body).then(function() {
      overlay.remove();
      showToast(isEdit ? 'Persona updated!' : 'Persona created!', 'success');
      loadPersonas();
    }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
  });
}

function deletePersona(id) {
  if (!confirm('Delete this persona?')) return;
  api('DELETE', '/api/personas/' + id).then(function() {
    showToast('Persona deleted', 'info');
    loadPersonas();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
}

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
  var completed = allProjects.filter(function(p) { return p.status === 'completed'; });
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
// SETTINGS PANEL
// ================================================================

// ── API Keys ──
// Ollama is local-only (auto-detected at http://localhost:11434) — no API key needed.
// Configure Ollama via the "Local AI (Ollama)" card below the API Keys card.
var keyProviders = [
  { key: 'gemini_api_key', label: 'Gemini (free tier)', tier: 'free',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...' },
  { key: 'deepseek_api_key', label: 'DeepSeek (cheap)', tier: 'cheap',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    placeholder: 'sk-...' },
  { key: 'anthropic_api_key', label: 'Claude / Anthropic (paid)', tier: 'paid',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...' },
  { key: 'openai_api_key', label: 'OpenAI GPT (paid)', tier: 'paid',
    helpUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...' },
  { key: 'together_api_key', label: 'Together AI (image generation)', tier: 'free',
    helpUrl: 'https://api.together.xyz/settings/api-keys',
    placeholder: 'tgp_...' },
  { key: 'elevenlabs_api_key', label: 'ElevenLabs (audiobook narration)', tier: 'paid',
    helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'sk_...' },
  { key: 'openrouter_api_key', label: 'OpenRouter (one key, dozens of models)', tier: 'flexible',
    helpUrl: 'https://openrouter.ai/settings/keys',
    placeholder: 'sk-or-v1-...' },
  { key: 'perplexity_api_key', label: 'Perplexity (sourced research — optional)', tier: 'paid',
    helpUrl: 'https://www.perplexity.ai/settings/api',
    placeholder: 'pplx-...' }
];

function renderKeyProviders() {
  var el = document.getElementById('apiKeyProviders');
  if (!el) { console.warn('apiKeyProviders div missing — Settings panel may have failed to load'); return; }
  el.innerHTML = '';
  keyProviders.forEach(function(p) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    var helpLink = p.helpUrl
      ? '<a href="' + esc(p.helpUrl) + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);text-decoration:none;" title="Open ' + esc(p.label) + ' API key page">Get key →</a>'
      : '';
    var placeholder = p.placeholder ? esc(p.placeholder) : 'Paste ' + esc(p.label) + ' API key...';
    row.innerHTML =
      '<span style="min-width:160px;font-weight:600;font-size:14px;">' + esc(p.label) + '</span>' +
      '<input type="password" class="key-input" data-key="' + esc(p.key) + '" placeholder="' + placeholder + '" style="flex:1;min-width:200px;" autocomplete="off">' +
      '<button class="small btn-save-key" data-key="' + esc(p.key) + '">Save</button>' +
      (helpLink ? '<span style="margin-left:6px;">' + helpLink + '</span>' : '');
    el.appendChild(row);
  });

  el.querySelectorAll('.btn-save-key').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var keyName = btn.getAttribute('data-key');
      var input = el.querySelector('input[data-key="' + keyName + '"]');
      var value = input.value.trim();
      if (!value) { showToast('Please enter a key value', 'error'); return; }
      api('POST', '/api/vault', { key: keyName, value: value }).then(function() {
        input.value = '';
        showToast('Key saved and encrypted!', 'success');
        loadKeys();
        loadStatus();
      }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
    });
  });
}

function loadKeys() {
  api('GET', '/api/vault/keys').then(function(data) {
    var el = document.getElementById('keyList');
    if (!data.keys || data.keys.length === 0) {
      el.innerHTML = '<span style="color:var(--muted);">No keys stored yet</span>';
      return;
    }
    el.innerHTML = '';
    data.keys.forEach(function(k) {
      var tag = document.createElement('div');
      tag.className = 'key-tag';
      tag.innerHTML = esc(k) + ' <span class="del" data-key="' + esc(k) + '">&times;</span>';
      el.appendChild(tag);
    });
    el.querySelectorAll('.del').forEach(function(d) {
      d.addEventListener('click', function() {
        var keyName = d.getAttribute('data-key');
        if (!confirm('Delete ' + keyName + '?')) return;
        api('DELETE', '/api/vault/' + keyName).then(function() {
          showToast('Key deleted', 'info');
          loadKeys();
          loadStatus();
        }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
      });
    });
  }).catch(function() {
    document.getElementById('keyList').innerHTML = '<span style="color:var(--danger);">Could not load keys</span>';
  });
}

// "Load from files" — shared folder import (existing endpoint)
var btnLoadKeysFromFiles = document.getElementById('btnLoadKeysFromFiles');
if (btnLoadKeysFromFiles) {
  btnLoadKeysFromFiles.addEventListener('click', function() {
    api('POST', '/api/vault/load-from-files').then(function(data) {
      var n = (data.loaded || []).length;
      showToast(n > 0 ? 'Loaded ' + n + ' key(s) from shared folder' : (data.error || 'No keys found in shared folder'),
                n > 0 ? 'success' : 'info');
      loadKeys(); loadStatus();
    }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
  });
}

// ── OpenRouter model selection ──
function loadOpenrouterConfig() {
  api('GET', '/api/config').then(function(data) {
    var input = document.getElementById('openrouterModel');
    if (input) input.value = (data.ai && data.ai.openrouter && data.ai.openrouter.model) || 'anthropic/claude-sonnet-4-5';
  });
}
var btnSaveOpenrouter = document.getElementById('btnSaveOpenrouter');
if (btnSaveOpenrouter) {
  btnSaveOpenrouter.addEventListener('click', function() {
    var model = document.getElementById('openrouterModel').value.trim() || 'anthropic/claude-sonnet-4-5';
    api('POST', '/api/config/update', { path: 'ai.openrouter.model', value: model }).then(function() {
      return api('POST', '/api/providers/refresh');
    }).then(function() {
      showToast('OpenRouter model set to ' + model, 'success');
      loadStatus();
    }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
  });
}

// ── Ollama (local AI) configuration ──
function loadOllamaConfig() {
  api('GET', '/api/config').then(function(data) {
    var ep = document.getElementById('ollamaEndpoint');
    var mdl = document.getElementById('ollamaModel');
    if (ep) ep.value = (data.ai && data.ai.ollama && data.ai.ollama.endpoint) || 'http://localhost:11434';
    if (mdl) mdl.value = (data.ai && data.ai.ollama && data.ai.ollama.model) || 'llama3.2';
  });
  // Check whether Ollama is currently in the active provider list
  api('GET', '/api/status').then(function(data) {
    var status = document.getElementById('ollamaStatus');
    if (!status) return;
    var providers = (data && data.providers) || [];
    var ollama = providers.find(function(p) { return p.id === 'ollama'; });
    if (ollama) {
      status.innerHTML = '<span style="color:var(--success);">✓ Ollama detected</span> — model: <code>' + esc(ollama.model || 'llama3.2') + '</code>';
    } else {
      status.innerHTML = '<span style="color:var(--muted);">Ollama not detected.</span> Install from ollama.com, run <code>ollama serve</code>, then click Save & Reconnect.';
    }
  }).catch(function() {
    var status = document.getElementById('ollamaStatus');
    if (status) status.innerHTML = '<span style="color:var(--muted);">Status unknown</span>';
  });
}

var btnSaveOllama = document.getElementById('btnSaveOllama');
if (btnSaveOllama) {
  btnSaveOllama.addEventListener('click', function() {
    var ep = document.getElementById('ollamaEndpoint').value.trim() || 'http://localhost:11434';
    var mdl = document.getElementById('ollamaModel').value.trim() || 'llama3.2';
    Promise.all([
      api('POST', '/api/config/update', { path: 'ai.ollama.endpoint', value: ep }),
      api('POST', '/api/config/update', { path: 'ai.ollama.model', value: mdl }),
    ]).then(function() {
      // Trigger AI router reinitialization so the new endpoint takes effect immediately
      return api('POST', '/api/providers/refresh');
    }).then(function() {
      showToast('Ollama config saved & reconnected', 'success');
      loadOllamaConfig();
      loadStatus();
    }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
  });
}

// ── Quick-start banner — show only when zero providers are connected ──
function updateQuickStartBanner() {
  var banner = document.getElementById('quickStartBanner');
  if (!banner) return;
  api('GET', '/api/status').then(function(data) {
    var count = data && data.providers ? data.providers.length : 0;
    banner.style.display = count === 0 ? 'block' : 'none';
  }).catch(function() { banner.style.display = 'none'; });
}

// ── Global Provider Preference ──
function loadGlobalProvider() {
  api('GET', '/api/config').then(function(data) {
    var sel = document.getElementById('globalProviderSelect');
    if (sel && data.ai) sel.value = data.ai.preferredProvider || '';
  });
}
document.getElementById('btnSaveGlobalProvider').addEventListener('click', function() {
  var val = document.getElementById('globalProviderSelect').value;
  api('POST', '/api/config/update', { path: 'ai.preferredProvider', value: val || null }).then(function() {
    showToast(val ? 'Default provider set to ' + val : 'Provider set to auto (tiered routing)', 'success');
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ── Global IMAGE Provider Preference ──
function loadGlobalImageProvider() {
  api('GET', '/api/config').then(function(data) {
    var sel = document.getElementById('globalImageProviderSelect');
    if (sel && data.ai) sel.value = data.ai.preferredImageProvider || '';
  });
}
document.getElementById('btnSaveGlobalImageProvider').addEventListener('click', function() {
  var val = document.getElementById('globalImageProviderSelect').value;
  api('POST', '/api/config/update', { path: 'ai.preferredImageProvider', value: val || null }).then(function() {
    showToast(val ? 'Default image provider set to ' + val : 'Image provider set to auto (OpenAI → Gemini → Flux)', 'success');
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ── Telegram ──
function loadTelegramStatus() {
  api('GET', '/api/telegram/status').then(function(data) {
    var el = document.getElementById('telegramStatus');
    if (data.connected) {
      el.innerHTML = '<span style="color:var(--success);font-weight:700;">Connected</span>';
    } else if (data.hasToken) {
      el.innerHTML = '<span style="color:var(--warn);font-weight:700;">Token stored, not connected</span>';
    } else {
      el.innerHTML = '<span style="color:var(--muted);">Not configured</span>';
    }
  }).catch(function() {
    document.getElementById('telegramStatus').innerHTML = '<span style="color:var(--muted);">Could not load</span>';
  });
}

document.getElementById('btnConnectTelegram').addEventListener('click', function() {
  var token = document.getElementById('telegramToken').value.trim();
  var userId = document.getElementById('telegramUserId').value.trim();
  var body = {};
  if (token) body.token = token;
  if (userId) body.userId = userId;
  api('POST', '/api/telegram/connect', body).then(function(data) {
    showToast(data.message || 'Telegram connected!', 'success');
    loadTelegramStatus();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

document.getElementById('btnDisconnectTelegram').addEventListener('click', function() {
  api('POST', '/api/telegram/disconnect').then(function() {
    showToast('Telegram disconnected', 'info');
    loadTelegramStatus();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ── Voice ──
function loadVoices() {
  api('GET', '/api/audio/voices').then(function(data) {
    var sel = document.getElementById('ttsVoiceSelect');
    sel.innerHTML = '<option value="">Select a voice...</option>';
    if (data.presets && typeof data.presets === 'object') {
      Object.keys(data.presets).forEach(function(key) {
        var preset = data.presets[key];
        var opt = document.createElement('option');
        opt.value = key;
        var label = key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        opt.textContent = label + ' — ' + (preset.description || '');
        if (data.activeVoice === key || data.activeVoice === preset.voice) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }).catch(function() {
    var sel = document.getElementById('ttsVoiceSelect');
    sel.innerHTML =
      '<option value="">Could not load voices</option>' +
      '<option value="narrator_female">Narrator Female — Versatile, expressive</option>' +
      '<option value="narrator_male">Narrator Male — Literary fiction, thrillers</option>' +
      '<option value="narrator_deep">Narrator Deep — Epic fantasy, sci-fi</option>' +
      '<option value="narrator_warm">Narrator Warm — Romance, memoir</option>' +
      '<option value="british_male">British Male — Period pieces, cozy mysteries</option>' +
      '<option value="british_female">British Female — Elegant literary fiction</option>' +
      '<option value="storyteller">Storyteller — Adventure, YA</option>' +
      '<option value="snarky_nerd">Snarky Nerd — Witty banter, smart humor, sci-fi</option>' +
      '<option value="curious_kid">Curious Kid — Full of wonder, MG, whimsical</option>';
  });
}

document.getElementById('btnTestVoice').addEventListener('click', function() {
  var voice = document.getElementById('ttsVoiceSelect').value;
  if (!voice) { showToast('Select a voice first', 'error'); return; }
  var btn = document.getElementById('btnTestVoice');
  btn.textContent = 'Generating...';
  btn.disabled = true;
  api('POST', '/api/audio/generate', { text: 'Hello! I am BookClaw, your AI writing partner. Let me help you create your next bestseller.', voice: voice }).then(function(data) {
    if (data.success && data.filename) {
      var audio = new Audio(authUrl('/api/audio/file/' + encodeURIComponent(data.filename)));
      audio.play().then(function() {
        showToast('Playing voice: ' + voice, 'success');
      }).catch(function() {
        showToast('Audio generated but browser blocked playback. Click the page first, then try again.', 'error');
      });
    } else {
      showToast(data.error || 'Voice test failed', 'error');
    }
    btn.textContent = 'Test Voice';
    btn.disabled = false;
  }).catch(function(e) {
    showToast('Voice test failed: ' + e.message, 'error');
    btn.textContent = 'Test Voice';
    btn.disabled = false;
  });
});

// ── Research Domains ──
function loadResearchDomains() {
  api('GET', '/api/research/domains').then(function(data) {
    var el = document.getElementById('researchDomains');
    if (data.domains && data.domains.length > 0) {
      el.value = data.domains.join('\n');
    }
  }).catch(function() {});
}

document.getElementById('btnSaveDomains').addEventListener('click', function() {
  var raw = document.getElementById('researchDomains').value.trim();
  var domains = raw ? raw.split('\n').map(function(d) { return d.trim(); }).filter(Boolean) : [];
  api('POST', '/api/research/domains', { domains: domains }).then(function(data) {
    showToast('Research domains saved! (' + (data.count || domains.length) + ' domains)', 'success');
    loadResearchDomains();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ── Backups ──
function loadBackups() {
  var el = document.getElementById('backupList');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Loading backups...</span>';
  api('GET', '/api/backup/list').then(function(data) {
    var backups = data.backups || [];
    if (backups.length === 0) {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">No backups yet.</span>';
      return;
    }
    var html = '';
    backups.forEach(function(b) {
      var date = new Date(b.createdAt);
      var dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:13px;font-weight:600;">' + esc(b.id) + '</div>' +
          '<div style="font-size:12px;color:var(--muted);">' + esc(dateStr) + ' &middot; ' + esc(String(b.sizeKB)) + ' KB</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="secondary btn-restore-backup" data-id="' + esc(b.id) + '" style="font-size:12px;padding:4px 10px;">Restore</button>' +
          '<button class="danger btn-delete-backup" data-id="' + esc(b.id) + '" style="font-size:12px;padding:4px 10px;">Delete</button>' +
        '</div>' +
      '</div>';
    });
    el.innerHTML = html;

    el.querySelectorAll('.btn-restore-backup').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        if (!confirm('Restore from backup "' + id + '"?\n\nA safety backup of your current state will be created first.')) return;
        showToast('Restoring from ' + id + '...', 'info');
        api('POST', '/api/backup/restore/' + encodeURIComponent(id)).then(function(data) {
          showToast('Restored from ' + esc(data.restoredFrom) + '. Safety backup: ' + esc(data.safetyBackup), 'success');
          loadBackups();
        }).catch(function(e) { showToast('Restore failed: ' + e.message, 'error'); });
      });
    });

    el.querySelectorAll('.btn-delete-backup').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        if (!confirm('Delete backup "' + id + '"? This cannot be undone.')) return;
        api('DELETE', '/api/backup/' + encodeURIComponent(id)).then(function() {
          showToast('Backup deleted', 'info');
          loadBackups();
        }).catch(function(e) { showToast('Delete failed: ' + e.message, 'error'); });
      });
    });
  }).catch(function(e) {
    el.innerHTML = '<span style="color:var(--error);font-size:13px;">Failed to load backups</span>';
  });
}

document.getElementById('btnCreateBackup').addEventListener('click', function() {
  var btn = document.getElementById('btnCreateBackup');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  showToast('Creating backup...', 'info');
  api('POST', '/api/backup/create').then(function(data) {
    showToast('Backup created: ' + esc(data.backupId) + ' (' + (data.sizeKB || 0) + ' KB)', 'success');
    btn.disabled = false;
    btn.textContent = 'Create Backup';
    loadBackups();
  }).catch(function(e) {
    showToast('Backup failed: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Create Backup';
  });
});

// ── Autonomous Mode ──
function loadAutonomousStatus() {
  api('GET', '/api/autonomous/status').then(function(data) {
    document.getElementById('autonomousToggle').checked = data.enabled;
    var label = document.getElementById('autonomousLabel');
    if (data.enabled && !data.paused) {
      label.textContent = data.running ? 'Agent WORKING...' : 'Agent ON';
      label.style.color = data.running ? 'var(--info)' : 'var(--success)';
    } else if (data.enabled && data.paused) {
      label.textContent = 'Agent PAUSED';
      label.style.color = 'var(--warn)';
    } else {
      label.textContent = 'Agent OFF';
      label.style.color = 'var(--muted)';
    }
    if (data.intervalMinutes) document.getElementById('autonomousInterval').value = data.intervalMinutes;
    if (data.quietHoursStart !== undefined && data.quietHoursEnd !== undefined) {
      document.getElementById('autonomousQuiet').value = data.quietHoursStart + '-' + data.quietHoursEnd;
    }
  }).catch(function() {});

  // Load word count goal and progress
  api('GET', '/api/agent/status').then(function(data) {
    if (data.dailyWordGoal) document.getElementById('dailyWordGoal').value = data.dailyWordGoal;
    var progress = document.getElementById('wordGoalProgress');
    if (data.todayWords !== undefined && data.dailyWordGoal) {
      var pct = Math.round((data.todayWords / data.dailyWordGoal) * 100);
      progress.textContent = data.todayWords.toLocaleString() + '/' + data.dailyWordGoal.toLocaleString() + ' words today (' + pct + '%)';
      progress.style.color = pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--accent)' : 'var(--text-secondary)';
    }
  }).catch(function() {});
}

document.getElementById('autonomousToggle').addEventListener('change', function() {
  var enabled = this.checked;
  var endpoint = enabled ? '/api/autonomous/enable' : '/api/autonomous/disable';
  api('POST', endpoint).then(function() {
    showToast(enabled ? 'Autonomous mode enabled!' : 'Autonomous mode disabled', enabled ? 'success' : 'info');
    loadAutonomousStatus();
  }).catch(function(e) {
    showToast('Failed: ' + e.message, 'error');
    loadAutonomousStatus();
  });
});

document.getElementById('btnSaveAutonomous').addEventListener('click', function() {
  var interval = parseInt(document.getElementById('autonomousInterval').value);
  var quietStr = document.getElementById('autonomousQuiet').value.trim();
  var wordGoal = parseInt(document.getElementById('dailyWordGoal').value);
  var body = {};
  if (!isNaN(interval) && interval >= 1) body.intervalMinutes = interval;
  if (quietStr) {
    var parts = quietStr.split('-');
    if (parts.length === 2) {
      body.quietHoursStart = parseInt(parts[0]);
      body.quietHoursEnd = parseInt(parts[1]);
    }
  }

  // Save word goal via config API
  var saves = [api('POST', '/api/autonomous/config', body)];
  if (!isNaN(wordGoal) && wordGoal >= 100) {
    saves.push(api('POST', '/api/config/update', { path: 'heartbeat.dailyWordGoal', value: wordGoal }));
  }
  Promise.all(saves).then(function() {
    showToast('Autonomous settings saved!', 'success');
    loadAutonomousStatus();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ================================================================
// IDLE TASKS (CRUD)
// ================================================================
var idleTasksCache = [];

function loadIdleTasks() {
  api('GET', '/api/autonomous/idle-tasks').then(function(data) {
    idleTasksCache = data.queue || [];
    renderIdleTaskQueue();
    renderIdleTaskHistory(data.history || []);
  }).catch(function() {
    var histEl = document.getElementById('idleTaskHistory');
    if (histEl) histEl.innerHTML = '<div style="color:var(--muted);">Could not load idle tasks.</div>';
  });
}

function renderIdleTaskQueue() {
  var queueEl = document.getElementById('idleTaskQueue');
  if (!queueEl) return;
  queueEl.innerHTML = '';
  if (idleTasksCache.length === 0) {
    queueEl.innerHTML = '<div style="color:var(--muted);padding:8px 0;">No idle tasks configured. Click "+ Add Task" to create one.</div>';
    return;
  }
  idleTasksCache.forEach(function(task, idx) {
    var row = document.createElement('div');
    row.style.cssText = 'padding:10px 12px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);';
    var enabledStyle = task.enabled === false ? 'opacity:0.5;' : '';
    row.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;' + enabledStyle + '">' +
        '<label class="toggle" style="transform:scale(0.7);"><input type="checkbox" class="idle-toggle" data-idx="' + idx + '"' + (task.enabled !== false ? ' checked' : '') + '><span class="slider"></span></label>' +
        '<strong style="flex:1;font-size:13px;">' + esc(task.label) + '</strong>' +
        '<button class="small secondary btn-edit-idle" data-idx="' + idx + '" style="font-size:11px;padding:3px 8px;">Edit</button>' +
        '<button class="small danger btn-del-idle" data-idx="' + idx + '" style="font-size:11px;padding:3px 8px;">Delete</button>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;margin-left:42px;line-height:1.4;' + enabledStyle + '">' + esc((task.prompt || '').substring(0, 120)) + '...</div>';
    queueEl.appendChild(row);
  });

  // Wire toggle, edit, delete
  queueEl.querySelectorAll('.idle-toggle').forEach(function(toggle) {
    toggle.addEventListener('change', function() {
      var idx = parseInt(toggle.getAttribute('data-idx'));
      idleTasksCache[idx].enabled = toggle.checked;
      saveIdleTasks();
    });
  });
  queueEl.querySelectorAll('.btn-edit-idle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      openIdleTaskEditor(idleTasksCache[idx], idx);
    });
  });
  queueEl.querySelectorAll('.btn-del-idle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      if (!confirm('Delete idle task "' + idleTasksCache[idx].label + '"?')) return;
      idleTasksCache.splice(idx, 1);
      saveIdleTasks();
      renderIdleTaskQueue();
    });
  });
}

function saveIdleTasks() {
  api('PUT', '/api/autonomous/idle-tasks', { tasks: idleTasksCache }).then(function() {
    showToast('Idle tasks saved!', 'success');
  }).catch(function(e) { showToast('Failed to save: ' + e.message, 'error'); });
}

function openIdleTaskEditor(task, idx) {
  var isNew = idx === -1;
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal" style="max-width:600px;">' +
      '<div class="modal-title">' + (isNew ? 'Add Idle Task' : 'Edit Idle Task') + '</div>' +
      '<div class="form-group">' +
        '<label>Task Name</label>' +
        '<input type="text" id="idleEditLabel" value="' + esc(task ? task.label || '' : '') + '" placeholder="e.g. Market trend analysis">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>AI Instructions (what the agent should do)</label>' +
        '<textarea id="idleEditPrompt" rows="10" style="font-size:12px;line-height:1.5;" placeholder="Describe in detail what the AI agent should research, create, or analyze...">' + esc(task ? task.prompt || '' : '') + '</textarea>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="secondary" id="idleEditCancel">Cancel</button>' +
        '<button class="success" id="idleEditSave">' + (isNew ? 'Add Task' : 'Save Changes') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#idleEditCancel').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#idleEditSave').addEventListener('click', function() {
    var label = document.getElementById('idleEditLabel').value.trim();
    var prompt = document.getElementById('idleEditPrompt').value.trim();
    if (!label) { showToast('Task name is required', 'error'); return; }
    if (!prompt) { showToast('AI instructions are required', 'error'); return; }
    if (isNew) {
      idleTasksCache.push({ label: label, prompt: prompt, enabled: true });
    } else {
      idleTasksCache[idx].label = label;
      idleTasksCache[idx].prompt = prompt;
    }
    saveIdleTasks();
    renderIdleTaskQueue();
    overlay.remove();
  });
}

document.getElementById('btnAddIdleTask').addEventListener('click', function() {
  openIdleTaskEditor(null, -1);
});

function renderIdleTaskHistory(tasks) {
  var histEl = document.getElementById('idleTaskHistory');
  if (!histEl) return;
  if (!tasks || tasks.length === 0) {
    histEl.innerHTML = '<div style="color:var(--muted);padding:8px 0;">No idle tasks completed yet. Enable autonomous mode to start generating.</div>';
    return;
  }
  histEl.innerHTML = '';
  tasks.forEach(function(t) {
    var card = document.createElement('div');
    card.style.cssText = 'padding:10px 12px;margin-bottom:8px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);cursor:pointer;transition:border-color var(--transition);';
    card.addEventListener('mouseenter', function() { card.style.borderColor = 'var(--accent)'; });
    card.addEventListener('mouseleave', function() { card.style.borderColor = 'var(--border)'; });
    var dateStr = new Date(t.date).toLocaleDateString() + ' ' + new Date(t.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    var previewText = t.preview || '';
    var nlPos = previewText.indexOf('\n\n');
    if (nlPos > 0) previewText = previewText.substring(nlPos + 2);
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<strong style="font-size:13px;">' + esc(t.title) + '</strong>' +
        '<span style="font-size:11px;color:var(--muted);">' + dateStr + '</span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">' + esc(previewText.substring(0, 200)) + '...</div>';
    card.addEventListener('click', function() {
      api('GET', '/api/autonomous/idle-tasks/history/' + encodeURIComponent(t.file)).then(function(d) {
        showIdleTaskModal(t.title, d.content);
      }).catch(function(e) { showToast('Failed to load: ' + e.message, 'error'); });
    });
    histEl.appendChild(card);
  });
}

function showIdleTaskModal(title, content) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal" style="max-width:700px;max-height:80vh;overflow-y:auto;">' +
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:var(--text-secondary);">' + esc(content) + '</div>' +
      '<div class="modal-actions">' +
        '<button class="secondary" id="idleModalClose">Close</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#idleModalClose').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
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
// LESSONS
// ================================================================
function loadLessons() {
  api('GET', '/api/lessons').then(function(data) {
    var el = document.getElementById('lessonsList');
    var lessons = data.lessons || [];
    if (lessons.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No lessons yet. BookClaw will learn from experience over time.</div>';
      return;
    }
    el.innerHTML = lessons.sort(function(a,b) { return b.confidence - a.confidence; }).map(function(l) {
      var conf = Math.round(l.confidence * 100);
      var color = conf >= 70 ? 'var(--success)' : conf >= 40 ? 'var(--warning, orange)' : 'var(--muted)';
      return '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px;font-size:13px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="font-weight:600;color:' + color + ';">' + conf + '%</span>' +
        '<span style="color:var(--muted);font-size:11px;">' + l.category + ' | ' + l.source + '</span>' +
        '</div>' +
        '<div style="margin-top:4px;">' + l.lesson + '</div>' +
        '</div>';
    }).join('');
  }).catch(function() {
    document.getElementById('lessonsList').innerHTML = '<div style="color:var(--muted);">Could not load</div>';
  });
}

document.getElementById('btnAddLesson').addEventListener('click', function() {
  var text = document.getElementById('newLessonText').value.trim();
  var category = document.getElementById('newLessonCategory').value;
  if (!text) return showToast('Enter a lesson', 'error');
  api('POST', '/api/lessons', { lesson: text, category: category, source: 'user-feedback', confidence: 0.7 }).then(function() {
    document.getElementById('newLessonText').value = '';
    showToast('Lesson added', 'success');
    loadLessons();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

document.getElementById('btnResetLessons').addEventListener('click', function() {
  if (!confirm('Reset all lessons? This cannot be undone.')) return;
  api('DELETE', '/api/lessons').then(function() {
    showToast('Lessons reset', 'info');
    loadLessons();
  });
});

// ================================================================
// PREFERENCES
// ================================================================
function loadPreferences() {
  api('GET', '/api/preferences').then(function(data) {
    var el = document.getElementById('preferencesList');
    var prefs = data.preferences || {};
    var meta = data.metadata || {};
    var keys = Object.keys(prefs);
    if (keys.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No preferences detected yet. Try saying "I prefer first person POV" in chat.</div>';
      return;
    }
    el.innerHTML = keys.map(function(key) {
      var source = meta[key] ? meta[key].source : 'unknown';
      var badge = source === 'explicit' ? 'color:var(--success)' : source === 'inferred' ? 'color:var(--warning, orange)' : 'color:var(--muted)';
      return '<div style="padding:6px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:4px;font-size:13px;display:flex;justify-content:space-between;align-items:center;">' +
        '<div><strong>' + key + '</strong>: ' + prefs[key] + ' <span style="font-size:11px;' + badge + ';">(' + source + ')</span></div>' +
        '<button class="small danger" onclick="deletePreference(\'' + key.replace(/'/g, "\\'") + '\')" style="font-size:10px;padding:2px 8px;">X</button>' +
        '</div>';
    }).join('');
  }).catch(function() {
    document.getElementById('preferencesList').innerHTML = '<div style="color:var(--muted);">Could not load</div>';
  });
}

window.deletePreference = function(key) {
  api('DELETE', '/api/preferences/' + encodeURIComponent(key)).then(function() {
    showToast('Preference removed', 'info');
    loadPreferences();
  });
};

document.getElementById('btnAddPreference').addEventListener('click', function() {
  var key = document.getElementById('newPrefKey').value.trim();
  var value = document.getElementById('newPrefValue').value.trim();
  if (!key || !value) return showToast('Enter key and value', 'error');
  api('POST', '/api/preferences', { key: key, value: value, source: 'explicit' }).then(function() {
    document.getElementById('newPrefKey').value = '';
    document.getElementById('newPrefValue').value = '';
    showToast('Preference saved', 'success');
    loadPreferences();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

document.getElementById('btnResetPreferences').addEventListener('click', function() {
  if (!confirm('Reset all preferences? This cannot be undone.')) return;
  api('DELETE', '/api/preferences').then(function() {
    showToast('Preferences reset', 'info');
    loadPreferences();
  });
});

// ================================================================
// ORCHESTRATOR
// ================================================================
function loadOrchestrator() {
  api('GET', '/api/orchestrator/status').then(function(data) {
    var el = document.getElementById('orchestratorScripts');
    var scripts = data.scripts || [];
    if (scripts.length === 0) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No scripts configured. Add a background script to manage.</div>';
      return;
    }
    el.innerHTML = scripts.map(function(s) {
      var stateColor = s.state === 'running' ? 'var(--success)' : s.state === 'crashed' ? 'var(--danger, red)' : 'var(--muted)';
      var uptime = s.uptime ? Math.round(s.uptime / 1000 / 60) + 'm' : '-';
      return '<div style="padding:8px 10px;background:var(--bg-secondary);border-radius:6px;margin-bottom:6px;font-size:13px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div><strong>' + s.name + '</strong> <span style="color:' + stateColor + ';font-size:12px;">' + s.state.toUpperCase() + '</span></div>' +
        '<div style="display:flex;gap:4px;">' +
        (s.state === 'running'
          ? '<button class="small danger" onclick="orchAction(\'' + s.id + '\',\'stop\')" style="font-size:10px;padding:2px 8px;">Stop</button>'
          : '<button class="small success" onclick="orchAction(\'' + s.id + '\',\'start\')" style="font-size:10px;padding:2px 8px;">Start</button>') +
        '<button class="small" onclick="orchAction(\'' + s.id + '\',\'restart\')" style="font-size:10px;padding:2px 8px;">Restart</button>' +
        '<button class="small danger" onclick="orchRemove(\'' + s.id + '\')" style="font-size:10px;padding:2px 8px;">X</button>' +
        '</div></div>' +
        '<div style="color:var(--muted);font-size:11px;margin-top:4px;">PID: ' + (s.pid || '-') + ' | Uptime: ' + uptime + ' | Restarts: ' + s.restartCount + '</div>' +
        (s.lastError ? '<div style="color:var(--danger, red);font-size:11px;margin-top:2px;">Last error: ' + s.lastError + '</div>' : '') +
        '</div>';
    }).join('');
  }).catch(function() {
    document.getElementById('orchestratorScripts').innerHTML = '<div style="color:var(--muted);">Could not load</div>';
  });
}

window.orchAction = function(id, action) {
  api('POST', '/api/orchestrator/scripts/' + id + '/' + action).then(function() {
    showToast('Script ' + action + 'ed', 'success');
    setTimeout(loadOrchestrator, 500);
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
};

window.orchRemove = function(id) {
  if (!confirm('Remove this script?')) return;
  api('DELETE', '/api/orchestrator/scripts/' + id).then(function() {
    showToast('Script removed', 'info');
    loadOrchestrator();
  });
};

document.getElementById('btnAddScript').addEventListener('click', function() {
  var name = document.getElementById('newScriptName').value.trim();
  var command = document.getElementById('newScriptCommand').value.trim();
  if (!name || !command) return showToast('Enter script name and command', 'error');
  var id = 'script-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  api('POST', '/api/orchestrator/scripts', { id: id, name: name, command: command, args: [], autoRestart: true, tags: [] }).then(function() {
    document.getElementById('newScriptName').value = '';
    document.getElementById('newScriptCommand').value = '';
    showToast('Script added', 'success');
    loadOrchestrator();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
});

// ================================================================
// MANUSCRIPT HUB
// ================================================================
function loadHub() {
  var el = document.getElementById('hubContent');
  if (!el) return;
  api('GET', '/api/hub').then(function(data) {
    if (!data || !data.totals) {
      el.innerHTML = '<div style="color:var(--muted);">No data yet. Create a project to get started.</div>';
      return;
    }
    var goalPct = data.goal.pctOfDaily || 0;
    var goalBar = '<div style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:4px;">' +
      '<div style="background:var(--success);height:100%;width:' + Math.min(100, goalPct) + '%;"></div></div>';

    var projectRows = (data.projects || []).slice(0, 8).map(function(p) {
      var statusColor = p.status === 'active' ? 'var(--success)' :
                        p.status === 'completed' ? 'var(--muted)' :
                        p.status === 'paused' ? 'var(--warning, orange)' :
                        'var(--text-secondary)';
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bg-secondary);">' +
        '<div style="flex:1;"><strong>' + (p.title || '').substring(0, 40) + '</strong>' +
        '<span style="color:' + statusColor + ';font-size:11px;margin-left:8px;">' + p.status + '</span></div>' +
        '<div style="color:var(--muted);font-size:11px;">' + p.totalWords.toLocaleString() + ' words · ' + p.progress + '%</div>' +
        '</div>';
    }).join('') || '<div style="color:var(--muted);padding:6px 0;">No projects yet.</div>';

    var upcoming = (data.upcoming || []).slice(0, 5).map(function(u) {
      return '<li>' + u.projectTitle + ' — <em>' + u.stepLabel + '</em></li>';
    }).join('') || '<li style="color:var(--muted);">Nothing queued.</li>';

    el.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">' +
        '<div><div style="color:var(--muted);font-size:11px;">Projects</div><div style="font-size:20px;font-weight:700;">' + data.totals.projects + '</div></div>' +
        '<div><div style="color:var(--muted);font-size:11px;">Total Words</div><div style="font-size:20px;font-weight:700;">' + data.totals.totalWords.toLocaleString() + '</div></div>' +
        '<div><div style="color:var(--muted);font-size:11px;">Chapters Written</div><div style="font-size:20px;font-weight:700;">' + data.totals.totalChaptersWritten + '</div></div>' +
        '<div><div style="color:var(--muted);font-size:11px;">Streak</div><div style="font-size:20px;font-weight:700;">' + (data.goal.streakDays || 0) + ' days</div></div>' +
      '</div>' +
      '<div style="margin-bottom:16px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;"><span>Today\'s word goal</span>' +
        '<span>' + data.goal.todayWords.toLocaleString() + ' / ' + data.goal.daily.toLocaleString() + ' (' + goalPct + '%)</span></div>' +
        goalBar +
      '</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;">' +
        '<div><div style="font-weight:600;margin-bottom:6px;">Projects</div>' + projectRows + '</div>' +
        '<div><div style="font-weight:600;margin-bottom:6px;">Up next</div><ul style="padding-left:18px;margin:0;font-size:12px;">' + upcoming + '</ul></div>' +
      '</div>';
  }).catch(function() {
    el.innerHTML = '<div style="color:var(--muted);">Could not load hub</div>';
  });
}

var _btnRefreshHub = document.getElementById('btnRefreshHub');
if (_btnRefreshHub) _btnRefreshHub.addEventListener('click', loadHub);

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

