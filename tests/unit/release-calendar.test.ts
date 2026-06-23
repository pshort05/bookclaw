import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseCalendarService } from '../../gateway/src/services/release-calendar.js';

// Each test gets its own throwaway workspace dir so persisted JSON never
// cross-contaminates. We never call initialize() with a pre-seeded file, so
// no fixture files are needed.
let n = 0;
function freshSvc(): ReleaseCalendarService {
  return new ReleaseCalendarService(join(tmpdir(), `relcal-test-${process.pid}-${n++}`));
}

// ── buildPricePulsePlan (pure date/price math, driven by an explicit releaseDate) ──

test('buildPricePulsePlan schedules 4 pulses at day offsets 0/7/30/60 from the release date', () => {
  const svc = freshSvc();
  const plan = svc.buildPricePulsePlan({
    projectId: 'p1',
    bookTitle: 'My Book',
    releaseDate: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(plan.length, 4);
  assert.deepEqual(
    plan.map(e => e.date.slice(0, 10)),
    ['2026-07-01', '2026-07-08', '2026-07-31', '2026-08-30'],
  );
});

test('buildPricePulsePlan uses default launch 0.99 / tail 4.99 with computed mid prices', () => {
  const svc = freshSvc();
  const plan = svc.buildPricePulsePlan({
    projectId: 'p1',
    bookTitle: 'My Book',
    releaseDate: '2026-07-01T00:00:00.000Z',
  });
  // mid1 = round((0.99+4.99)*0.45*100)/100 = 2.69 ; mid2 = round((5.98)*0.6*100)/100 = 3.59
  assert.deepEqual(
    plan.map(e => e.title.match(/\$[\d.]+/)?.[0]),
    ['$0.99', '$2.69', '$3.59', '$4.99'],
  );
});

test('buildPricePulsePlan honors custom launch/tail prices', () => {
  const svc = freshSvc();
  const plan = svc.buildPricePulsePlan({
    projectId: 'p',
    bookTitle: 'B',
    releaseDate: '2026-01-01T00:00:00.000Z',
    launchPrice: 1,
    tailPrice: 5,
  });
  // mid1 = round(6*0.45*100)/100 = 2.7 ; mid2 = round(6*0.6*100)/100 = 3.6
  assert.deepEqual(
    plan.map(e => e.title.match(/\$[\d.]+/)?.[0]),
    ['$1', '$2.7', '$3.6', '$5'],
  );
});

test('buildPricePulsePlan marks only launch day critical; later pulses are high', () => {
  const svc = freshSvc();
  const plan = svc.buildPricePulsePlan({
    projectId: 'p',
    bookTitle: 'B',
    releaseDate: '2026-07-01T00:00:00.000Z',
  });
  assert.deepEqual(
    plan.map(e => e.priority),
    ['critical', 'high', 'high', 'high'],
  );
  assert.ok(plan.every(e => e.category === 'price_pulse'));
});

// ── exportICS (deterministic given explicit event dates) ──

test('exportICS emits a VCALENDAR with an all-day VEVENT and three VALARMs', async () => {
  const svc = freshSvc();
  await svc.initialize();
  await svc.createEvent({
    projectId: 'p',
    bookTitle: 'B',
    date: '2026-08-15T00:00:00.000Z',
    title: 'Launch; go, now',
    description: 'desc',
    category: 'launch',
    priority: 'critical',
  });
  const ics = svc.exportICS();

  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260815'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260815'));
  // ICS escaping: ';' -> '\;' and ',' -> '\,'.
  assert.ok(ics.includes('SUMMARY:Launch\\; go\\, now'));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 3);
  // Non-done events are TENTATIVE.
  assert.ok(ics.includes('STATUS:TENTATIVE'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
});

test('exportICS marks a done event CONFIRMED', async () => {
  const svc = freshSvc();
  await svc.initialize();
  await svc.createEvent({
    projectId: 'p',
    bookTitle: 'B',
    date: '2026-08-15T00:00:00.000Z',
    title: 'Shipped',
    description: 'd',
    category: 'launch',
    priority: 'high',
    status: 'done',
  });
  const ics = svc.exportICS();
  assert.ok(ics.includes('STATUS:CONFIRMED'));
});

// ── list filtering / sorting ──

test('list sorts by date ascending and filters by projectId', async () => {
  const svc = freshSvc();
  await svc.initialize();
  await svc.createEvent({ projectId: 'a', bookTitle: 'B', date: '2026-09-01T00:00:00.000Z', title: 'late', description: '', category: 'other', priority: 'low' });
  await svc.createEvent({ projectId: 'a', bookTitle: 'B', date: '2026-01-01T00:00:00.000Z', title: 'early', description: '', category: 'other', priority: 'low' });
  await svc.createEvent({ projectId: 'b', bookTitle: 'B', date: '2026-05-01T00:00:00.000Z', title: 'other-project', description: '', category: 'other', priority: 'low' });

  const all = svc.list();
  assert.deepEqual(all.map(e => e.title), ['early', 'other-project', 'late']);

  const projA = svc.list({ projectId: 'a' });
  assert.deepEqual(projA.map(e => e.title), ['early', 'late']);
});

// ── atRisk (wall-clock relative; driven with explicit offsets) ──

test('atRisk returns upcoming critical/high events within 7 days and excludes far/low ones', async () => {
  const svc = freshSvc();
  await svc.initialize();
  const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString();
  const inThirtyDays = new Date(Date.now() + 30 * 86400000).toISOString();

  await svc.createEvent({ projectId: 'p', bookTitle: 'B', date: inThreeDays, title: 'soon-critical', description: '', category: 'launch', priority: 'critical' });
  await svc.createEvent({ projectId: 'p', bookTitle: 'B', date: inThreeDays, title: 'soon-low', description: '', category: 'launch', priority: 'low' });
  await svc.createEvent({ projectId: 'p', bookTitle: 'B', date: inThirtyDays, title: 'far-high', description: '', category: 'launch', priority: 'high' });

  const risk = svc.atRisk();
  assert.deepEqual(risk.map(e => e.title), ['soon-critical']);
});
