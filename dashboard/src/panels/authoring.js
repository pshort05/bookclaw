// Authoring panel: two-scope editor — Library overlay + active-book snapshot.
// Kinds: author, voice, genre, section, pipeline, skill.
// Backed by /api/library (library scope) and /api/books/active/templates
// (book scope) plus /api/skills (skill CRUD in both scopes).
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc } from '../lib/format.js';
import { marked } from 'marked';

const SKILL_CATEGORIES = ['core', 'author', 'marketing', 'ops'];
const SKILL_TEMPLATE =
  '---\n' +
  'description: One-line summary of what this skill does\n' +
  'triggers:\n' +
  '  - keyword\n' +
  'permissions:\n' +
  '  - memory_read\n' +
  '---\n\n' +
  '# Skill Name\n\n' +
  'Instructions the AI should follow when this skill is triggered.\n';

// Kinds shown in the kind selector (UI label → singular API kind).
const KINDS = [
  { label: 'Author', kind: 'author' },
  { label: 'Voice', kind: 'voice' },
  { label: 'Genre', kind: 'genre' },
  { label: 'Sections', kind: 'section' },
  { label: 'Skills', kind: 'skill' },
  { label: 'Pipeline', kind: 'pipeline' },
];

// Multi-file kinds (the rest are single-content kinds).
const MULTI_FILE_KINDS = new Set(['author', 'voice', 'genre', 'skill']);

// Map a singular kind to the book-templates path segment.
// The books/active/templates endpoint uses 'sections' and 'skills' (plural);
// everything else is singular.
function toTemplatePath(kind) {
  if (kind === 'section') return 'sections';
  if (kind === 'skill') return 'skills';
  return kind;
}

// Starter file maps for "+ New" (library scope).
const NEW_STARTERS = {
  author: { 'SOUL.md': '' },
  voice: { 'STYLE-GUIDE.md': '' },
  genre: { 'tropes.md': '' },
};
// Module-level state (reset on each loadAuthoring call).
let _scope = 'library'; // 'library' | 'book'
let _kind = 'author';
let _currentFile = null; // active file for multi-file kinds

// ─── Shared helpers ───────────────────────────────────────────────────────────

function md(text) {
  try { return marked.parse(text || '', { breaks: true }); }
  catch { return '<pre>' + esc(text || '') + '</pre>'; }
}

function badge(source) {
  const color = source === 'workspace' ? 'var(--success)' : source === 'synthetic' ? 'var(--info)' : 'var(--muted)';
  return '<span class="badge" style="font-size:9px;background:transparent;border:1px solid ' + color + ';color:' + color + ';">' + esc(source) + '</span>';
}

function editorShell(title, sourceHtml, bodyHtml, actionsHtml) {
  const ed = document.getElementById('auEditor');
  if (!ed) return null;
  ed.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
      '<h4 style="margin:0;flex:1;word-break:break-all;">' + title + '</h4>' + (sourceHtml || '') +
    '</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px;">' +
      '<button class="small" id="auTabPreview">Preview</button>' +
      '<button class="small secondary" id="auTabEdit">Edit</button>' +
    '</div>' +
    '<div id="auBody">' + bodyHtml + '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px;">' + actionsHtml + '</div>';
  return ed;
}

// Manages a single source of truth (state.content) across Preview/Edit toggles.
function wireTabs(state) {
  const body = document.getElementById('auBody');
  const sync = () => { const t = document.getElementById('auText'); if (t) state.content = t.value; };
  const showPreview = () => {
    sync();
    body.innerHTML = '<div class="md-preview" style="border:1px solid var(--border);border-radius:8px;padding:12px;max-height:60vh;overflow:auto;">' + md(state.content) + '</div>';
  };
  const showEdit = () => {
    body.innerHTML = '<textarea id="auText" spellcheck="false" style="width:100%;height:55vh;font-family:monospace;font-size:13px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:10px;"></textarea>';
    document.getElementById('auText').value = state.content;
  };
  document.getElementById('auTabPreview').addEventListener('click', showPreview);
  document.getElementById('auTabEdit').addEventListener('click', showEdit);
  return { showPreview, showEdit, sync };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function loadAuthoring() {
  const root = document.getElementById('panel-authoring');
  if (!root) return;

  // Detect whether there is an active book to decide the initial scope.
  let hasActiveBook = false;
  try {
    const a = await api('GET', '/api/books/active');
    hasActiveBook = !!(a.active && a.active.slug);
  } catch (e) { /* non-fatal — stay on library */ }

  _scope = hasActiveBook ? 'book' : 'library';
  _kind = 'author';
  _currentFile = null;

  root.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
      '<h3 style="margin:0;flex:1;">Editor</h3>' +
      '<button class="small" id="auNewItem">+ New</button>' +
      '<button class="small secondary" id="auReload">Reload from disk</button>' +
    '</div>' +
    // Scope toggle
    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
      '<button class="small' + (_scope === 'library' ? '' : ' secondary') + '" id="auScopeLibrary">Library</button>' +
      '<button class="small' + (_scope === 'book' ? '' : ' secondary') + '" id="auScopeBook">This Book</button>' +
    '</div>' +
    // Kind selector
    '<div id="auKindRow" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div id="auList" style="width:300px;flex-shrink:0;max-height:70vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;"></div>' +
      '<div id="auEditor" style="flex:1;min-width:0;"></div>' +
    '</div>';

  root.querySelector('#auReload').addEventListener('click', async () => {
    try { await api('POST', '/api/authoring/reload'); showToast('Reloaded from disk', 'success'); await loadAuthoring(); }
    catch (e) { showToast('Reload failed: ' + e.message, 'error'); }
  });

  root.querySelector('#auNewItem').addEventListener('click', () => handleNew());

  root.querySelector('#auScopeLibrary').addEventListener('click', () => {
    _scope = 'library';
    document.getElementById('auScopeLibrary').classList.remove('secondary');
    document.getElementById('auScopeBook').classList.add('secondary');
    document.getElementById('auEditor').innerHTML = '';
    renderKindRow();
    renderList();
  });

  root.querySelector('#auScopeBook').addEventListener('click', () => {
    _scope = 'book';
    document.getElementById('auScopeBook').classList.remove('secondary');
    document.getElementById('auScopeLibrary').classList.add('secondary');
    document.getElementById('auEditor').innerHTML = '';
    renderKindRow();
    renderList();
  });

  renderKindRow();
  await renderList();
}

function renderKindRow() {
  const row = document.getElementById('auKindRow');
  if (!row) return;
  row.innerHTML = KINDS.map((k) =>
    '<button class="small' + (_kind === k.kind ? '' : ' secondary') + '" data-kind="' + k.kind + '">' + k.label + '</button>'
  ).join('');
  row.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      _kind = btn.getAttribute('data-kind');
      _currentFile = null;
      row.querySelectorAll('button').forEach((b) => b.classList.add('secondary'));
      btn.classList.remove('secondary');
      document.getElementById('auEditor').innerHTML = '';
      renderList();
    });
  });
}

// ─── List rendering ───────────────────────────────────────────────────────────

async function renderList() {
  const el = document.getElementById('auList');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;">Loading…</div>';

  if (_scope === 'library') {
    await renderLibraryList(el);
  } else {
    await renderBookList(el);
  }
}

async function renderLibraryList(el) {
  if (_kind === 'skill') {
    // Skills: use existing /api/skills endpoint
    let skills = { skills: [] };
    try { skills = await api('GET', '/api/skills'); }
    catch (e) { el.innerHTML = '<div style="color:var(--danger);padding:8px;">Failed: ' + esc(e.message) + '</div>'; return; }

    const byCat = {};
    for (const s of (skills.skills || [])) { (byCat[s.category] = byCat[s.category] || []).push(s); }
    let html = '';
    for (const cat of Object.keys(byCat).sort()) {
      html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);margin:8px 0 4px;">' + esc(cat) + '</div>';
      for (const s of byCat[cat].sort((a, b) => a.name.localeCompare(b.name))) {
        html += '<div class="au-item" data-name="' + esc(s.name) + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:6px;align-items:center;">' +
          '<span>' + esc(s.name) + '</span>' + badge(s.source) + '</div>';
      }
    }
    el.innerHTML = html || '<div style="color:var(--muted);font-size:12px;padding:8px;">No skills found.</div>';
    el.querySelectorAll('.au-item').forEach((item) => {
      item.addEventListener('click', () => openSkill(item.getAttribute('data-name')));
    });
    return;
  }

  // Non-skill library kinds
  let data = { entries: [] };
  try { data = await api('GET', '/api/library/' + encodeURIComponent(_kind)); }
  catch (e) { el.innerHTML = '<div style="color:var(--danger);padding:8px;">Failed: ' + esc(e.message) + '</div>'; return; }

  const entries = data.entries || [];
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;">No entries found.</div>';
    return;
  }

  let html = '';
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const canDelete = entry.source === 'workspace';
    html += '<div class="au-item" data-name="' + esc(entry.name) + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:6px;align-items:center;">' +
      '<span>' + esc(entry.name) + '</span>' +
      '<span style="display:flex;gap:4px;align-items:center;">' +
        badge(entry.source) +
        (canDelete ? '<button class="small danger au-del" data-name="' + esc(entry.name) + '" style="font-size:10px;padding:2px 6px;" title="Delete overlay entry">✕</button>' : '') +
      '</span>' +
    '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.au-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('au-del')) return;
      openLibraryEntry(item.getAttribute('data-name'));
    });
  });
  el.querySelectorAll('.au-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.getAttribute('data-name');
      if (!confirm('Delete workspace overlay "' + name + '"? The built-in will be restored if one exists.')) return;
      try {
        await api('DELETE', '/api/library/' + encodeURIComponent(_kind) + '/' + encodeURIComponent(name));
        showToast('Deleted ' + name, 'success');
        document.getElementById('auEditor').innerHTML = '';
        await renderList();
      } catch (e2) { showToast('Delete failed: ' + e2.message, 'error'); }
    });
  });
}

async function renderBookList(el) {
  let data;
  try { data = await api('GET', '/api/books/active/repull'); }
  catch (e) {
    if (e.message && e.message.includes('409')) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;">No active book. Set one in the Books panel.</div>';
    } else {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;">No active book. Set one in the Books panel.</div>';
    }
    return;
  }

  // Repull uses singular kinds: author, voice, genre, pipeline, section, skill
  const repullKind = _kind; // already singular
  const assets = (data.assets || []).filter((a) => a.kind === repullKind);

  if (!assets.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;">No ' + esc(_kind) + ' assets in this book.</div>';
    return;
  }

  let html = '';
  for (const asset of assets.sort((a, b) => a.name.localeCompare(b.name))) {
    const statusColor = asset.status === 'ok' ? 'var(--success)' : asset.status === 'readonly' ? 'var(--info)' : 'var(--muted)';
    html += '<div class="au-item" data-name="' + esc(asset.name) + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:6px;align-items:center;">' +
      '<span>' + esc(asset.name) + '</span>' +
      '<span style="font-size:10px;color:' + statusColor + ';">' + esc(asset.status || '') + '</span>' +
    '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.au-item').forEach((item) => {
    item.addEventListener('click', () => openBookEntry(item.getAttribute('data-name')));
  });
}

// ─── Opening entries ──────────────────────────────────────────────────────────

async function openLibraryEntry(name) {
  if (_kind === 'skill') { openSkill(name); return; }

  let data;
  try { data = await api('GET', '/api/library/' + encodeURIComponent(_kind) + '/' + encodeURIComponent(name)); }
  catch (e) { showToast('Load failed: ' + e.message, 'error'); return; }
  const entry = data.entry;
  const isWorkspace = entry.source === 'workspace';

  if (MULTI_FILE_KINDS.has(_kind)) {
    // author / voice / genre: multi-file
    const files = entry.files || {};
    const fileNames = Object.keys(files);
    if (!fileNames.length) {
      showToast('No .md files found in this entry.', 'error');
      return;
    }
    // Pick default file
    const preferred = ['SOUL.md', 'STYLE-GUIDE.md'];
    _currentFile = fileNames.find((f) => preferred.includes(f)) || fileNames[0];

    renderMultiFileEditor({
      entryName: name,
      files,
      source: entry.source,
      readOnly: !isWorkspace,
      saveHandler: async (fname, content) => {
        await api('PUT', '/api/library/' + encodeURIComponent(_kind) + '/' + encodeURIComponent(name),
          { files: { [fname]: content } });
        showToast('Saved ' + fname, 'success');
      },
    });
    return;
  }

  if (_kind === 'pipeline') {
    const rawContent = entry.pipeline ? JSON.stringify(entry.pipeline, null, 2) : (entry.content || '{}');
    const state = { content: rawContent };
    const actions =
      (isWorkspace ? '<button class="success" id="auSave">Save</button>' : '') +
      (!isWorkspace ? '<span style="color:var(--muted);font-size:12px;">Built-in — read-only. Create a workspace copy via "+ New".</span>' : '');
    editorShell(esc(name), badge(entry.source), '', actions);
    const tabs = wireTabs(state);
    tabs.showEdit();
    if (isWorkspace) {
      document.getElementById('auSave').addEventListener('click', async () => {
        tabs.sync();
        let parsed;
        try { parsed = JSON.parse(state.content); }
        catch { showToast('Invalid JSON — fix before saving.', 'error'); return; }
        if (!Array.isArray(parsed.steps) || typeof parsed.schemaVersion !== 'number') {
          showToast('Pipeline JSON must have schemaVersion (number) and steps (array).', 'error'); return;
        }
        try {
          await api('PUT', '/api/library/' + encodeURIComponent(_kind) + '/' + encodeURIComponent(name), { content: state.content });
          showToast('Saved pipeline ' + name, 'success');
        } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
      });
    }
    return;
  }

  if (_kind === 'section') {
    const rawContent = entry.content || '';
    const state = { content: rawContent };
    const actions =
      (isWorkspace ? '<button class="success" id="auSave">Save</button>' : '') +
      (!isWorkspace ? '<span style="color:var(--muted);font-size:12px;">Built-in — read-only.</span>' : '');
    editorShell(esc(name), badge(entry.source), '', actions);
    const tabs = wireTabs(state);
    tabs.showPreview();
    if (isWorkspace) {
      document.getElementById('auSave').addEventListener('click', async () => {
        tabs.sync();
        try {
          await api('PUT', '/api/library/' + encodeURIComponent(_kind) + '/' + encodeURIComponent(name), { content: state.content });
          showToast('Saved ' + name, 'success');
        } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
      });
    }
    return;
  }
}

async function openBookEntry(name) {
  if (_kind === 'skill') {
    await openBookSkill(name);
    return;
  }

  const templatePath = toTemplatePath(_kind);

  if (MULTI_FILE_KINDS.has(_kind)) {
    // author / voice / genre
    let data;
    try { data = await api('GET', '/api/books/active/templates/' + encodeURIComponent(templatePath)); }
    catch (e) { showToast('Load failed: ' + e.message, 'error'); return; }
    const files = data.files || {};
    const wired = data.wired;

    renderMultiFileEditor({
      entryName: name,
      files,
      source: 'book',
      wired,
      saveHandler: async (fname, content) => {
        await api('PUT', '/api/books/active/templates/' + encodeURIComponent(templatePath),
          { files: { [fname]: content } });
        showToast('Saved ' + fname, 'success');
      },
    });
    return;
  }

  if (_kind === 'pipeline') {
    let data;
    try { data = await api('GET', '/api/books/active/templates/pipeline'); }
    catch (e) { showToast('Load failed: ' + e.message, 'error'); return; }
    const state = { content: data.content || '{}' };
    const wiredNote = '<span style="color:var(--success);font-size:11px;">Active in generation</span>';
    editorShell(esc(name), wiredNote, '', '<button class="success" id="auSave">Save</button>');
    const tabs = wireTabs(state);
    tabs.showEdit();
    document.getElementById('auSave').addEventListener('click', async () => {
      tabs.sync();
      let parsed;
      try { parsed = JSON.parse(state.content); }
      catch { showToast('Invalid JSON — fix before saving.', 'error'); return; }
      if (!Array.isArray(parsed.steps) || typeof parsed.schemaVersion !== 'number') {
        showToast('Pipeline JSON must have schemaVersion (number) and steps (array).', 'error'); return;
      }
      try {
        await api('PUT', '/api/books/active/templates/pipeline', { content: state.content });
        showToast('Saved pipeline', 'success');
      } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
    });
    return;
  }

  if (_kind === 'section') {
    let data;
    try { data = await api('GET', '/api/books/active/templates/sections/' + encodeURIComponent(name)); }
    catch (e) { showToast('Load failed: ' + e.message, 'error'); return; }
    const state = { content: data.content || '' };
    const wiredNote = '<span style="color:var(--muted);font-size:11px;">Stored — not yet active in generation.</span>';
    editorShell(esc(name), wiredNote, '', '<button class="success" id="auSave">Save</button>');
    const tabs = wireTabs(state);
    tabs.showPreview();
    document.getElementById('auSave').addEventListener('click', async () => {
      tabs.sync();
      try {
        await api('PUT', '/api/books/active/templates/sections/' + encodeURIComponent(name), { content: state.content });
        showToast('Saved section ' + name, 'success');
      } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
    });
    return;
  }
}

// ─── Multi-file editor helper ─────────────────────────────────────────────────

function renderMultiFileEditor({ entryName, files, source, wired, readOnly, saveHandler }) {
  const fileNames = Object.keys(files);
  if (!_currentFile || !files[_currentFile]) {
    const preferred = ['SOUL.md', 'STYLE-GUIDE.md', 'VOICE-PROFILE.md'];
    _currentFile = fileNames.find((f) => preferred.includes(f)) || fileNames[0] || null;
  }
  if (!_currentFile) { showToast('No files in this entry.', 'error'); return; }

  const state = { content: files[_currentFile] || '' };

  const wiredNote = wired === false
    ? '<span style="color:var(--muted);font-size:11px;">Stored — not yet active in generation.</span>'
    : (wired === true ? '<span style="color:var(--success);font-size:11px;">Active in generation</span>' : (source === 'book' ? '' : ''));

  const sourceBadge = source === 'book' ? wiredNote : badge(source);
  const saveBtn = readOnly
    ? '<span style="color:var(--muted);font-size:12px;">Built-in — read-only. Create a workspace copy via "+ New".</span>'
    : '<button class="success" id="auSave">Save</button>';

  editorShell(esc(entryName), sourceBadge, '', saveBtn);

  // File sub-picker above the body
  if (fileNames.length > 1) {
    const pickerHtml = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">' +
      fileNames.map((f) =>
        '<button class="small' + (f === _currentFile ? '' : ' secondary') + ' au-filepick" data-file="' + esc(f) + '">' + esc(f) + '</button>'
      ).join('') +
    '</div>';
    document.getElementById('auBody').insertAdjacentHTML('beforebegin', pickerHtml);
  }

  const tabs = wireTabs(state);
  tabs.showEdit();

  // Wire file picker buttons
  document.querySelectorAll('.au-filepick').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.sync();
      files[_currentFile] = state.content; // cache edited content
      _currentFile = btn.getAttribute('data-file');
      state.content = files[_currentFile] || '';
      // Re-highlight picker buttons
      document.querySelectorAll('.au-filepick').forEach((b) => b.classList.add('secondary'));
      btn.classList.remove('secondary');
      // Refresh textarea
      const t = document.getElementById('auText');
      if (t) t.value = state.content;
    });
  });

  if (!readOnly) {
    document.getElementById('auSave').addEventListener('click', async () => {
      tabs.sync();
      files[_currentFile] = state.content;
      try {
        await saveHandler(_currentFile, state.content);
      } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
    });
  }
}

// ─── Skills (existing behavior preserved) ────────────────────────────────────

async function openSkill(name) {
  let data;
  try { data = await api('GET', '/api/skills/' + encodeURIComponent(name)); } catch (e) { return showToast('Load failed: ' + e.message, 'error'); }
  const s = data.skill;
  const state = { content: s.content };
  const editable = s.source === 'workspace';
  const actions =
    '<button class="success" id="auSave">' + (editable ? 'Save' : 'Save to workspace') + '</button>' +
    '<button class="small" id="auSaveAs">Save as new…</button>' +
    (editable ? '<button class="small danger" id="auDelete" style="margin-left:auto;">Delete</button>' : '');
  editorShell(esc(s.name), badge(s.source), '', actions);
  const tabs = wireTabs(state);
  tabs.showPreview();

  document.getElementById('auSave').addEventListener('click', async () => {
    tabs.sync();
    try {
      await api('PUT', '/api/skills/' + encodeURIComponent(s.name), { category: s.category, content: state.content });
      showToast('Saved ' + s.name + ' to workspace', 'success');
      await renderList();
      openSkill(s.name);
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
  });
  document.getElementById('auSaveAs').addEventListener('click', () => { tabs.sync(); openSkillCreate({ category: s.category, content: state.content }); });
  const delBtn = document.getElementById('auDelete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete workspace skill "' + s.name + '"? If it overrode a built-in, the built-in is restored.')) return;
    try { await api('DELETE', '/api/skills/' + encodeURIComponent(s.name)); showToast('Deleted ' + s.name, 'success'); document.getElementById('auEditor').innerHTML = ''; await renderList(); }
    catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  });
}

async function openBookSkill(name) {
  // Book scope: read the skill's SKILL.md from the book snapshot.
  let data;
  try { data = await api('GET', '/api/books/active/templates/skills/' + encodeURIComponent(name)); }
  catch (e) { showToast('Load failed: ' + e.message, 'error'); return; }
  const files = data.files || {};
  const wired = data.wired;
  const content = files['SKILL.md'] || '';
  const state = { content };

  const wiredNote = wired === false
    ? '<span style="color:var(--muted);font-size:11px;">Stored — not yet active in generation.</span>'
    : '';
  editorShell(esc(name), wiredNote, '', '<button class="success" id="auSave">Save</button>');
  const tabs = wireTabs(state);
  tabs.showPreview();

  document.getElementById('auSave').addEventListener('click', async () => {
    tabs.sync();
    try {
      await api('PUT', '/api/books/active/templates/skills/' + encodeURIComponent(name), { files: { 'SKILL.md': state.content } });
      showToast('Saved skill ' + name, 'success');
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); }
  });
}

// Create a new workspace skill (optionally seeded from an existing one's content).
function openSkillCreate(seed) {
  seed = seed || {};
  const catOpts = SKILL_CATEGORIES.map((c) => '<option value="' + c + '"' + (seed.category === c ? ' selected' : '') + '>' + c + '</option>').join('');
  const head =
    '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
      '<input id="auNewName" placeholder="skill-name (lowercase, hyphens)" style="flex:1;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;">' +
      '<select id="auNewCat" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;">' + catOpts + '</select>' +
    '</div>';
  editorShell('New skill', '', '', '<button class="success" id="auCreate">Create</button>');
  document.getElementById('auBody').insertAdjacentHTML('beforebegin', head);
  const state = { content: seed.content || SKILL_TEMPLATE };
  const tabs = wireTabs(state);
  tabs.showEdit();
  document.getElementById('auCreate').addEventListener('click', async () => {
    tabs.sync();
    const name = document.getElementById('auNewName').value.trim();
    const category = document.getElementById('auNewCat').value;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return showToast('Invalid name (lowercase letters, digits, hyphens)', 'error');
    try {
      await api('PUT', '/api/skills/' + encodeURIComponent(name), { category, content: state.content });
      showToast('Created ' + name, 'success');
      await renderList();
      openSkill(name);
    } catch (e) { showToast('Create failed: ' + e.message, 'error'); }
  });
}

// ─── "+ New" handler ─────────────────────────────────────────────────────────

async function handleNew() {
  if (_scope === 'book') {
    showToast('Create new entries in Library scope — they can then be snapshot into a book.', 'info');
    return;
  }

  if (_kind === 'skill') {
    openSkillCreate();
    return;
  }

  if (_kind === 'pipeline') {
    const name = prompt('Pipeline name (lowercase, hyphens, e.g. my-pipeline):');
    if (!name) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { showToast('Invalid name (lowercase, hyphens only)', 'error'); return; }
    const starter = JSON.stringify(
      { schemaVersion: 1, name, label: name, description: '', steps: [] },
      null, 2
    );
    try {
      await api('POST', '/api/library/' + encodeURIComponent(_kind), { name, content: starter });
      showToast('Created ' + name, 'success');
      await renderList();
      openLibraryEntry(name);
    } catch (e) { showToast('Create failed: ' + e.message, 'error'); }
    return;
  }

  if (_kind === 'section') {
    const name = prompt('Section name (lowercase, hyphens, e.g. world-building):');
    if (!name) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { showToast('Invalid name (lowercase, hyphens only)', 'error'); return; }
    try {
      await api('POST', '/api/library/' + encodeURIComponent(_kind), { name, content: '# ' + name + '\n' });
      showToast('Created ' + name, 'success');
      await renderList();
      openLibraryEntry(name);
    } catch (e) { showToast('Create failed: ' + e.message, 'error'); }
    return;
  }

  // author / voice / genre
  const name = prompt(_kind.charAt(0).toUpperCase() + _kind.slice(1) + ' name (lowercase, hyphens, e.g. my-' + _kind + '):');
  if (!name) return;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { showToast('Invalid name (lowercase, hyphens only)', 'error'); return; }
  const starters = NEW_STARTERS[_kind] || { 'notes.md': '' };
  try {
    await api('POST', '/api/library/' + encodeURIComponent(_kind), { name, files: starters });
    showToast('Created ' + name, 'success');
    await renderList();
    _currentFile = null;
    openLibraryEntry(name);
  } catch (e) { showToast('Create failed: ' + e.message, 'error'); }
}
