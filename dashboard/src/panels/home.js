// Home panel: active-project cards + the home stats / activity feed.
import { state } from '../lib/state.js';
import { api } from '../lib/api.js';
import { esc } from '../lib/format.js';
import { openProjectDetail } from './projects.js';
import { switchPanel } from '../main.js';

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

export function loadHomeStats() {
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

export function loadActivity() {
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
export function formatTimeAgo(iso) {
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}
