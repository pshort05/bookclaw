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
  const templates = gw.projectEngine.getTemplates();
  console.log(`  ✓ Project engine: ${templates.length} templates + dynamic AI planning`);

  // ── Phase 6f: Context Engine ──
  gw.contextEngine = new ContextEngine(join(ROOT_DIR, 'workspace'));
  gw.projectEngine.setContextEngine(gw.contextEngine);
  console.log('  ✓ Context Engine: manuscript memory + continuity checking');
}
