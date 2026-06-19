#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = '/tmp/genre-markdowns';
const OUTPUT_DIR = '/home/paul/data/dev/bookclaw/library/genres';

// Mapping from source directory names to target genre names
const GENRE_MAPPING = {
  'parallel-universes-genre-guides': 'parallel-universes',
  'police-procedural-genre-guides': 'police-procedural',
  'portal-fantasy-genre-guides': 'portal-fantasy',
  'portal-science-fiction-genre-guides': 'portal-science-fiction',
  'post-apocalyptic-genre-guides': 'post-apocalyptic',
  'post-apocalyptic-romance-genre-guides': 'post-apocalyptic-romance',
  'private-eye-genre-guides': 'private-eye',
  'progression-fantasy-genre-guides': 'progression-fantasy',
  'psychological-thriller-genre-guides': 'psychological-thriller',
  'romance-western-genre-guides': 'romance-western',
  'romantasy-fairytale-retellings-genre-guide': 'romantasy-fairytale-retellings',
  'romantasy-fiction-genre-guides': 'romantasy-fiction',
  'romantasy-genre-blueprint-guide': 'romantasy-blueprint',
  'romantic-comedy-genre-guides': 'romantic-comedy',
  'romantic-suspense-genre-guide': 'romantic-suspense',
};

/**
 * Extract all markdown content from a directory
 */
function readGenreFiles(genreDir) {
  const fullPath = path.join(SOURCE_DIR, genreDir);
  const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.md'));

  const content = {};
  for (const file of files) {
    content[file] = fs.readFileSync(path.join(fullPath, file), 'utf8');
  }

  return content;
}

/**
 * Clean and normalize text while preserving meaningful content
 */
function cleanText(text) {
  // Remove markdown images
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove markdown links but keep the text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Remove bold/italic but keep the text
  text = text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');
  text = text.replace(/_+([^_]+)_+/g, '$1');
  text = text.replace(/`+([^`]+)`+/g, '$1');
  text = text.replace(/~{2}([^~]+)~{2}/g, '$1');

  // Remove HTML tags but preserve spacing
  text = text.replace(/<[^>]+>/g, ' ');

  // Remove footnote references
  text = text.replace(/\[\^.*?\^\]/g, '');

  // Remove table syntax
  text = text.replace(/\|/g, ' ');

  // Normalize multiple spaces but preserve paragraph breaks
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\n+/g, '\n');

  return text.trim();
}

/**
 * Extract bullet points from text, capturing multi-line bullets
 */
function extractBulletPoints(text, limit = 10) {
  const lines = text.split('\n');
  const bullets = [];
  let currentBullet = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^[\s]*[-•*]\s+(.+)$/);

    if (match) {
      // New bullet point
      if (currentBullet) {
        const bullet = cleanText(currentBullet).trim();
        if (bullet.length > 5 && !bullet.includes('http') && bullets.length < limit) {
          bullets.push(bullet);
        }
      }
      currentBullet = match[1];
    } else if (currentBullet && line.trim() && !line.match(/^[\s]*[-•*]/)) {
      // Continuation of current bullet (indented or non-bullet line)
      if (line.match(/^[\s]{2,}/)) {
        currentBullet += ' ' + line.trim();
      }
    }
  }

  // Don't forget the last bullet
  if (currentBullet && bullets.length < limit) {
    const bullet = cleanText(currentBullet).trim();
    if (bullet.length > 5 && !bullet.includes('http')) {
      bullets.push(bullet);
    }
  }

  return bullets;
}

/**
 * Extract numbered list items (beats, steps, etc.)
 */
function extractNumberedList(text, limit = 10) {
  const lines = text.split('\n');
  const items = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)$/);
    if (match && items.length < limit) {
      const item = cleanText(match[1]).trim();
      if (item.length > 5) {
        items.push(item);
      }
    }
  }

  return items;
}

/**
 * Smart section extraction - find a section by keyword and get content until next major section
 */
function extractSection(text, keywords, maxChars = 2000) {
  const lines = text.split('\n');
  let inSection = false;
  let content = [];
  let charCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inSection) {
      // Look for section start
      if (keywords.some(kw => new RegExp(kw, 'i').test(line))) {
        inSection = true;
        continue;
      }
    } else {
      // We're in a section - look for end markers
      if (/^#{1,3}\s/.test(line) || /^[A-Z][A-Z\s]+$/.test(line) && line.length < 60 && line !== line.toUpperCase()) {
        // Hit another major section
        break;
      }

      // Skip empty lines at the start of section
      if (content.length === 0 && line.trim() === '') {
        continue;
      }

      // Stop if we've collected enough
      if (charCount > maxChars) {
        break;
      }

      content.push(line);
      charCount += line.length;
    }
  }

  return content.join('\n').trim();
}

/**
 * Consolidate extracted sections from multiple files
 */
function consolidateSections(allFiles) {
  const sections = {
    overview: '',
    readerExpectations: '',
    tropes: '',
    themes: '',
    motifs: '',
    beats: '',
    mustHaves: '',
    genreKillers: '',
    comps: '',
    characters: '',
    pacing: '',
    tone: '',
  };

  for (const [fileName, content] of Object.entries(allFiles)) {
    // Try different extraction strategies depending on file type
    const isStyleGuide = /style guide/i.test(fileName);
    const isStoryDevices = /story device|lexicon/i.test(fileName);
    const isGenreGuide = /genre guide/i.test(fileName) && !isStyleGuide;

    if (isStoryDevices) {
      // Extract tropes and themes from lexicons
      const tropes = extractSection(content, ['trope', 'plot device', 'story device', 'recurring']);
      const themes = extractSection(content, ['theme', 'motif', 'underlying argument']);

      if (tropes.length > sections.tropes.length) sections.tropes = tropes;
      if (themes.length > sections.themes.length) sections.themes = themes;
    }

    if (isStyleGuide) {
      // Extract tone, pacing, characters from style guides
      const tone = extractSection(content, ['tone', 'atmosphere', 'prose', 'voice', 'narrative']);
      const pacing = extractSection(content, ['pacing', 'pace', 'structure', 'tempo']);
      const chars = extractSection(content, ['character', 'protagonist', 'dynamic']);

      if (tone.length > sections.tone.length) sections.tone = tone;
      if (pacing.length > sections.pacing.length) sections.pacing = pacing;
      if (chars.length > sections.characters.length) sections.characters = chars;
    }

    if (isGenreGuide) {
      // Extract comprehensive sections from main guides
      const overview = extractSection(content, ['overview', 'definition', 'essence', 'core characteristic']);
      const expectations = extractSection(content, ['reader', 'demand', 'expect']);
      const tropes = extractSection(content, ['trope', 'essential', 'key element']);
      const beats = extractSection(content, ['beat', 'structure', 'obligatory', 'turning point']);
      const comps = extractSection(content, ['comparable', 'comp', 'similar', 'book', 'title']);

      if (overview.length > sections.overview.length) sections.overview = overview;
      if (expectations.length > sections.readerExpectations.length) sections.readerExpectations = expectations;
      if (tropes.length > sections.tropes.length) sections.tropes = tropes;
      if (beats.length > sections.beats.length) sections.beats = beats;
      if (comps.length > sections.comps.length) sections.comps = comps;
    }
  }

  return sections;
}

/**
 * Get a summary line for each genre
 */
function getSummaryForGenre(genre) {
  const summaries = {
    'parallel-universes': 'A genre exploring alternate realities and the consequences of different choices across worlds.',
    'police-procedural': 'Procedural fiction centered on law enforcement investigation, evidence, and the justice system.',
    'portal-fantasy': 'Fantasy worlds accessed through gateways; protagonists navigate two realms and learn from each.',
    'portal-science-fiction': 'Sci-fi blending dimensions, time travel, or interdimensional access with speculative worldbuilding.',
    'post-apocalyptic': 'Civilization has collapsed; survivors rebuild or adapt in a dangerous, resource-scarce world.',
    'post-apocalyptic-romance': 'Intimate, character-driven romance set against the backdrop of a fallen world.',
    'private-eye': 'A protagonist for hire investigates crime, uncovering hidden truths through cunning and persistence.',
    'progression-fantasy': 'Protagonists grow measurably in power through dedication and skill acquisition within a defined magic system.',
    'psychological-thriller': 'Suspense driven by unreliable narrators, mind games, and internal conflict rather than external action.',
    'romance-western': 'Romance set in the Old West, balancing intimate connection with frontier hardship and duty.',
    'romantasy-fairytale-retellings': 'Romantic retellings of classic fairy tales with sophisticated prose and emotional depth.',
    'romantasy-fiction': 'Epic fantasy prioritizing a central romantic plot as the emotional and narrative core.',
    'romantasy-blueprint': 'High-fantasy romance following a genre blueprint that balances world-building with relationship arcs.',
    'romantic-comedy': 'Light, witty romance where humor is inseparable from the emotional journey toward love.',
    'romantic-suspense': 'Romance with integrated thriller elements; external danger and emotional stakes are equally important.',
  };

  return summaries[genre] || 'A specialized genre with its own tropes, expectations, and emotional arcs.';
}

/**
 * Generate reader-expectations.md
 */
function generateReaderExpectations(sections, genre) {
  const bullets = extractBulletPoints(sections.readerExpectations, 6);
  const tonePoints = extractBulletPoints(sections.tone, 3);
  const charPoints = extractBulletPoints(sections.characters, 2);

  const summary = getSummaryForGenre(genre);
  const allBullets = [...bullets, ...tonePoints, ...charPoints].slice(0, 8);

  const content = allBullets.length > 0
    ? allBullets.map(b => `- ${b}`).join('\n')
    : '- [Add key reader expectations]';

  return `*${summary}*

Readers expect:

${content}

Typical length: 70,000-100,000 words.
Pacing: Fast-moving but grounded in character interiority.
`;
}

/**
 * Generate tropes.md
 */
function generateTropes(sections, genre) {
  const bullets = extractBulletPoints(sections.tropes, 10);

  const summary = `*Essential story devices and recurring patterns in ${genre}.`;

  const content = bullets.length > 0
    ? bullets.map(b => `- ${b}`).join('\n')
    : '- [Add genre-specific tropes]';

  return `${summary}*

${content}
`;
}

/**
 * Generate themes.md
 */
function generateThemes(sections, genre) {
  const bullets = extractBulletPoints(sections.themes, 8);

  const summary = `*Core emotional and thematic values that resonate with readers.`;

  const content = bullets.length > 0
    ? bullets.map(b => `- ${b}`).join('\n')
    : '- [Add core themes]';

  return `${summary}*

${content}
`;
}

/**
 * Generate beats.md
 */
function generateBeats(sections, genre) {
  const numbered = extractNumberedList(sections.beats, 10);

  // Common beat structure fallback
  const defaultBeats = [
    'Hook and inciting incident',
    'Rising action and character development',
    'First reversal or complication',
    'Midpoint turning point',
    'Escalation and stakes raise',
    'Point of no return',
    'Climax and confrontation',
    'Resolution and denouement',
  ];

  const summary = `*Structural milestones and obligatory scenes.`;

  const beats = numbered.length >= 5 ? numbered : defaultBeats;

  const content = beats.slice(0, 8).map((b, i) => `${i + 1}. ${b}`).join('\n');

  return `${summary}*

${content}
`;
}

/**
 * Generate must-haves.md
 */
function generateMustHaves(sections, genre) {
  const bullets = extractBulletPoints(sections.mustHaves, 8);

  // Try to extract from overview if mustHaves is empty
  const extraBullets = bullets.length < 3 ? extractBulletPoints(sections.overview, 5) : [];
  bullets.push(...extraBullets);

  const summary = `*Non-negotiable elements; if absent, the manuscript falls outside the genre.`;

  const content = bullets.length > 0
    ? bullets.map(b => `- ${b}`).join('\n')
    : '- [Add must-have elements]';

  return `${summary}*

${content}
`;
}

/**
 * Generate genre-killers.md
 */
function generateGenreKillers(sections, genre) {
  const bullets = extractBulletPoints(sections.genreKillers, 6);

  // Common genre-killers fallback
  const defaultKillers = [
    'Unearned emotional resolution',
    'Inconsistent character motivation',
    'Pacing that stalls in the middle',
    'Telling instead of showing',
    'Clichéd dialogue or derivative tropes',
  ];

  const summary = `*What causes readers to DNF or leave one-star reviews.`;

  const killers = bullets.length > 0 ? bullets : defaultKillers;

  const content = killers.slice(0, 6).map(b => `- ${b}`).join('\n');

  return `${summary}*

${content}
`;
}

/**
 * Generate comps.md
 */
function generateComps(sections, genre) {
  const bullets = extractBulletPoints(sections.comps, 8);

  const summary = `*3-5 comparable titles showing reader expectations and market positioning.`;

  if (bullets.length > 0) {
    const content = bullets.slice(0, 5).map(b => `- ${b}`).join('\n');
    return `${summary}*

${content}
`;
  }

  // Template if no comps found
  return `${summary}*

- [Title] by [Author]: [2-3 sentence explanation of why this is a comp]
- [Title] by [Author]: [2-3 sentence explanation]
- [Title] by [Author]: [2-3 sentence explanation]
`;
}

/**
 * Calculate confidence level
 */
function calculateConfidence(fileCount) {
  if (fileCount === 0) return 30; // Empty source, inference only
  if (fileCount >= 5) return 95; // Many guides present
  if (fileCount >= 4) return 90; // Full guide set
  if (fileCount >= 3) return 80; // Most guides present
  if (fileCount >= 2) return 70; // Partial guides
  return 60; // Single guide
}

/**
 * Main execution
 */
async function main() {
  console.log('BookClaw Genre Guide Parser');
  console.log('============================\n');

  const results = [];

  for (const [sourceDir, targetGenre] of Object.entries(GENRE_MAPPING)) {
    const sourcePath = path.join(SOURCE_DIR, sourceDir);

    if (!fs.existsSync(sourcePath)) {
      console.log(`⚠ Source not found: ${sourceDir}`);
      continue;
    }

    console.log(`Processing ${targetGenre}...`);

    // Read all source files
    const genreFiles = readGenreFiles(sourceDir);
    const fileCount = Object.keys(genreFiles).length;

    // Consolidate sections from all files
    const sections = consolidateSections(genreFiles);

    // Generate output files
    const outputDir = path.join(OUTPUT_DIR, targetGenre);
    fs.mkdirSync(outputDir, { recursive: true });

    const files = {
      'reader-expectations.md': generateReaderExpectations(sections, targetGenre),
      'tropes.md': generateTropes(sections, targetGenre),
      'themes.md': generateThemes(sections, targetGenre),
      'beats.md': generateBeats(sections, targetGenre),
      'must-haves.md': generateMustHaves(sections, targetGenre),
      'genre-killers.md': generateGenreKillers(sections, targetGenre),
      'comps.md': generateComps(sections, targetGenre),
    };

    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(outputDir, fileName), content);
    }

    const confidence = calculateConfidence(fileCount);
    results.push({
      genre: targetGenre,
      confidence,
      fileCount,
    });

    console.log(`  ✓ 7/7 files created (${fileCount} source files, ${confidence}% confidence)\n`);
  }

  // Summary
  console.log('\n============================');
  console.log('Summary by Genre');
  console.log('============================\n');

  for (const result of results) {
    const confidence = result.confidence;
    const icon = confidence >= 85 ? '✓' : confidence >= 70 ? '~' : '⚠';
    console.log(`${icon} ${result.genre.padEnd(30)} | 7/7 files | ${confidence}% confidence`);
  }

  const avgConfidence = Math.round(results.reduce((a, b) => a + b.confidence, 0) / results.length);
  console.log(`\nAverage confidence: ${avgConfidence}%`);
  console.log(`Total genres: ${results.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
