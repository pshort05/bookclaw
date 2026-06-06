// Books panel (book-container Phase 2): list existing books and create a new one
// by selecting library components. Backed by /api/books and /api/library.
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc } from '../lib/format.js';

function statusBadge(status) {
  const map = { ok: 'var(--success)', readonly: 'var(--info)', quarantined: 'var(--danger)' };
  const color = map[status] || 'var(--muted)';
  return '<span class="badge" style="font-size:9px;background:transparent;border:1px solid ' + color + ';color:' + color + ';">' + esc(status) + '</span>';
}

export async function loadBooks() {
  const root = document.getElementById('panel-books');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
      '<h3 style="margin:0;flex:1;">Books</h3>' +
      '<button class="small" id="bkNew">+ New Book</button>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">A book is a self-contained container. Creating one snapshots the chosen library templates into the book; editing the library later does not change existing books (re-pull comes in a later phase). Books do not drive generation yet.</div>' +
    '<div id="bkList"></div>' +
    '<div id="bkCreate" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;"></div>';

  root.querySelector('#bkNew').addEventListener('click', () => openCreate());
  await renderList();
}

async function renderList() {
  const el = document.getElementById('bkList');
  if (!el) return;
  let data = { books: [] };
  try { data = await api('GET', '/api/books'); }
  catch (e) { el.innerHTML = '<div style="color:var(--danger);">Failed to load books: ' + esc(e.message) + '</div>'; return; }
  if (!data.books.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No books yet. Click “New Book” to create one.</div>'; return; }
  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  html += '<tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;"><th style="padding:6px 8px;">Title</th><th>Phase</th><th>Status</th><th>Created</th></tr>';
  for (const b of data.books) {
    html += '<tr style="border-top:1px solid var(--border);">' +
      '<td style="padding:6px 8px;">' + esc(b.title) + ' <span style="color:var(--muted);font-size:11px;">' + esc(b.slug) + '</span></td>' +
      '<td>' + esc(b.phase) + '</td>' +
      '<td>' + statusBadge(b.status) + '</td>' +
      '<td style="color:var(--muted);">' + esc((b.createdAt || '').slice(0, 10)) + '</td>' +
      '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

async function openCreate() {
  const box = document.getElementById('bkCreate');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div style="color:var(--muted);font-size:13px;">Loading library components…</div>';

  let lib;
  try { lib = await api('GET', '/api/library'); }
  catch (e) { box.innerHTML = '<div style="color:var(--danger);">Failed to load library: ' + esc(e.message) + '</div>'; return; }

  const byKind = { author: [], genre: [], pipeline: [], section: [] };
  (lib.entries || []).forEach((e) => { if (byKind[e.kind]) byKind[e.kind].push(e); });

  const opts = (arr) => arr.map((e) => '<option value="' + esc(e.name) + '">' + esc(e.name) + ' (' + esc(e.source) + ')</option>').join('');
  const sectionChecks = byKind.section.map((e) =>
    '<label style="display:block;font-size:13px;"><input type="checkbox" class="bkSection" value="' + esc(e.name) + '" checked> ' + esc(e.name) + '</label>'
  ).join('') || '<span style="color:var(--muted);font-size:12px;">none</span>';

  box.innerHTML =
    '<h4 style="margin:0 0 12px;">New Book</h4>' +
    '<div style="display:grid;grid-template-columns:120px 1fr;gap:10px 12px;max-width:560px;align-items:center;">' +
      '<label>Title</label><input id="bkTitle" type="text" placeholder="My Novel" style="width:100%;">' +
      '<label>Author</label><select id="bkAuthor">' + opts(byKind.author) + '</select>' +
      '<label>Genre</label><select id="bkGenre"><option value="">(none)</option>' + opts(byKind.genre) + '</select>' +
      '<label>Pipeline</label><select id="bkPipeline">' + opts(byKind.pipeline) + '</select>' +
      '<label style="align-self:start;">Sections</label><div>' + sectionChecks + '</div>' +
    '</div>' +
    '<div style="margin-top:14px;display:flex;gap:8px;">' +
      '<button class="small" id="bkCreateBtn">Create book</button>' +
      '<button class="small secondary" id="bkCancel">Cancel</button>' +
    '</div>' +
    '<div id="bkErr" style="color:var(--danger);font-size:12px;margin-top:8px;"></div>';

  box.querySelector('#bkCancel').addEventListener('click', () => { box.style.display = 'none'; box.innerHTML = ''; });
  box.querySelector('#bkCreateBtn').addEventListener('click', () => submitCreate(box));
}

async function submitCreate(box) {
  const title = box.querySelector('#bkTitle').value.trim();
  const author = box.querySelector('#bkAuthor').value;
  const genre = box.querySelector('#bkGenre').value || null;
  const pipeline = box.querySelector('#bkPipeline').value;
  const sections = Array.prototype.slice.call(box.querySelectorAll('.bkSection:checked')).map((c) => c.value);
  const err = box.querySelector('#bkErr');
  err.textContent = '';
  if (!title) { err.textContent = 'Title is required.'; return; }
  if (!author) { err.textContent = 'Pick an author (the library has none — create one first).'; return; }
  if (!pipeline) { err.textContent = 'Pick a pipeline.'; return; }
  try {
    const res = await api('POST', '/api/books', { title, author, genre, pipeline, sections });
    showToast('Created book: ' + res.book.title, 'success');
    box.style.display = 'none'; box.innerHTML = '';
    await renderList();
  } catch (e) {
    err.textContent = 'Create failed: ' + e.message;
  }
}
