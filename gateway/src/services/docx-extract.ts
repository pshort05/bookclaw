import AdmZip from 'adm-zip';

// A .docx part can compress enormously; bound the DECOMPRESSED size (the multer
// upload limit only bounds the compressed bytes) so a zip-bomb can't OOM the
// single-process gateway before we even inflate word/document.xml. Mirrors
// MAX_PART_BYTES in format-finisher/ooxml.ts.
const MAX_PART_BYTES = 128 * 1024 * 1024;

/**
 * Extract plain paragraph text from a .docx buffer by unzipping the archive and
 * parsing word/document.xml. Returns '' when the part is missing, over the
 * uncompressed-size cap, or contains no text — the size check runs BEFORE
 * getData() so an over-cap entry is never inflated into memory.
 */
export function extractDocxText(buffer: Buffer, maxBytes = MAX_PART_BYTES): string {
  const zip = new AdmZip(buffer);
  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) return '';
  if (docEntry.header.size > maxBytes) return '';

  const xml = docEntry.getData().toString('utf-8');
  const paragraphs: string[] = [];
  const paraMatches = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  for (const para of paraMatches) {
    const textParts = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    if (textParts) {
      const line = textParts.map(t => t.replace(/<[^>]+>/g, '')).join('');
      if (line.trim()) paragraphs.push(line);
    }
  }
  return paragraphs.join('\n\n');
}
