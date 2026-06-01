// Transient toast notification (info/success/error). Replaces any visible toast.
export function showToast(message, type) {
  type = type || 'info';
  document.querySelectorAll('.toast').forEach(function(t) { t.remove(); });
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4500);
}
