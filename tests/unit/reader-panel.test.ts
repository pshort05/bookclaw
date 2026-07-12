/**
 * Unit tests for ReaderPanelService (gateway/src/services/reader-panel.ts).
 * Fake AI, no network. Covers the anti-slop guards ported from the
 * AuthorAgent fork's synthetic reader-panel service.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReaderPanelService } from '../../gateway/src/services/reader-panel.js';

const aiSelectProvider = (_taskType: string) => ({ id: 'fake' });

function jsonResponse(obj: any) {
  return { text: JSON.stringify(obj) };
}

/** Two candidates, 3 personas — enough to exercise rank format (title/hook). */
const TWO_CANDIDATES = ['Candidate ZERO text', 'Candidate ONE text'];
const THREE_PERSONAS = [
  { id: 'p1', label: 'Persona One', lens: 'lens one' },
  { id: 'p2', label: 'Persona Two', lens: 'lens two' },
  { id: 'p3', label: 'Persona Three', lens: 'lens three' },
];

test('runPanel: position-bias swap flips winner -> low confidence, note recorded', async () => {
  // Fake AI always prefers whichever candidate is shown FIRST (index 0),
  // regardless of content — a textbook position-bias judge.
  const aiComplete = async (req: any) => {
    const shownFirstAlwaysWins = {
      personaVotes: THREE_PERSONAS.map((p) => ({
        personaId: p.id,
        ranking: [0, 1],
        reason: `${p.label} liked the first one shown for its own specific reasons`,
      })),
    };
    void req;
    return jsonResponse(shownFirstAlwaysWins);
  };

  const svc = new ReaderPanelService();
  const report = await svc.runPanel('title', TWO_CANDIDATES, THREE_PERSONAS, aiComplete, aiSelectProvider);

  // Pass A (original order): shown[0] = candidate 0 -> winner = candidate 0.
  // Pass B (reversed order): shown[0] = candidate 1 -> winner = candidate 1.
  // Winners disagree -> position-bias flag.
  assert.ok(report.confidence < 0.6, `expected low confidence, got ${report.confidence}`);
  assert.ok(
    report.notes.some((n) => /position-bias/i.test(n)),
    `expected a position-bias note, got: ${JSON.stringify(report.notes)}`,
  );
});

test('runPanel: score-clustering (near-identical scores) -> low confidence', async () => {
  const CANDIDATES = ['Blurb A text here', 'Blurb B text here', 'Blurb C text here'];
  const PERSONAS = THREE_PERSONAS;
  // Every persona scores every candidate almost identically (score format,
  // since 'blurb' defaults to score-format panels).
  const aiComplete = async () =>
    jsonResponse({
      personaVotes: PERSONAS.map((p) => ({
        personaId: p.id,
        scores: [7, 7, 7], // flat scores across candidates → score-clustering guard
        reason: `${p.label} found them all roughly the same on their merits`,
      })),
    });

  const svc = new ReaderPanelService();
  const report = await svc.runPanel('blurb', CANDIDATES, PERSONAS, aiComplete, aiSelectProvider);

  assert.ok(report.confidence < 0.7, `expected low confidence from clustering, got ${report.confidence}`);
  assert.ok(
    report.notes.some((n) => /not discriminating/i.test(n)),
    `expected a clustering note, got: ${JSON.stringify(report.notes)}`,
  );
});

test('runPanel: Jaccard detects near-duplicate rationales (persona collapse)', async () => {
  const CANDIDATES = ['Title Alpha', 'Title Beta'];
  const PERSONAS = THREE_PERSONAS;
  // Every persona gives an (almost) word-for-word identical reason, but the
  // scores still discriminate cleanly between candidates — isolates the
  // repetition guard from the clustering guard.
  const aiComplete = async () =>
    jsonResponse({
      personaVotes: PERSONAS.map((p) => ({
        personaId: p.id,
        ranking: [0, 1],
        reason: 'This option feels punchy specific memorable and grabs attention immediately',
      })),
    });

  const svc = new ReaderPanelService();
  const report = await svc.runPanel('title', CANDIDATES, PERSONAS, aiComplete, aiSelectProvider);

  assert.ok(
    report.notes.some((n) => /judge collapse/i.test(n)),
    `expected a judge-collapse note, got: ${JSON.stringify(report.notes)}`,
  );
});

test('runPanel: clean case -> correct winnerIndex and rankings, no anti-slop notes', async () => {
  const CANDIDATES = ['The Wrong Choice', 'The Best Title Ever'];
  const PERSONAS = THREE_PERSONAS;
  // Content-based judging: every persona picks whichever candidate CONTAINS
  // "Best", regardless of shown position — agrees across both the original
  // and reversed-order passes, with varied, non-duplicate reasons.
  const reasonsFor = (personaId: string) => ({
    p1: 'Persona One: the word choice signals quality immediately to me',
    p2: 'Persona Two: this option promises a stronger emotional payoff',
    p3: 'Persona Three: it stands out more while quickly browsing a shelf',
  } as Record<string, string>)[personaId];

  const aiComplete = async (req: any) => {
    // Determine which shown index holds "Best" by inspecting the prompt.
    const bestGoesFirst = req.messages[0].content.indexOf('0: The Best') !== -1;
    const ranking = bestGoesFirst ? [0, 1] : [1, 0];
    return jsonResponse({
      personaVotes: PERSONAS.map((p) => ({
        personaId: p.id,
        ranking,
        reason: reasonsFor(p.id),
      })),
    });
  };

  const svc = new ReaderPanelService();
  const report = await svc.runPanel('title', CANDIDATES, PERSONAS, aiComplete, aiSelectProvider);

  assert.equal(report.winnerIndex, 1, 'winnerIndex should point at "The Best Title Ever" (original index 1)');
  assert.equal(report.rankings[0].candidate, 'The Best Title Ever');
  assert.equal(report.rankings[0].index, 1);
  assert.equal(report.rankings.length, 2);
  assert.ok(report.confidence > 0.6, `expected high confidence on a clean case, got ${report.confidence}`);
  assert.ok(
    !report.notes.some((n) => /position-bias|not discriminating|judge collapse/i.test(n)),
    `expected no anti-slop notes, got: ${JSON.stringify(report.notes)}`,
  );
});

test('runPanel: fewer than 2 candidates short-circuits with a warning note', async () => {
  const svc = new ReaderPanelService();
  const report = await svc.runPanel('title', ['Only One'], undefined, async () => jsonResponse({}), aiSelectProvider);
  assert.equal(report.confidence, 0);
  assert.equal(report.rankings.length, 1);
  assert.ok(report.notes.some((n) => /at least 2 candidates/i.test(n)));
});
