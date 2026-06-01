// Personas panel: list, create/edit modal, delete.
import { state } from '../lib/state.js';
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc, avatarColor, initials } from '../lib/format.js';

export function loadPersonas() {
  api('GET', '/api/personas').then(function(data) {
    state.allPersonas = data.personas || data || [];
    if (Array.isArray(data) && !data.personas) state.allPersonas = data;
    renderPersonas();
    document.getElementById('statPersonas').textContent = state.allPersonas.length;
  }).catch(function() {
    state.allPersonas = [];
    renderPersonas();
  });
}

export function renderPersonas() {
  var grid = document.getElementById('personaGrid');
  grid.innerHTML = '';

  state.allPersonas.forEach(function(p) {
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
      var p = state.allPersonas.find(function(x) { return x.id === btn.getAttribute('data-id'); });
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

export function openPersonaModal(persona) {
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

export function deletePersona(id) {
  if (!confirm('Delete this persona?')) return;
  api('DELETE', '/api/personas/' + id).then(function() {
    showToast('Persona deleted', 'info');
    loadPersonas();
  }).catch(function(e) { showToast('Failed: ' + e.message, 'error'); });
}
