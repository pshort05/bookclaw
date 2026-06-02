// Insights cards: lessons, preferences, orchestrator, manuscript hub.
// Keeps the window.* globals (deletePreference/orchAction/orchRemove) used by
// inline onclick handlers in this panel's generated HTML.
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';

// ================================================================
// LESSONS
// ================================================================
export function loadLessons() {
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
export function loadPreferences() {
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
export function loadOrchestrator() {
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
export function loadHub() {
  var el = document.getElementById('hubContent');
  if (!el) return;
  // Fetch the hub aggregate + the (real) AI spend together.
  Promise.all([
    api('GET', '/api/hub'),
    api('GET', '/api/costs').catch(function() { return null; }),
  ]).then(function(results) {
    var data = results[0];
    var costs = results[1];
    if (!data || !data.totals) {
      el.innerHTML = '<div style="color:var(--muted);">No data yet. Create a project to get started.</div>';
      return;
    }
    var goalPct = data.goal.pctOfDaily || 0;
    var goalBar = '<div style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:4px;">' +
      '<div style="background:var(--success);height:100%;width:' + Math.min(100, goalPct) + '%;"></div></div>';

    // AI spend (actual cost reported by the provider; e.g. OpenRouter usage.cost).
    var costHtml = '';
    if (costs && typeof costs.daily === 'number') {
      var over = !!costs.overBudget;
      var dayPct = costs.dailyLimit ? Math.min(100, (costs.daily / costs.dailyLimit) * 100) : 0;
      costHtml =
        '<div style="margin-bottom:16px;">' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;">' +
            '<span>AI spend' + (over ? ' <span style="color:var(--danger);">(over budget)</span>' : '') + '</span>' +
            '<span style="color:' + (over ? 'var(--danger)' : 'var(--text)') + ';">' +
              '<strong>$' + costs.daily.toFixed(2) + '</strong> / $' + costs.dailyLimit + ' today · ' +
              '<strong>$' + costs.monthly.toFixed(2) + '</strong> / $' + costs.monthlyLimit + ' this month' +
            '</span>' +
          '</div>' +
          '<div style="background:var(--bg-secondary);border-radius:4px;height:8px;overflow:hidden;margin-top:4px;">' +
            '<div style="background:' + (over ? 'var(--danger)' : 'var(--accent)') + ';height:100%;width:' + dayPct + '%;"></div></div>' +
        '</div>';
    }

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
      costHtml +
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
