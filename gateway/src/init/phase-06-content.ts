import { join } from 'path';
import { TTSService } from '../services/tts.js';
import { ImageGenService } from '../services/image-gen.js';
import { PersonaService } from '../services/personas.js';
import { ProjectEngine } from '../services/projects.js';
import { ContextEngine } from '../services/context-engine.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/** Phases 6c–6f: TTS, image generation, personas, project engine, context engine. */
export async function initContentServices(gw: BookClawGateway): Promise<void> {
  // ── Phase 6c: TTS Service (Piper) — silent init, optional feature ──
  gw.tts = new TTSService(join(ROOT_DIR, 'workspace'), gw.vault);
  await gw.tts.initialize();

  // ── Phase 6c2: Image Generation Service ──
  gw.imageGen = new ImageGenService(join(ROOT_DIR, 'workspace'), gw.vault);
  await gw.imageGen.initialize();

  // ── Phase 6d: Author Personas ──
  gw.personas = new PersonaService(join(ROOT_DIR, 'workspace'));
  await gw.personas.initialize();
  console.log(`  ✓ Personas: ${gw.personas.getCount()} author persona(s) loaded`);

  // ── Phase 6e: Project Engine ──
  gw.projectEngine = new ProjectEngine(gw.authorOS, ROOT_DIR);
  // Wire AI capabilities for dynamic planning
  gw.projectEngine.setAI(
    (request) => gw.aiRouter.complete(request),
    (taskType) => gw.aiRouter.selectProvider(taskType)
  );
  // Phase 3c: the engine no longer owns PROJECT_TEMPLATES — source the dashboard
  // template catalog from the library's full pipeline entries (real labels +
  // step counts come from the parsed LibraryPipeline, not the lightweight row).
  const pipelineRows = gw.library?.list?.('pipeline') ?? [];
  gw.projectEngine.setTemplateCatalog(pipelineRows.map((r: any) => {
    const pl = gw.library?.get?.('pipeline', r.name)?.pipeline;
    const isDynamic = !!pl?.dynamic || r.name === 'novel-pipeline';
    return {
      type: r.name,
      label: pl?.label || r.name,
      description: pl?.description || r.description || '',
      stepCount: isDynamic ? 30 : (pl?.steps?.length ?? 0),
      stepCountLabel: isDynamic ? '30+ auto-generated steps' : undefined,
    };
  }));
  // Resolver lets createPipeline build static phases from their library
  // pipelines without the engine importing LibraryService directly.
  gw.projectEngine.setPipelineResolver((name: string) => gw.library?.get?.('pipeline', name)?.pipeline ?? null);
  const templates = gw.projectEngine.getTemplates();
  console.log(`  ✓ Project engine: ${templates.length} pipeline templates + dynamic AI planning`);

  // ── Phase 6f: Context Engine ──
  gw.contextEngine = new ContextEngine(join(ROOT_DIR, 'workspace'));
  gw.projectEngine.setContextEngine(gw.contextEngine);
  console.log('  ✓ Context Engine: manuscript memory + continuity checking');
}
