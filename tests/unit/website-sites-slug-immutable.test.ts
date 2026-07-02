/**
 * Bug L7: WebsiteSiteService.update() must keep config.slug pinned to the
 * immutable site.id, mirroring create()'s `config: { ...input.config, slug: id }`.
 * Otherwise a PATCH with a new slug diverges site.config.slug from site.id, so
 * the builder writes to workspace/website/<new-slug> while standalone deploy
 * reads workspace/website/<old-id> — deploying the stale directory.
 * Network-free; runs over a real temp workspace dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebsiteSiteService } from '../../gateway/src/services/website-sites.js';

const baseConfig = { siteName: 'S', authorName: 'A', baseUrl: 'https://x' };

test('update() pins config.slug to the immutable site.id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-website-slug-'));
  try {
    const svc = new WebsiteSiteService(dir);
    await svc.initialize();

    await svc.create({ config: { slug: 'foo', ...baseConfig } as never });

    const updated = await svc.update('foo', {
      config: { slug: 'bar', ...baseConfig } as never,
    });

    assert.ok(updated, 'update() should find the site');
    assert.equal(updated!.id, 'foo', 'site.id must never change');
    assert.equal(updated!.config.slug, 'foo', 'config.slug must stay pinned to site.id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
