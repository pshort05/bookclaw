import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookBubSubmitterService } from '../../gateway/src/services/bookbub-submitter.js';

const svc = new BookBubSubmitterService();

// A blurb long enough to clear the 150-word minimum so the word-count warning
// doesn't pollute unrelated assertions.
const longBlurb = 'word '.repeat(200).trim();

function draft(over: Partial<Parameters<BookBubSubmitterService['buildDraft']>[0]> = {}) {
  return svc.buildDraft({
    title: 'The Test',
    authorName: 'A. Writer',
    genre: 'Thriller',
    amazonBlurb: longBlurb,
    ...over,
  });
}

test('off-grid suggested price is normalized to 0.99', () => {
  assert.equal(draft({ suggestedPriceUSD: 3.49 }).suggestedDealPriceUSD, 0.99);
});

test('on-grid suggested price (1.99) is preserved', () => {
  assert.equal(draft({ suggestedPriceUSD: 1.99 }).suggestedDealPriceUSD, 1.99);
});

test('omitted suggested price yields undefined deal price', () => {
  // NOTE: possible bug — `includes(input.suggestedPriceUSD ?? 0.99)` is true when
  // the price is omitted (0.99 is on the grid), so the ternary returns
  // `input.suggestedPriceUSD!` which is literally undefined rather than 0.99.
  // The intended default of 0.99 is never applied to the deal price.
  assert.equal(draft({}).suggestedDealPriceUSD, undefined);
});

test('unverified review snippet triggers the anti-fabrication warning', () => {
  const d = draft({
    reviewSnippets: [{ quote: 'A great read indeed', outlet: 'Kirkus Reviews', verified: false }],
  });
  assert.ok(d.warnings.some(w => /Unverified review snippets/.test(w)));
});

test('verified flag is preserved (and coerced to boolean) on pass-through snippets', () => {
  const d = draft({
    reviewSnippets: [
      { quote: 'A great read indeed', outlet: 'Kirkus Reviews', verified: false },
      { quote: 'Loved every page here', outlet: 'Booklist', verified: true },
    ],
  });
  assert.deepEqual(d.reviewSnippets.map(s => s.verified), [false, true]);
});

test('review snippets shorter than 10 chars are dropped', () => {
  const d = draft({ reviewSnippets: [{ quote: 'short', outlet: 'X', verified: true }] });
  assert.equal(d.reviewSnippets.length, 0);
});

test('pitchingNeeded lists trade outlets the author lacks (case-insensitive, ignores verification)', () => {
  // Snippets from Kirkus + Booklist (one unverified) should remove BOTH from the pitch list.
  const d = draft({
    reviewSnippets: [
      { quote: 'A great read indeed', outlet: 'kirkus reviews', verified: false },
      { quote: 'Loved every page here', outlet: 'Booklist', verified: true },
    ],
  });
  assert.deepEqual(d.pitchingNeeded, ['Publishers Weekly', 'Library Journal', 'Foreword Reviews']);
});

test('no prior deals => first-submission note, no cooldown warning', () => {
  const d = draft({});
  assert.equal(d.priorDealHistoryNote, 'First BookBub Featured Deal submission for this title.');
  assert.equal(d.warnings.some(w => /6\+ months/.test(w)), false);
});

test('a prior deal within 6 months triggers a cooldown warning', () => {
  // 2 months ago, relative to now so the test is wall-clock-stable.
  const recent = new Date(Date.now() - 2 * 30 * 86400000).toISOString().slice(0, 10);
  const d = draft({ priorDeals: [{ date: recent, priceUSD: 0.99 }] });
  assert.ok(d.warnings.some(w => /6\+ months between deals/.test(w)));
  assert.match(d.priorDealHistoryNote, /Prior deals: 1\. Most recent: .* at \$0\.99\./);
});

test('a prior deal older than 6 months does NOT trigger a cooldown warning', () => {
  const old = new Date(Date.now() - 8 * 30 * 86400000).toISOString().slice(0, 10);
  const d = draft({ priorDeals: [{ date: old, priceUSD: 1.99 }] });
  assert.equal(d.warnings.some(w => /6\+ months/.test(w)), false);
});

test('most-recent prior deal is chosen by descending date when multiple exist', () => {
  const d = draft({
    priorDeals: [
      { date: '2024-01-01', priceUSD: 0.99 },
      { date: '2025-06-01', priceUSD: 2.99 },
    ],
  });
  assert.match(d.priorDealHistoryNote, /Prior deals: 2\. Most recent: 2025-06-01 at \$2\.99\./);
});

test('reformatBlurb strips HTML, downcases all-caps runs, and removes exclamation marks', () => {
  const d = draft({ amazonBlurb: 'AMAZING story with <b>tags</b>!! Wow!' });
  assert.equal(d.blurb, 'Amazing story with tags. Wow.');
});

test('territory preferences and a comp-title reminder are always emitted', () => {
  const d = draft({});
  assert.deepEqual(d.territoryPreferences, ['US', 'UK', 'CA', 'AU', 'IN']);
  assert.deepEqual(d.compTitles, []);
  assert.ok(d.warnings.some(w => /comparable recent BookBub Featured Deals/.test(w)));
});
