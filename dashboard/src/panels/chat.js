// Chat panel: message rendering + send (wires its own send button/Enter key
// on load; no exports — imported for side effects).
import { state } from '../lib/state.js';
import { api } from '../lib/api.js';
import { loadProjects } from './projects.js';

// ================================================================
// CHAT INTERFACE
// ================================================================
export function addChatMsg(text, role) {
  var el = document.getElementById('chatMessages');
  var msg = document.createElement('div');
  msg.className = 'chat-msg ' + role;
  msg.textContent = text;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
}

export function showTyping() {
  removeTyping();
  var el = document.getElementById('chatMessages');
  var ind = document.createElement('div');
  ind.className = 'typing-indicator';
  ind.id = 'typingIndicator';
  ind.innerHTML = '<span>.</span><span>.</span><span>.</span> BookClaw is thinking';
  el.appendChild(ind);
  el.scrollTop = el.scrollHeight;
}

export function removeTyping() {
  var ind = document.getElementById('typingIndicator');
  if (ind) ind.remove();
}

export function sendChat() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || state.chatWaiting) return;
  addChatMsg(text, 'user');
  input.value = '';
  state.chatWaiting = true;
  showTyping();

  api('POST', '/api/chat', { message: text }).then(function(data) {
    removeTyping();
    state.chatWaiting = false;
    addChatMsg(data.response || 'No response received.', 'bot');
    // Refresh projects if a command might have created/changed one
    if (text.startsWith('/')) { loadProjects(); }
  }).catch(function(e) {
    removeTyping();
    state.chatWaiting = false;
    addChatMsg('Error: ' + e.message, 'system');
  });
}

document.getElementById('btnChatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
document.getElementById('btnChatClear').addEventListener('click', function() {
  var el = document.getElementById('chatMessages');
  el.innerHTML = '<div class="chat-msg bot">Hello! I\'m BookClaw, your AI writing partner. How can I help you today?</div>';
  state.chatWaiting = false;
});
