// Author HQ panel: single-page aggregate (at-a-glance stats, active projects,
// per-persona breakdown, recent activity) + relative-time helper.
import { api } from '../lib/api.js';
import { esc } from '../lib/format.js';
import { openProjectDetail } from './projects.js';
import { switchPanel } from '../main.js';

// Pulls existing endpoints (no backend changes) and renders 4 cards:
// today-at-a-glance, active projects, per-persona breakdown, recent activity.
// Plus optional "what BookClaw knows about you" from the user-model service.
export function loadHQ() {
  Promise.all([
    api('GET', '/api/projects/list').catch(function() { return { projects: [] }; }),
    api('GET', '/api/personas').catch(function() { return { personas: [] }; }),
    api('GET', '/api/activity?count=12').catch(function() { return { entries: [] }; }),
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
    // /api/activity returns { entries: [...] }; tolerate a bare array or legacy { events } too.
    var events = Array.isArray(activityData) ? activityData : (activityData.entries || activityData.events || []);

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
        activeEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">No active projects. Start one from the <a href="#" class="hq-goto-projects">Projects</a> panel.</div>';
      } else {
        activeEl.innerHTML = active.slice(0, 8).map(function(p) {
          var pct = p.progress || 0;
          var stepsTotal = (p.steps || []).length;
          var stepsDone = (p.steps || []).filter(function(s){return s.status==='completed';}).length;
          var activeStep = (p.steps || []).find(function(s){return s.status==='active';});
          return '<div class="hq-proj" data-id="' + esc(p.id) + '" style="padding:10px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:8px;cursor:pointer;">' +
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
      // Wire clicks (inline handlers can't reach module-scoped functions).
      activeEl.querySelectorAll('.hq-proj').forEach(function(card) {
        card.addEventListener('click', function() {
          var id = card.getAttribute('data-id');
          switchPanel('projects');
          setTimeout(function() { openProjectDetail(id); }, 100);
        });
      });
      var goto = activeEl.querySelector('.hq-goto-projects');
      if (goto) goto.addEventListener('click', function(e) { e.preventDefault(); switchPanel('projects'); });
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
export function humanAgo(date) {
  var s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
