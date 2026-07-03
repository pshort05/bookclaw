import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inferRole } from '../gateway/src/services/casting/roles.js';

/** Tag every un-tagged step (incl. nested expand.steps) with an inferred role. */
export function tagPipelineRoles(pipeline: any): { changed: number } {
  let changed = 0;
  const walk = (steps: any[]) => {
    for (const s of steps || []) {
      if (!s || typeof s !== 'object') continue;
      if (Array.isArray(s.steps)) walk(s.steps);
      if (Array.isArray(s.parallel)) walk(s.parallel);
      if (s.role) continue;
      const role = inferRole(s);
      if (role) { s.role = role; changed++; }
    }
  };
  walk(pipeline?.steps || []);
  return { changed };
}

// CLI: tag every library/pipelines/*.json in place.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(process.cwd(), 'library', 'pipelines');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = join(dir, f);
    const pipeline = JSON.parse(readFileSync(p, 'utf-8'));
    const { changed } = tagPipelineRoles(pipeline);
    if (changed) { writeFileSync(p, JSON.stringify(pipeline, null, 2) + '\n'); console.log(`  tagged ${changed} step(s) in ${f}`); }
  }
}
