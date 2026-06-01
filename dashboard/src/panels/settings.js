// Settings panel: API keys, provider/model config, Telegram, voices,
// research domains, backups, autonomous status.
import { api, authUrl } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc } from '../lib/format.js';
import { loadStatus } from '../main.js';

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

export function renderKeyProviders() {
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

export function loadKeys() {
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
export function loadOpenrouterConfig() {
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
export function loadOllamaConfig() {
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
export function updateQuickStartBanner() {
  var banner = document.getElementById('quickStartBanner');
  if (!banner) return;
  api('GET', '/api/status').then(function(data) {
    var count = data && data.providers ? data.providers.length : 0;
    banner.style.display = count === 0 ? 'block' : 'none';
  }).catch(function() { banner.style.display = 'none'; });
}

// ── Global Provider Preference ──
export function loadGlobalProvider() {
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
export function loadGlobalImageProvider() {
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
export function loadTelegramStatus() {
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
export function loadVoices() {
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
export function loadResearchDomains() {
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
export function loadBackups() {
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
export function loadAutonomousStatus() {
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
