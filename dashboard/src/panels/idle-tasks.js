// Idle-tasks panel: queue CRUD + history (the agent's background task list).
import { state } from '../lib/state.js';
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc } from '../lib/format.js';


export function loadIdleTasks() {
  api('GET', '/api/autonomous/idle-tasks').then(function(data) {
    state.idleTasksCache = data.queue || [];
    renderIdleTaskQueue();
    renderIdleTaskHistory(data.history || []);
  }).catch(function() {
    var histEl = document.getElementById('idleTaskHistory');
    if (histEl) histEl.innerHTML = '<div style="color:var(--muted);">Could not load idle tasks.</div>';
  });
}

export function renderIdleTaskQueue() {
  var queueEl = document.getElementById('idleTaskQueue');
  if (!queueEl) return;
  queueEl.innerHTML = '';
  if (state.idleTasksCache.length === 0) {
    queueEl.innerHTML = '<div style="color:var(--muted);padding:8px 0;">No idle tasks configured. Click "+ Add Task" to create one.</div>';
    return;
  }
  state.idleTasksCache.forEach(function(task, idx) {
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
      state.idleTasksCache[idx].enabled = toggle.checked;
      saveIdleTasks();
    });
  });
  queueEl.querySelectorAll('.btn-edit-idle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      openIdleTaskEditor(state.idleTasksCache[idx], idx);
    });
  });
  queueEl.querySelectorAll('.btn-del-idle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      if (!confirm('Delete idle task "' + state.idleTasksCache[idx].label + '"?')) return;
      state.idleTasksCache.splice(idx, 1);
      saveIdleTasks();
      renderIdleTaskQueue();
    });
  });
}

export function saveIdleTasks() {
  api('PUT', '/api/autonomous/idle-tasks', { tasks: state.idleTasksCache }).then(function() {
    showToast('Idle tasks saved!', 'success');
  }).catch(function(e) { showToast('Failed to save: ' + e.message, 'error'); });
}

export function openIdleTaskEditor(task, idx) {
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
      state.idleTasksCache.push({ label: label, prompt: prompt, enabled: true });
    } else {
      state.idleTasksCache[idx].label = label;
      state.idleTasksCache[idx].prompt = prompt;
    }
    saveIdleTasks();
    renderIdleTaskQueue();
    overlay.remove();
  });
}

document.getElementById('btnAddIdleTask').addEventListener('click', function() {
  openIdleTaskEditor(null, -1);
});

export function renderIdleTaskHistory(tasks) {
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

export function showIdleTaskModal(title, content) {
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

