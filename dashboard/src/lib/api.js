// HTTP helpers + the injected auth token. API base is same-origin ('').
// AUTH_TOKEN is replaced in the served HTML by the server (placeholder below).
const API = '';
// Auth token injected by the server into the served HTML. Empty when auth is disabled.
const AUTH_TOKEN = '__BOOKCLAW_AUTH_TOKEN__';

export function authHeaders(base) {
  base = base || {};
  if (AUTH_TOKEN) base['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  return base;
}

// For native-element GETs (img/href/Audio) that can't send an Authorization header,
// the server also accepts the token as a ?token= query param.
export function authUrl(path) {
  if (!AUTH_TOKEN) return path;
  return path + (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(AUTH_TOKEN);
}

export function api(method, path, body) {
  var opts = { method: method, headers: authHeaders({ 'Content-Type': 'application/json' }) };
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts).then(function(res) {
    var ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      if (ct.indexOf('application/json') !== -1) {
        return res.json().then(function(d) { throw new Error(d.error || ('HTTP ' + res.status)); });
      }
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }
    if (ct.indexOf('application/json') === -1) {
      throw new Error('Server returned non-JSON response');
    }
    return res.json();
  });
}

export function apiRaw(method, path, body) {
  var opts = { method: method, headers: authHeaders() };
  if (body) { opts.body = body; }
  return fetch(API + path, opts).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}
