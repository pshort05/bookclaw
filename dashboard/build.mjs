/**
 * Dashboard build: bundle src/ into a single self-contained dist/index.html.
 *
 * Why a custom assembler instead of esbuild's HTML support: the gateway serves
 * ONE self-contained index.html and replaces the `__BOOKCLAW_AUTH_TOKEN__`
 * placeholder at request time (see init/phase-11-http.ts). So we inline the
 * bundled JS and the CSS into a single HTML file and keep the placeholder
 * intact — the served shape is identical to the pre-build monolith.
 *
 * Usage:
 *   node dashboard/build.mjs            # one-shot build
 *   node dashboard/build.mjs --watch    # rebuild on any change under src/
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

async function build() {
  // Bundle the JS module graph back into a single IIFE (one <script>).
  const result = await esbuild.build({
    entryPoints: [join(srcDir, 'main.js')],
    bundle: true,
    format: 'iife',
    target: 'es2018',
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text;
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
  const template = readFileSync(join(srcDir, 'index.html'), 'utf8');

  // Replacer functions (not strings) so `$`-sequences in the bundle/CSS are
  // inserted literally rather than interpreted as replacement patterns.
  const html = template
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);

  // Guard: the auth-token placeholder MUST survive into the served HTML, or the
  // dashboard can never authenticate. Fail the build loudly if it's gone.
  if (!html.includes('__BOOKCLAW_AUTH_TOKEN__')) {
    throw new Error('dashboard build: __BOOKCLAW_AUTH_TOKEN__ placeholder missing from output');
  }

  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), html);
  console.log(`  ✓ dashboard built → dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
}

await build();

if (process.argv.includes('--watch')) {
  console.log('  … watching dashboard/src for changes (Ctrl+C to stop)');
  let timer = null;
  watch(srcDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((err) => console.error('  ✗ build failed:', err.message));
    }, 150);
  });
}
