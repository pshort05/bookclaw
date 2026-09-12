/**
 * Build-artifact test for Mobile Phase 1 (studio responsive shell). The Vite
 * dist is gitignored, so this builds it on demand (first run / fresh checkout),
 * then asserts (a) the 768px media query survived into the built CSS and
 * (b) the hamburger control shipped in the built JS. Run via: npm run test:unit
 *
 * The CSS assertion is whitespace-tolerant (`max-width:\s*768px`): this build's
 * minifier keeps the space in the @media prelude (`max-width: 768px`), so match
 * both forms rather than assume a no-space minification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the mobile responsive shell', { timeout: 180000 }, () => {
  if (!existsSync(assetsDir)) {
    try {
      execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      if (e.stdout) process.stderr.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
      throw err;
    }
  }
  const files = readdirSync(assetsDir);
  const css = files.filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8')).join('\n');
  const js = files.filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8')).join('\n');

  assert.match(css, /max-width:\s*768px/, 'mobile breakpoint must survive into the built CSS');
  assert.ok(js.includes('Open navigation'), 'hamburger control (aria-label) must ship in the bundle');

  // Regression guard: the mobile shell reserves a 52px grid row for the fixed
  // top bar, but the bar/rail/scrim are position:fixed (out of grid flow), so
  // .main must claim row 2 explicitly or it auto-places into the 52px bar row
  // and the whole content pane collapses to 52px. Assert grid-row:2 survives.
  const appCss = readFileSync(join(repo, 'frontend/studio/src/App.module.css'), 'utf-8');
  assert.match(appCss, /grid-row:\s*2/, 'mobile .main must occupy grid row 2 (else content pane collapses to the 52px bar row)');
});

/**
 * Mobile Phase 2 slice — the Confirmations master/detail panes. The desktop
 * rule pins the queue to `flex: 0 0 340px`, which alone overflows a phone and
 * squeezes the detail pane (the one awaiting Approve/Reject) into an unreadable
 * sliver. Guard the stacking block against deletion, and specifically the two
 * axis-flip rules that are easy to drop: the panes must lose the 340px basis
 * (it becomes a HEIGHT once the direction is column) and the cross-axis
 * alignment must stretch (the desktop `flex-start` would shrink-wrap widths).
 */
test('Confirmations stacks its two panes below the mobile breakpoint', () => {
  const css = readFileSync(join(repo, 'frontend/studio/src/routes/Confirmations.module.css'), 'utf-8');
  const block = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}\s*$/.exec(css);
  assert.ok(block, 'Confirmations must carry a 768px mobile block');
  const rules = block[1];
  assert.match(rules, /flex-direction:\s*column/, 'the master/detail layout must stack');
  assert.match(rules, /flex:\s*0\s+0\s+auto/, 'panes must drop the 340px basis (it sizes height once stacked)');
  assert.match(rules, /align-items:\s*stretch/, 'panes must stretch to full width, not shrink-wrap');
});
