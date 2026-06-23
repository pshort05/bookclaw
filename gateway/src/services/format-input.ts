import { getForm, validateFormFit } from './story-forms.js';
import { resolveStructure, type StoryStructure, type StoryStructureService } from './story-structures.js';
import type { BookFormat } from './book-types.js';

/**
 * Validate raw creation/format inputs into a BookFormat block.
 * Returns {} when no format fields supplied (format is optional),
 * { error } on any validation failure (hard block), or { format }.
 */
export function buildBookFormat(
  body: { structure?: string; customStructure?: unknown; form?: string; chapterCount?: number; wordsPerChapter?: number },
  structures: StoryStructureService,
): { format?: BookFormat; error?: string } {
  const hasAny = body.structure || body.form || body.chapterCount != null || body.wordsPerChapter != null;
  if (!hasAny) return {};

  const structureId = String(body.structure ?? '');
  const formId = String(body.form ?? '');
  const chapterCount = Number(body.chapterCount);
  const wordsPerChapter = Number(body.wordsPerChapter);

  if (!structureId) return { error: 'structure is required when declaring a format' };
  if (!formId) return { error: 'form is required when declaring a format' };
  if (!Number.isFinite(chapterCount) || chapterCount < 1) return { error: 'chapterCount must be a positive number' };
  if (!Number.isFinite(wordsPerChapter) || wordsPerChapter < 1) return { error: 'wordsPerChapter must be a positive number' };

  const structure = resolveStructure({ structureId, customStructure: body.customStructure as StoryStructure | undefined }, structures);
  if (!structure) return { error: `unknown structure: ${structureId}` };

  const form = getForm(formId);
  if (!form) return { error: `unknown form: ${formId}` };

  const fit = validateFormFit(form, chapterCount, wordsPerChapter);
  if (!fit.ok) return { error: fit.message };

  return {
    format: {
      structureId,
      ...(structureId === 'custom' ? { customStructure: structure } : {}),
      formId,
      chapterCount: Math.floor(chapterCount),
      wordsPerChapter: Math.floor(wordsPerChapter),
      totalTarget: fit.total,
    },
  };
}
