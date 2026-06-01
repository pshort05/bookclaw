// Library panel: uploaded documents list + compiled outputs; upload wiring.
import { state } from '../lib/state.js';
import { api, apiRaw } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc, formatBytes, formatDate } from '../lib/format.js';
import { openProjectDetail } from './projects.js';
import { switchPanel } from '../main.js';

export function loadDocuments() {
  api('GET', '/api/documents').then(function(data) {
    var docs = data.documents || data || [];
    renderDocuments(docs);
    loadCompiledOutputs();
  }).catch(function() {
    document.getElementById('docList').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">Could not load documents.</div>';
  });
}

export function renderDocuments(docs) {
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

export function loadCompiledOutputs() {
  // Try to find manuscripts from completed projects
  var completed = state.allProjects.filter(function(p) { return p.status === 'completed'; });
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
