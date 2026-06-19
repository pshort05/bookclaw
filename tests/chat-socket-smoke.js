#!/usr/bin/env node
/**
 * BookClaw — chat Socket.IO round-trip smoke (REAL AI for the greeting).
 *
 * Exercises the SAME path the studio chat + standalone Chat app use: a Socket.IO
 * connection (not POST /api/chat). Asserts that slash commands are dispatched over
 * the socket — the bug this covers was that the socket handler sent `/editors`
 * straight to the model instead of the command handler. Verifies: `/editors`
 * returns the numbered selection menu, `/editor maeve brainstorm` enters and
 * returns an in-character AI greeting (real call), and `/editor off` exits — all
 * over one socket connection (so editor mode is keyed to this socket's channel).
 *
 * Usage:  BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN=... node tests/chat-socket-smoke.js
 * Exits non-zero on any failed assertion.
 */
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3847';
const TOKEN = process.env.BOOKCLAW_AUTH_TOKEN || '';
if (!TOKEN) { console.error('ERROR: BOOKCLAW_AUTH_TOKEN required'); process.exit(1); }

let passes = 0, fails = 0;
const pass = (m, x) => { passes++; console.log(`  [PASS] ${m}${x ? ' :: ' + x : ''}`); };
const fail = (m, x) => { fails++; console.log(`  [FAIL] ${m}${x ? ' :: ' + x : ''}`); };

const socket = io(BASE_URL, { auth: { token: TOKEN }, transports: ['websocket', 'polling'], reconnection: false });

/** Send one message and resolve with the next `response` text (or reject on timeout). */
function send(content, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('response', onResp); reject(new Error('timeout')); }, timeoutMs);
    const onResp = (data) => { clearTimeout(timer); socket.off('response', onResp); resolve(String(data?.content ?? '')); };
    socket.on('response', onResp);
    socket.emit('message', { content });
  });
}

const connectTimer = setTimeout(() => { console.error('ERROR: socket connect timeout'); process.exit(1); }, 15000);

socket.on('connect_error', (e) => { console.error('ERROR: connect_error', e.message); process.exit(1); });

socket.on('connect', async () => {
  clearTimeout(connectTimer);
  console.log(`▶ Chat socket smoke → ${BASE_URL} (socket ${socket.id})`);
  try {
    // 1. /editors over the socket → the numbered menu (NOT an AI reply).
    const menu = await send('/editors', 20000);
    if (/\/editor\s+\w+\s+brainstorm/i.test(menu) && /critique/i.test(menu)) {
      pass('socket /editors dispatches the menu', menu.slice(0, 50).replace(/\n/g, ' '));
    } else {
      fail('socket /editors did not return the menu', menu.slice(0, 160).replace(/\n/g, ' '));
    }

    // 2. Enter brainstorm mode → in-character AI greeting (real call).
    const greet = await send('/editor maeve brainstorm', 120000);
    if (greet && greet.length > 20 && !greet.includes('[AI provider failure]') && !/^Unknown editor/i.test(greet)) {
      pass('socket /editor maeve brainstorm returns a greeting', greet.slice(0, 50).replace(/\n/g, ' '));
    } else {
      fail('socket brainstorm greeting empty/failed', greet.slice(0, 160).replace(/\n/g, ' '));
    }

    // 3. Exit editor mode.
    const off = await send('/editor off', 20000);
    if (/normal chat/i.test(off)) pass('socket /editor off exits');
    else fail('socket /editor off did not confirm', off.slice(0, 120).replace(/\n/g, ' '));
  } catch (e) {
    fail('socket round-trip threw', String(e?.message || e));
  } finally {
    socket.close();
    console.log(`  SUMMARY: ${passes} passed, ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }
});
