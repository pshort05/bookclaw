// Authoring panel: view + edit author prompts (soul/*.md) and skills (SKILL.md)
// with live reload — no redeploy. Backed by /api/prompts and /api/skills.
// Markdown is rendered for preview (marked); editing is raw text.
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

// Render markdown to a safe-ish HTML string for preview (single-user local tool).
function md(text) {
  try { return marked.parse(text || '', { breaks: true }); }
  catch { return '<pre>' + esc(text || '') + '</pre>'; }
}

function badge(source) {
  const color = source === 'workspace' ? 'var(--success)' : source === 'synthetic' ? 'var(--info)' : 'var(--muted)';
  return '<span class="badge" style="font-size:9px;background:transparent;border:1px solid ' + color + ';color:' + color + ';">' + esc(source) + '</span>';
}

export async function loadAuthoring() {
  const root = document.getElementById('panel-authoring');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
      '<h3 style="margin:0;flex:1;">Prompts &amp; Skills</h3>' +
      '<button class="small" id="auNewSkill">+ New Skill</button>' +
      '<button class="small secondary" id="auReload">Reload from disk</button>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Edit author identity (prompts) and skills live — changes apply immediately, no restart. User edits are saved to the workspace and override the built-ins; built-in skills are read-only (clone them with “Save as new”).</div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div id="auList" style="width:300px;flex-shrink:0;max-height:70vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;"></div>' +
      '<div id="auEditor" style="flex:1;min-width:0;"></div>' +
    '</div>';

  root.querySelector('#auReload').addEventListener('click', async () => {
    try { await api('POST', '/api/authoring/reload'); showToast('Reloaded from disk', 'success'); await loadAuthoring(); }
    catch (e) { showToast('Reload failed: ' + e.message, 'error'); }
  });
  root.querySelector('#auNewSkill').addEventListener('click', () => openSkillCreate());

  await renderList();
}

async function renderList() {
  const el = document.getElementById('auList');
  if (!el) return;
  let prompts = { files: [] }, skills = { skills: [] };
  try { [prompts, skills] = await Promise.all([api('GET', '/api/prompts'), api('GET', '/api/skills')]); }
  catch (e) { el.innerHTML = '<div style="color:var(--danger);padding:8px;">Failed to load: ' + esc(e.message) + '</div>'; return; }

  let html = '<div style="font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);margin:4px 0 6px;">Prompts</div>';
  for (const f of (prompts.files || [])) {
    html += '<div class="au-item" data-kind="prompt" data-id="' + esc(f.file) + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;">' +
      esc(f.file) + (f.exists ? '' : ' <span style="color:var(--muted);font-size:11px;">(empty)</span>') + '</div>';
  }

  const byCat = {};
  for (const s of (skills.skills || [])) { (byCat[s.category] = byCat[s.category] || []).push(s); }
  for (const cat of Object.keys(byCat).sort()) {
    html += '<div style="font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);margin:12px 0 6px;">' + esc(cat) + '</div>';
    for (const s of byCat[cat].sort((a, b) => a.name.localeCompare(b.name))) {
      html += '<div class="au-item" data-kind="skill" data-id="' + esc(s.name) + '" style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:6px;align-items:center;">' +
        '<span>' + esc(s.name) + '</span>' + badge(s.source) + '</div>';
    }
  }
  el.innerHTML = html;
  el.querySelectorAll('.au-item').forEach((item) => {
    item.addEventListener('click', () => {
      const kind = item.getAttribute('data-kind');
      const id = item.getAttribute('data-id');
      if (kind === 'prompt') openPrompt(id); else openSkill(id);
    });
  });
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

// Manages a single source of truth (state.content) across Preview/Edit toggles:
// entering Edit fills the textarea FROM state.content; leaving Edit (switching to
// preview, or before save) syncs the textarea value BACK into state.content. Call
// sync() before reading state.content for a save.
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

async function openPrompt(file) {
  let data;
  try { data = await api('GET', '/api/prompts'); } catch (e) { return showToast('Load failed: ' + e.message, 'error'); }
  const f = (data.files || []).find((x) => x.file === file) || { file, content: '' };
  const state = { content: f.content };
  editorShell(esc(file), '', '', '<button class="success" id="auSave">Save</button>');
  const tabs = wireTabs(state);
  tabs.showEdit();
  document.getElementById('auSave').addEventListener('click', async () => {
    tabs.sync();
    try { await api('PUT', '/api/prompts/' + encodeURIComponent(file), { content: state.content }); showToast('Saved ' + file, 'success'); }
    catch (e) { showToast('Save failed: ' + e.message, 'error'); }
  });
}

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
  // Insert the name/category row above the editor body.
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
