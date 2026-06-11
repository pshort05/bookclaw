/**
 * BookClaw Project Engine — V4
 * Autonomous book production at scale
 *
 * 6 Core Project Types (chainable into a Pipeline):
 *   book-planning    - Market analysis → premise → characters → outline → synopsis
 *   book-bible       - World-building → character bible → continuity → style guide
 *   book-production  - Write chapters sequentially with context injection
 *   deep-revision    - 21-step, 3-pass revision (macro → medium → micro + beta readers)
 *   format-export    - Front/back matter → DOCX/EPUB/PDF export (KDP-ready)
 *   book-launch      - Blurb → Amazon desc → keywords → ad copy → social posts
 *
 * Pipeline Mode: Chain all 6 phases from a single idea + persona
 */

import { AuthorOSService } from './author-os.js';
import { ContextEngine } from './context-engine.js';
import type { SkillCatalogEntry } from '../skills/loader.js';
import type { LibraryPipeline } from './library-types.js';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

/**
 * Callback type for AI completion — injected by the gateway so ProjectEngine
 * can call the AI without importing the router directly.
 */
export type AICompleteFunc = (request: {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}) => Promise<{ text: string; tokensUsed: number; estimatedCost: number; provider: string }>;

/**
 * Callback to select the best provider for a task type
 */
export type AISelectProviderFunc = (taskType: string) => { id: string };

export type ProjectType =
  | 'book-planning'
  | 'book-bible'
  | 'book-production'
  | 'deep-revision'
  | 'format-export'
  | 'book-launch'
  | 'novel-pipeline'
  | 'pipeline'
  | 'custom';

export interface Project {
  id: string;
  type: ProjectType;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  progress: number; // 0-100
  steps: ProjectStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  context: Record<string, any>;
  personaId?: string;     // Author persona assigned to this project
  preferredProvider?: string; // Override AI provider: 'gemini' | 'claude' | 'openai' | 'deepseek' | 'ollama' | null (auto)
  pipelineId?: string;    // Parent pipeline ID (if part of a pipeline)
  pipelinePhase?: number; // Phase order within pipeline (1-6)
  bookSlug?: string;      // the book this project writes into; captured at creation, immutable
}

export interface ProjectStep {
  id: string;
  label: string;
  skill?: string;         // Matched skill name
  toolSuggestion?: string; // Author OS tool to use
  taskType: string;        // AI router task type (for tier routing)
  prompt: string;          // The prompt to send to AI
  status: 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
  result?: string;
  error?: string;
  // Novel pipeline fields:
  phase?: string;           // 'premise' | 'bible' | 'outline' | 'writing' | 'revision' | 'revision_apply' | 'assembly'
  wordCountTarget?: number; // Target words for this step (triggers multi-pass continuation)
  chapterNumber?: number;   // Chapter number for writing/revision steps
  // Per-step model override (cheap-draft / premium-edit). When set, this step
  // pins the given provider (and, if `model` is set, the exact model id) instead
  // of tier routing. Unset = inherit the project/tier default (today's behavior).
  modelOverride?: { provider: string; model?: string };
}

export interface NovelPipelineConfig {
  genre?: string;
  pov?: string;
  logline?: string;
  themes?: string;
  setting?: string;
  tone?: string;
  tense?: string;
  targetChapters?: number;        // default 25
  targetWordsPerChapter?: number; // default 3000
  protagonistName?: string;
  antagonistName?: string;
}

// Valid task types that the AI router understands (for planProject prompt)
const TASK_TYPE_MAP: Record<string, string> = {
  general: 'Basic tasks, chat, simple questions',
  research: 'Web research, fact-finding',
  creative_writing: 'Prose writing, chapters, scenes',
  revision: 'Editing, rewriting, feedback',
  style_analysis: 'Voice/style matching',
  marketing: 'Blurbs, pitches, ads',
  outline: 'Story structure, beat sheets',
  book_bible: 'World building, characters',
  consistency: 'Cross-chapter analysis',
  final_edit: 'Final polish, proofreading',
};

// ═══════════════════════════════════════════════════════════
// Project Engine
// ═══════════════════════════════════════════════════════════

export class ProjectEngine {
  private projects: Map<string, Project> = new Map();
  private authorOS: AuthorOSService | null;
  private rootDir: string;
  private nextId = 1;
  private aiComplete: AICompleteFunc | null = null;
  private aiSelectProvider: AISelectProviderFunc | null = null;
  private contextEngine?: ContextEngine;
  private coreLessonsCache: string | null = null;
  private coreLessonsCacheTime = 0;
  private stateFilePath: string;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private templateCatalog: Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }> = [];
  private pipelineResolver: ((name: string) => LibraryPipeline | null) | null = null;

  /** Inject the available template catalog (sourced from the library at boot). */
  setTemplateCatalog(catalog: Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }>): void {
    this.templateCatalog = catalog;
  }

  /** Inject a resolver that maps a pipeline name → its LibraryPipeline (or null). */
  setPipelineResolver(resolver: (name: string) => LibraryPipeline | null): void {
    this.pipelineResolver = resolver;
  }

  constructor(authorOS?: AuthorOSService, rootDir?: string) {
    this.authorOS = authorOS || null;
    this.rootDir = rootDir || process.cwd();
    this.stateFilePath = join(this.rootDir, 'workspace', '.config', 'projects-state.json');
    this.loadState();  // Restore projects from disk on startup
  }

  /**
   * Persist all project state to disk (debounced — max once per second).
   * Non-fatal: if save fails, projects continue to work in-memory.
   */
  private persistState(): void {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(async () => {
      try {
        const { mkdir } = await import('fs/promises');
        const { dirname } = await import('path');
        await mkdir(dirname(this.stateFilePath), { recursive: true });
        const state = {
          nextId: this.nextId,
          projects: Array.from(this.projects.values()).map(p => ({
            ...p,
            // Strip large step results to save space — they're already saved as individual files
            steps: p.steps.map(s => ({
              ...s,
              result: s.result ? s.result.substring(0, 500) + (s.result.length > 500 ? '\n\n[... truncated for state file — full output in project files ...]' : '') : undefined,
            })),
          })),
        };
        const { writeFile: wf } = await import('fs/promises');
        await wf(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
      } catch (err) {
        console.error('  ⚠ Failed to persist project state:', err);
      }
    }, 1000);
  }

  /**
   * Load project state from disk on startup.
   */
  private loadState(): void {
    try {
      if (!existsSync(this.stateFilePath)) return;
      const raw = readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      if (state.nextId) this.nextId = state.nextId;
      if (Array.isArray(state.projects)) {
        let migrated = 0;
        for (const p of state.projects) {
          // ── Legacy book-production migration ──
          // Projects created before commit 8bd7940 have analysis-only
          // "Self-review Chapter N" steps that produce critique notes but
          // never apply them. Auto-migrate any PENDING / ACTIVE self-review
          // step to the new polish prompt + phase so old projects benefit
          // from the same revise-and-rewrite behavior as new ones.
          // Completed steps are left alone — their output is already saved.
          if (p.type === 'book-production' && Array.isArray(p.steps)) {
            for (const step of p.steps) {
              const isLegacySelfReview =
                (step.status === 'pending' || step.status === 'active') &&
                typeof step.label === 'string' &&
                step.label.startsWith('Self-review Chapter') &&
                step.skill === 'revise' &&
                step.phase !== 'polish';
              if (isLegacySelfReview) {
                const ch = step.chapterNumber || (step.label.match(/Chapter (\d+)/)?.[1] ?? 'N');
                const wpc = (p.context?.targetWordsPerChapter as number) || 3000;
                step.label = `Polish Chapter ${ch}`;
                step.phase = 'polish';
                step.wordCountTarget = wpc;
                step.prompt =
                  `You just wrote Chapter ${ch} of "${p.title}" (in your context above).\n\n` +
                  `Produce a REVISED, POLISHED version of THE ENTIRE chapter. Apply these fixes as you rewrite:\n` +
                  `- Tighten pacing; cut throat-clearing\n` +
                  `- Strengthen weak verbs; remove unnecessary -ly adverbs\n` +
                  `- Replace filter words (saw, heard, felt, noticed, realized) with direct sensory experience\n` +
                  `- Cut repetition and redundancy\n` +
                  `- Sharpen dialogue; remove "as you know Bob" exposition\n` +
                  `- Maintain the chapter's plot beats and emotional arc — don't change the story, just the prose quality\n` +
                  `- Ensure word count is at least ${wpc}\n\n` +
                  `CRITICAL OUTPUT RULES:\n` +
                  `1. Output the COMPLETE polished chapter as prose. No commentary. No "here's the revised version:" preamble.\n` +
                  `2. Do NOT output a list of changes or a critique.\n` +
                  `3. Do NOT shorten the chapter. The polished version should be the same length or longer.\n` +
                  `4. Start directly with the chapter content (or "# Chapter ${ch}: ..." heading).`;
                migrated++;
              }
            }
          }
          this.projects.set(p.id, p);
        }
        console.log(`  ✓ Restored ${state.projects.length} projects from disk` +
          (migrated > 0 ? ` (migrated ${migrated} legacy self-review step${migrated === 1 ? '' : 's'} to polish)` : ''));
        // Persist the migration so it doesn't run again on next boot.
        if (migrated > 0) this.persistState();
      }
    } catch (err) {
      console.error('  ⚠ Failed to load project state:', err);
    }
  }

  /**
   * Wire up AI capabilities so ProjectEngine can call the AI for dynamic planning.
   * Called after the router is initialized in index.ts.
   */
  setAI(complete: AICompleteFunc, selectProvider: AISelectProviderFunc): void {
    this.aiComplete = complete;
    this.aiSelectProvider = selectProvider;
  }

  setContextEngine(engine: ContextEngine): void {
    this.contextEngine = engine;
  }

  // ── Novel Pipeline ──

  /**
   * Create a full novel pipeline project with 30+ steps covering all phases:
   * premise → book bible → outline → writing → revision → assembly
   */
  createNovelPipeline(title: string, description: string, config: NovelPipelineConfig = {}): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();

    const chapters = Math.min(Math.max(config.targetChapters || 25, 1), 200);
    const wordsPerChapter = Math.max(config.targetWordsPerChapter || 3000, 100);

    // Build premise context from config fields
    const premiseContext = [
      config.logline && `Logline: ${config.logline}`,
      config.genre && `Genre: ${config.genre}`,
      config.setting && `Setting: ${config.setting}`,
      config.tone && `Tone: ${config.tone}`,
      config.pov && `POV: ${config.pov}`,
      config.tense && `Tense: ${config.tense}`,
      config.themes && `Themes: ${config.themes}`,
      config.protagonistName && `Protagonist: ${config.protagonistName}`,
      config.antagonistName && `Antagonist: ${config.antagonistName}`,
    ].filter(Boolean).join('\n');

    const premiseBlock = premiseContext
      ? `\n\nProject Configuration:\n${premiseContext}`
      : '';

    // Calculate structural beats for outline
    const setupEnd = Math.max(Math.round(chapters * 0.12), 1);
    const incitingEnd = Math.max(Math.round(chapters * 0.20), setupEnd + 1);
    const midpoint = Math.round(chapters * 0.50);
    const twist75 = Math.round(chapters * 0.75);
    const climaxStart = chapters - 2;
    const climaxEnd = chapters - 1;

    const steps: ProjectStep[] = [];
    let stepNum = 0;

    const addStep = (
      label: string,
      phase: string,
      taskType: string,
      prompt: string,
      opts: { skill?: string; wordCountTarget?: number; chapterNumber?: number } = {}
    ) => {
      stepNum++;
      steps.push({
        id: `${id}-step-${stepNum}`,
        label,
        phase,
        taskType,
        prompt,
        status: 'pending',
        skill: opts.skill,
        wordCountTarget: opts.wordCountTarget,
        chapterNumber: opts.chapterNumber,
      });
    };

    // ── Phase: Premise (2 steps) ──
    addStep('Develop premise', 'premise', 'general',
      `Develop this story concept into a complete premise for "${title}":${premiseBlock}\n\n${description}\n\nCreate:\n- A refined logline (1-2 sentences)\n- The central What-If question\n- Protagonist's want vs need\n- The core conflict\n- Stakes: personal, professional, and global\n- Theme statement\n- 3 comparable titles\n\nWrite a thorough, detailed response. Do not abbreviate.`,
      { skill: 'premise' }
    );

    addStep('Refine premise', 'premise', 'general',
      `Refine the "${title}" premise further. Using everything from the initial premise, add:\n- The antagonist's motivation and logic\n- The ticking clock: what specific deadline creates urgency?\n- 3 possible plot twists (one at midpoint, one at 75%, one final revelation)\n- The emotional core: what personal loss or wound drives the protagonist?\n\nWrite a thorough, detailed response.`,
      { skill: 'premise' }
    );

    // ── Phase: Book Bible (6 steps) ──
    addStep('Protagonist profile', 'bible', 'book_bible',
      `Create a detailed protagonist profile for "${title}".\n\nInclude: full name, age, role, skills, fatal flaw, emotional wound, backstory, motivation (want vs need), character arc from beginning to end, speech patterns, physical description, and key relationships.\n\nWrite 500+ words of substantive character development.`,
      { skill: 'book-bible' }
    );

    addStep('Antagonist profile', 'bible', 'book_bible',
      `Create a detailed antagonist profile for "${title}".\n\nInclude: capabilities, constraints, goals, motivation, backstory, communication style, personality quirks, why they believe they're right, and how they challenge the protagonist.\n\nWrite 500+ words of substantive character development.`,
      { skill: 'book-bible' }
    );

    addStep('Supporting characters', 'bible', 'book_bible',
      `Create 3-4 supporting character profiles for "${title}".\n\nFor each character include: name, age, role in the story, relationship to protagonist, motivation, backstory, personality traits, speech patterns, and how they contribute to the protagonist's arc.\n\nWrite 500+ words total.`,
      { skill: 'book-bible' }
    );

    addStep('Major locations', 'bible', 'book_bible',
      `Build out the major locations for "${title}".\n\nCreate 4-5 key locations. For each: name, physical description, atmosphere, who frequents it, significance to the plot, and sensory details (sounds, smells, textures, light).\n\nWrite 500+ words.`,
      { skill: 'book-bible' }
    );

    addStep('Timeline', 'bible', 'book_bible',
      `Create a detailed timeline for "${title}".\n\nInclude: key backstory events before the novel begins, the chronological sequence of major plot events, crisis escalation points, and the resolution timeline. Note which characters are present at each key event.\n\nWrite 500+ words.`,
      { skill: 'book-bible' }
    );

    addStep('World rules & consistency guide', 'bible', 'consistency',
      `Create a consistency guide and world rules document for "${title}".\n\nInclude: naming conventions, key terminology, character physical details that must remain consistent, technology/magic rules, social structures, and any other details that must stay consistent across ${chapters} chapters.\n\nWrite 500+ words.`,
      { skill: 'book-bible' }
    );

    // ── Phase: Outline (2 steps) ──
    addStep('Chapter outline', 'outline', 'outline',
      `Create a ${chapters}-chapter outline for "${title}" with structural beats.\n\nFor each chapter include:\n- Chapter number and title\n- POV character\n- Primary location\n- 3-5 key beats\n- Tension level (1-10)\n- Chapter ending hook\n\nStructure:\n- Chapters 1-${setupEnd}: Setup and world introduction\n- Chapters ${setupEnd + 1}-${incitingEnd}: Inciting incident\n- Chapters ${incitingEnd + 1}-${midpoint - 1}: Rising action\n- Chapter ${midpoint}: Midpoint twist\n- Chapters ${midpoint + 1}-${twist75 - 1}: Complications multiply\n- Chapter ${twist75}: 75% twist / all is lost\n- Chapters ${climaxStart}-${climaxEnd}: Climax sequence\n- Chapter ${chapters}: Resolution\n\nYou MUST include ALL ${chapters} chapters. Do NOT stop early. Number every chapter.`,
      { skill: 'outline' }
    );

    addStep('Scene breakdowns', 'outline', 'outline',
      `Expand the ${chapters}-chapter outline into scene-by-scene breakdowns for "${title}".\n\nFor each chapter, create 2-4 scenes with:\n- Scene goal and conflict\n- Key dialogue moments or reveals\n- Emotional beats\n- Estimated word count per scene\n\nTarget ~${wordsPerChapter} words per chapter. Focus especially on the inciting incident, midpoint twist, and climax sequence.`,
      { skill: 'outline' }
    );

    // ── Phase: Writing (N steps, one per chapter) ──
    for (let ch = 1; ch <= chapters; ch++) {
      addStep(`Write Chapter ${ch}`, 'writing', 'creative_writing',
        `Write Chapter ${ch} of "${title}".\n\nInstructions:\n- Follow the outline beats and scene breakdowns for this chapter\n- Check the Book Bible for character consistency\n- You MUST write at least ${wordsPerChapter} words of actual prose narrative\n- Open with a hook — no throat-clearing\n- End with a reason to turn the page\n- Include sensory details and internal tension\n- Write the COMPLETE chapter as actual prose, not a summary\n- Do NOT write fewer than ${wordsPerChapter} words. If running short, add more scenes, dialogue, internal monologue, sensory detail.`,
        { skill: 'write', wordCountTarget: wordsPerChapter, chapterNumber: ch }
      );
    }

    // ── Phase: Revision (3 steps) ──
    addStep('Developmental edit', 'revision', 'revision',
      `Perform a developmental edit across all ${chapters} chapters of "${title}".\n\nAnalyze:\n- Plot structure and pacing across the full arc\n- Character arc completion (do characters grow/change as planned?)\n- Tension and stakes escalation\n- Thematic coherence\n- Narrative drive and hooks between chapters\n\nProvide specific, chapter-by-chapter feedback with actionable suggestions.`,
      { skill: 'revise' }
    );

    addStep('Line edit notes', 'revision', 'revision',
      `Perform a line edit review of "${title}".\n\nFocus on:\n- Sentence rhythm and variety\n- Word choice and verb strength\n- Show vs tell instances\n- Dialogue quality and tag usage\n- Prose clarity and flow\n- Filler words to cut (suddenly, very, just, basically)\n\nProvide specific examples from the chapters with before/after suggestions.`,
      { skill: 'revise' }
    );

    addStep('Consistency check', 'revision', 'consistency',
      `Run a consistency check across all ${chapters} chapters of "${title}" against the Book Bible.\n\nCheck for:\n- Character description contradictions\n- Timeline inconsistencies\n- Location detail mismatches\n- World rule violations\n- Plot holes or dropped threads\n- Tone/voice inconsistencies\n\nList any issues with specific chapter references.`,
      { skill: 'revise' }
    );

    // ── Phase: Assembly (1 step) ──
    addStep('Assemble manuscript & report', 'assembly', 'general',
      `Generate a completion report for "${title}".\n\nInclude:\n- Total chapters: ${chapters}\n- Target word count: ~${(chapters * wordsPerChapter).toLocaleString()} words\n- Assessment of the manuscript's strengths\n- Areas for improvement in a future draft\n- 2-3 sentence back cover blurb\n- Recommendations for next steps (beta readers, professional edit, etc.)\n\nAll chapter files have been saved individually. This report summarizes the complete pipeline.`
    );

    const project: Project = {
      id,
      type: 'novel-pipeline',
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: {
        planning: 'novel-pipeline',
        config,
        targetChapters: chapters,
        targetWordsPerChapter: wordsPerChapter,
        estimatedTotalWords: chapters * wordsPerChapter,
      },
    };

    this.projects.set(id, project);
    this.persistState();
    console.log(`  ✓ Novel pipeline created: "${title}" — ${steps.length} steps, ${chapters} chapters, ~${(chapters * wordsPerChapter).toLocaleString()} words target`);
    return project;
  }

  // ── Template Discovery ──

  /**
   * Return all available project templates for the dashboard
   */
  getTemplates(): Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }> {
    return this.templateCatalog;
  }

  // ── Dynamic Planning (The "Magic") ──

  /**
   * Ask the AI to decompose a task into steps dynamically.
   * This is the core "tell the agent what you want and it figures out the steps" feature.
   * Falls back to template-based planning if AI planning fails.
   */
  async planProject(
    title: string,
    description: string,
    skillCatalog: SkillCatalogEntry[],
    authorOSTools: string[],
    context?: Record<string, any>
  ): Promise<Project> {
    if (!this.aiComplete || !this.aiSelectProvider) {
      // No AI wired — fall back to the resolved library pipeline / single-step
      console.log('  \u26a0 AI not wired for planning \u2014 falling back to the resolved library pipeline');
      const type = this.inferProjectType(description);
      return this.createProjectResolved(type, title, description, context);
    }

    try {
      const provider = this.aiSelectProvider('general');

      // Build skill catalog for the planner prompt
      const skillList = skillCatalog.map(s =>
        `- **${s.name}** (${s.category}${s.premium ? ' \u2605' : ''}): ${s.description} [triggers: ${s.triggers.join(', ')}]`
      ).join('\n');

      const toolList = authorOSTools.length > 0
        ? `\n\nAuthor OS Tools Available:\n${authorOSTools.map(t => `- ${t}`).join('\n')}`
        : '';

      const validTaskTypes = Object.keys(TASK_TYPE_MAP).join(', ');

      const plannerPrompt = `You are a task planner for BookClaw, an autonomous AI writing agent.

The user wants to accomplish something. Your job is to break it down into a sequence of concrete, executable steps.

## Available Skills
${skillList}
${toolList}

## Valid Task Types
${validTaskTypes}

## Rules
1. Match step count to task complexity:
   - Simple tasks (write a blurb, intro, scene, short piece): 1-2 steps
   - Medium tasks (outline a story, research a topic, analyze style): 3-5 steps
   - Large tasks (write a full novel/book): 7-15 steps with ALL phases
2. ONLY plan full novel pipelines (premise \u2192 characters \u2192 world \u2192 outline \u2192 chapters \u2192 revision \u2192 assembly) when the user EXPLICITLY asks for a novel, book, or full manuscript
3. Each step should be a single, focused task
4. Reference specific skills by name when relevant
5. Use appropriate taskType for each step (affects which AI model is used)
6. Each step's prompt should be detailed enough to execute standalone
7. Later steps should reference earlier work naturally (e.g., "Using the characters we developed...")

## Output Format
Return ONLY valid JSON, no markdown fences, no explanation:
{"steps":[{"label":"step name","skill":"skill-name-or-null","taskType":"task_type","prompt":"detailed prompt for this step"}]}

## User's Request
Title: ${title}
Description: ${description}`;

      const result = await this.aiComplete({
        provider: provider.id,
        system: plannerPrompt,
        messages: [{ role: 'user', content: `Plan the steps to accomplish: ${description}` }],
        maxTokens: 4096,
        temperature: 0.3,
      });

      // Parse the AI's response
      const parsed = this.parsePlanResponse(result.text);

      if (parsed && parsed.steps && parsed.steps.length > 0) {
        // Build the project from AI-planned steps
        const id = `project-${this.nextId++}`;
        const now = new Date().toISOString();

        const steps: ProjectStep[] = parsed.steps.map((s: any, i: number) => ({
          id: `${id}-step-${i + 1}`,
          label: s.label || `Step ${i + 1}`,
          skill: s.skill && s.skill !== 'null' ? s.skill : undefined,
          taskType: s.taskType || 'general',
          prompt: s.prompt || description,
          status: 'pending' as const,
        }));

        // Enhance with Author OS
        const enhancedSteps = this.authorOS ? this.enhanceWithAuthorOS(steps) : steps;

        const project: Project = {
          id,
          type: this.inferProjectType(description),
          title,
          description,
          status: 'pending',
          progress: 0,
          steps: enhancedSteps,
          createdAt: now,
          updatedAt: now,
          context: { ...context, planning: 'dynamic', planProvider: result.provider },
          ...(context?.bookSlug ? { bookSlug: context.bookSlug } : {}),
        };

        this.projects.set(id, project);
        this.persistState();
        console.log(`  \u2713 AI planned ${steps.length} steps for "${title}" (via ${result.provider})`);
        return project;
      }

      // If parsing failed, fall back to the resolved library pipeline / single-step
      console.log('  \u26a0 AI plan parsing failed \u2014 falling back to the resolved library pipeline');
      const type = this.inferProjectType(description);
      return this.createProjectResolved(type, title, description, context);

    } catch (error) {
      console.error('  \u2717 AI planning failed:', error);
      const type = this.inferProjectType(description);
      return this.createProjectResolved(type, title, description, context);
    }
  }

  /**
   * Parse the AI's JSON plan response, handling common formatting issues
   */
  private parsePlanResponse(text: string): any {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from mixed text
      const jsonMatch = cleaned.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      return null;
    }
  }

  // ── Project Lifecycle ──

  /**
   * Create a project from a data-driven pipeline definition (the active book's
   * templates/pipeline.json, LibraryPipeline shape). This replaces the static
   * step-template lookup that was removed in book-container Phase 3c.
   *
   *  - `dynamic: true` (novel-pipeline) → delegate to the code generator using
   *    config pulled from the book context (genre/chapters/words).
   *  - else → build Steps from `pipeline.steps[]`, interpolating {{title}},
   *    {{description}}, {{genre}} (and any other string keys in `context`).
   *
   * The pipeline `name` becomes the project `type` so downstream phase/assembly
   * logic (which keys off type === 'novel-pipeline' etc.) keeps working.
   */
  createProjectFromPipeline(
    pipeline: LibraryPipeline,
    title: string,
    description: string,
    context?: Record<string, any>,
  ): Project {
    // Validate the non-dynamic path up front: a corrupted pipeline.json (steps
    // missing or not an array) would otherwise raise a raw TypeError inside the
    // .map() below, surfacing as an unhandled rejection in the async create
    // handler. The dynamic / novel-pipeline branch never touches steps.
    if (!pipeline || (!pipeline.dynamic && pipeline.name !== 'novel-pipeline' && !Array.isArray(pipeline.steps))) {
      throw new Error('Invalid pipeline: steps[] missing or not an array');
    }

    if (pipeline.dynamic || pipeline.name === 'novel-pipeline') {
      // Dynamic novel pipeline stays code-generated; map book context → config.
      const cfg: NovelPipelineConfig = {
        genre: context?.genre,
        pov: context?.pov,
        logline: context?.logline,
        themes: context?.themes,
        setting: context?.setting,
        tone: context?.tone,
        tense: context?.tense,
        targetChapters: context?.targetChapters,
        targetWordsPerChapter: context?.targetWordsPerChapter,
        protagonistName: context?.protagonistName,
        antagonistName: context?.antagonistName,
      };
      const novel = this.createNovelPipeline(title, description, cfg);
      // createNovelPipeline is code-generated and takes no context, so stamp the
      // Phase 8 book binding here — otherwise the dynamic/novel branch would drop
      // the bookSlug that callers thread via context (the static branch below keeps
      // it), leaving the project unbound and routing to the global active book.
      if (context?.bookSlug) novel.bookSlug = context.bookSlug;
      return novel;
    }

    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();
    let steps: ProjectStep[] = pipeline.steps.map((s, i) => ({
      id: `${id}-step-${i + 1}`,
      label: s.label,
      skill: s.skill,
      toolSuggestion: s.toolSuggestion,
      taskType: s.taskType,
      prompt: this.expandTemplate(s.promptTemplate, { title, description, ...context }),
      status: 'pending' as const,
      ...(s.phase ? { phase: s.phase } : {}),
      ...(s.wordCountTarget ? { wordCountTarget: s.wordCountTarget } : {}),
      ...(s.chapterNumber ? { chapterNumber: s.chapterNumber } : {}),
    }));

    if (this.authorOS) steps = this.enhanceWithAuthorOS(steps);

    const project: Project = {
      id,
      type: (pipeline.name as ProjectType),
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: context || {},
      ...(context?.bookSlug ? { bookSlug: context.bookSlug } : {}),
    };
    this.projects.set(id, project);
    this.persistState();
    console.log(`  ✓ Project "${title}": built ${steps.length} Step(s) from pipeline "${pipeline.name}"`);
    return project;
  }

  /**
   * Build a project for a given type, preferring the library pipeline.
   * Resolves the type via the injected pipeline resolver; if a LibraryPipeline
   * is found, builds the full multi-step project from it (the library pipeline's
   * name == type, so createProjectFromPipeline sets the correct project type).
   * Fail-soft: if the resolver is unset or the pipeline is missing, falls back
   * to the single-step custom project.
   */
  createProjectResolved(
    type: ProjectType,
    title: string,
    description: string,
    context?: Record<string, any>
  ): Project {
    const pl = this.pipelineResolver?.(type) ?? null;
    return pl
      ? this.createProjectFromPipeline(pl, title, description, context)
      : this.createProject(type, title, description, context);
  }

  /**
   * Create a single-step custom project from the user's description.
   * Thin fallback used when no pipeline/template path applies (the static
   * step templates were removed in book-container Phase 3c — typed pipelines
   * now flow through createProjectFromPipeline / createNovelPipeline).
   * Returns the project with one auto-planned step.
   */
  createProject(
    type: ProjectType,
    title: string,
    description: string,
    context?: Record<string, any>
  ): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();

    // Single step with the user's description.
    let steps: ProjectStep[] = [{
      id: `${id}-step-1`,
      label: title,
      taskType: this.inferTaskType(description),
      prompt: description,
      status: 'pending',
    }];

    // Enhance steps with Author OS tool suggestions if available
    if (this.authorOS) {
      steps = this.enhanceWithAuthorOS(steps);
    }

    const project: Project = {
      id,
      type,
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: context || {},
      ...(context?.bookSlug ? { bookSlug: context.bookSlug } : {}),
    };

    this.projects.set(id, project);
    this.persistState();
    return project;
  }

  /**
   * Get a specific project by ID
   */
  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  /**
   * List all projects, optionally filtered by status
   */
  listProjects(status?: string): Project[] {
    const projects = Array.from(this.projects.values());
    if (status) {
      return projects.filter(p => p.status === status);
    }
    return projects;
  }

  /**
   * Start executing a project — marks it active and returns the first step
   */
  startProject(id: string): ProjectStep | null {
    const project = this.projects.get(id);
    if (!project) return null;

    project.status = 'active';
    project.updatedAt = new Date().toISOString();

    const firstPending = project.steps.find(s => s.status === 'pending');
    if (firstPending) {
      firstPending.status = 'active';
      return firstPending;
    }

    return null;
  }

  /**
   * Complete the current step and advance to the next.
   * Returns the next step, or null if the project is complete.
   */
  completeStep(projectId: string, stepId: string, result: string): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.result = result;
    }

    // Calculate progress (include skipped as "done")
    const done = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((done / project.steps.length) * 100);
    project.updatedAt = new Date().toISOString();

    // Find next step to run — prefer pending, then check for orphaned active steps
    // (active steps can occur from race conditions in concurrent auto-execute)
    const next = project.steps.find(s => s.status === 'pending')
              || project.steps.find(s => s.status === 'active' && s.id !== stepId);
    if (next) {
      next.status = 'active';
      // Enrich the next prompt with results from completed steps
      next.prompt = this.enrichWithPriorResults(next.prompt, project);
      return next;
    }

    // Truly all steps done — mark project complete only if no pending/active remain
    const remaining = project.steps.filter(s => s.status === 'pending' || s.status === 'active');
    if (remaining.length === 0) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
      // Fire the completion hook (used by AutoSkill + UserModel observation).
      // Fire-and-forget so persistence isn't blocked by hook latency.
      try {
        for (const fn of this.completionHooks) {
          Promise.resolve(fn(project)).catch(err => console.error('[project-completion-hook] error:', err));
        }
      } catch { /* hook crashes never block completeStep */ }
    }
    this.persistState();
    return null;
  }

  /** Callbacks invoked when a project transitions to 'completed' status. */
  private completionHooks: Array<(project: Project) => void | Promise<void>> = [];

  /** Register a callback fired on project completion. */
  onProjectCompleted(fn: (project: Project) => void | Promise<void>): void {
    this.completionHooks.push(fn);
  }

  /**
   * Mark a step as failed
   */
  failStep(projectId: string, stepId: string, error: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.error = error;
    }

    project.updatedAt = new Date().toISOString();
    this.persistState();
  }

  /**
   * Reset a single failed (or active) step back to pending so the user can
   * retry it. Clears the error message + result. Does NOT delete the step's
   * file output on disk — caller can do that separately if needed.
   *
   * Returns the step so the caller can re-run it via auto-execute / execute.
   */
  retryStep(projectId: string, stepId: string): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return null;
    if (step.status === 'completed') {
      // Allow re-running completed steps too (user wants a different output).
      // Keep the old result in step.error as a "previous attempt" marker.
      step.error = `[Previous output preserved on retry]\n${step.result?.substring(0, 500) || ''}`;
    }
    step.status = 'pending';
    step.error = step.error || undefined;
    step.result = undefined;
    project.status = 'active';
    project.updatedAt = new Date().toISOString();
    this.persistState();
    return step;
  }

  /**
   * Set or clear a step's per-step model override. Pass null to clear (revert
   * the step to tier routing / the project default). A blank model means "pin
   * the provider only" — the provider's configured default model is used.
   */
  setStepModelOverride(
    projectId: string,
    stepId: string,
    override: { provider: string; model?: string } | null
  ): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return null;
    if (!override || !override.provider) {
      delete step.modelOverride;
    } else {
      const model = override.model?.trim();
      step.modelOverride = model ? { provider: override.provider, model } : { provider: override.provider };
    }
    project.updatedAt = new Date().toISOString();
    this.persistState();
    return step;
  }

  /**
   * Reset the entire project: every failed/active step → pending, project
   * status → pending. Useful when the user wants to clean-start after a
   * cluster of failures.
   *
   * Optionally deletes step output files from disk. The route handler is
   * responsible for actually unlinking files; this method only mutates state.
   *
   * Returns a summary of which steps were reset.
   */
  restartProject(projectId: string, opts: { keepCompleted?: boolean } = {}): {
    project: Project;
    reset: string[];
  } | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const reset: string[] = [];
    for (const step of project.steps) {
      if (step.status === 'failed' || step.status === 'active') {
        step.status = 'pending';
        step.error = undefined;
        step.result = undefined;
        reset.push(step.id);
      } else if (step.status === 'completed' && !opts.keepCompleted) {
        step.status = 'pending';
        step.error = undefined;
        step.result = undefined;
        reset.push(step.id);
      }
    }
    project.status = reset.length > 0 ? 'pending' : project.status;
    project.progress = 0;
    project.updatedAt = new Date().toISOString();
    this.persistState();
    return { project, reset };
  }

  /**
   * Skip a step
   */
  skipStep(projectId: string, stepId: string): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
    }

    // Update progress
    const done = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((done / project.steps.length) * 100);
    project.updatedAt = new Date().toISOString();

    // Advance
    const next = project.steps.find(s => s.status === 'pending');
    if (next) {
      next.status = 'active';
      this.persistState();
      return next;
    }

    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    this.persistState();
    return null;
  }

  /**
   * Pause a project
   */
  pauseProject(id: string): void {
    const project = this.projects.get(id);
    if (!project) return;
    project.status = 'paused';
    project.updatedAt = new Date().toISOString();

    // Pause any active steps
    project.steps.forEach(s => {
      if (s.status === 'active') s.status = 'pending';
    });
    this.persistState();
  }

  /**
   * Delete a project
   */
  deleteProject(id: string): boolean {
    const result = this.projects.delete(id);
    if (result) this.persistState();
    return result;
  }

  /**
   * Build the system prompt addition for a project step.
   * This tells the AI what context it's operating in.
   */
  async buildProjectContext(project: Project, step: ProjectStep): Promise<string> {
    let context = `\n# Current Project\n\n`;
    context += `**Project**: ${project.title}\n`;
    context += `**Type**: ${project.type}\n`;
    context += `**Progress**: ${project.progress}% (step ${project.steps.indexOf(step) + 1} of ${project.steps.length})\n`;
    context += `**Current Step**: ${step.label}\n\n`;

    // Novel pipeline: phase-aware context accumulation
    if (project.type === 'novel-pipeline' && step.phase) {
      context += this.buildNovelPipelineContext(project, step);
    } else if (project.type === 'book-production') {
      // Book production: per-chapter scope. The polish step needs the FULL
      // prior write step (the chapter to revise) — truncating it would force
      // the AI to half-revise from a fragment. Other writing steps just need
      // compact summaries of prior chapters so the AI has continuity without
      // the context window exploding on chapter 25.
      context += this.buildBookProductionContext(project, step);
    } else {
      // Default: add results from prior steps
      const completedSteps = project.steps.filter(s => s.status === 'completed' && s.result);
      if (completedSteps.length > 0) {
        context += `## Previous Steps Completed\n\n`;
        for (const cs of completedSteps) {
          context += `### ${cs.label}\n`;
          const result = cs.result!;
          if (result.length > 2000) {
            context += `[...truncated...]\n${result.slice(-2000)}\n\n`;
          } else {
            context += `${result}\n\n`;
          }
        }
      }
    }

    // Include uploaded manuscript content (from Upload button)
    if (project.context?.uploadedContent) {
      const uploads = project.context.uploads || [];
      const fileList = uploads.map((u: any) => `${u.filename} (${u.wordCount} words)`).join(', ');
      context += `## Uploaded Manuscript\n\n`;
      context += `**Files**: ${fileList}\n\n`;
      // Include up to 30k chars of uploaded content for the AI to work with
      const uploaded = String(project.context.uploadedContent);
      if (uploaded.length > 30000) {
        context += uploaded.substring(0, 30000) + '\n\n[...truncated at 30,000 chars — full text available in workspace...]\n\n';
      } else {
        context += uploaded + '\n\n';
      }
    }

    // Inject Core Lessons from self-improvement analysis (if available)
    // These are distilled insights from all previous completed projects
    const coreLessons = await this.getCoreLessons();
    if (coreLessons) {
      context += `\n## Writing Lessons Learned\n\n${coreLessons}\n\n`;
    }

    // Add Author OS tool suggestion with actionable instructions
    if (step.toolSuggestion) {
      const toolInstructions: Record<string, string> = {
        'workflow-engine': 'Load the relevant JSON workflow template and follow its step sequence.',
        'book-bible': 'Use the Book Bible data for character/world consistency checks.',
        'manuscript-autopsy': 'Run manuscript analysis for pacing and structure feedback.',
        'format-factory': 'Use Format Factory Pro: python format_factory_pro.py <input> -t "Title" --all',
        'creator-asset-suite': 'Generate marketing assets using the Creator Asset Suite tools.',
        'ai-author-library': 'Reference writing prompts and voice markers from the library.',
      };
      context += `\n**Suggested Tool**: Author OS ${step.toolSuggestion}\n`;
      const instruction = toolInstructions[step.toolSuggestion];
      if (instruction) {
        context += `**How to use**: ${instruction}\n`;
      }
    }

    return context;
  }

  /**
   * Build phase-aware context for novel pipeline steps.
   * Each phase gets relevant prior outputs without overwhelming the context window.
   */
  /**
   * Phase-aware context for book-production projects.
   *
   * For polish steps: includes the FULL preceding write step (the chapter to
   * revise) at unlimited length, plus compact 200-word endings of older
   * chapters for continuity. Without this, the polish step's AI was getting
   * a 2000-char fragment of the chapter and producing inconsistent rewrites.
   *
   * For write steps: includes compact summaries of prior chapters so chapter
   * 25 doesn't cost 60K tokens of full prior-chapter context.
   */
  private buildBookProductionContext(project: Project, step: ProjectStep): string {
    const stepIdx = project.steps.indexOf(step);
    const stepCh = (step as any).chapterNumber || 0;
    const isPolish = step.phase === 'polish';
    const isWrite = step.skill === 'write';

    let context = '';
    const completed = project.steps.filter(s => s.status === 'completed' && s.result);
    if (completed.length === 0) return context;

    if (isPolish && stepIdx > 0) {
      // The Write step for the same chapter is immediately prior. Find it
      // explicitly rather than relying on indexOf order.
      const writeStep = project.steps.find(s =>
        s.skill === 'write' &&
        (s as any).chapterNumber === stepCh &&
        s.status === 'completed' && s.result);
      if (writeStep) {
        context += `## Chapter ${stepCh} — first draft (revise this)\n\n`;
        context += writeStep.result!;
        context += '\n\n';
      }
      // Also include 1-line endings of earlier chapters for tone continuity.
      const earlier = completed.filter(s =>
        s.skill === 'write' && ((s as any).chapterNumber || 0) < stepCh);
      if (earlier.length > 0) {
        context += `## Earlier chapter endings (for continuity)\n\n`;
        for (const e of earlier.slice(-3)) {
          const ch = (e as any).chapterNumber;
          const tail = (e.result || '').slice(-300).replace(/\s+/g, ' ');
          context += `Ch ${ch} ended: ${tail}\n\n`;
        }
      }
      return context;
    }

    if (isWrite && stepCh > 1) {
      // For chapter N's write step, give last 1-2 polished/written chapters
      // in compact form. Pick polish output if available, write otherwise.
      const priorChapters = new Map<number, ProjectStep>();
      for (const s of completed) {
        const ch = (s as any).chapterNumber || 0;
        if (ch === 0 || ch >= stepCh) continue;
        const existing = priorChapters.get(ch);
        if (!existing) priorChapters.set(ch, s);
        else if (s.phase === 'polish' && existing.phase !== 'polish') priorChapters.set(ch, s);
      }
      const sortedChapters = Array.from(priorChapters.values())
        .sort((a, b) => ((a as any).chapterNumber || 0) - ((b as any).chapterNumber || 0));

      // Include full prose of the most recent chapter, summary of older ones.
      const lastTwo = sortedChapters.slice(-2);
      const olderOnes = sortedChapters.slice(0, -2);

      if (olderOnes.length > 0) {
        context += `## Earlier chapters (compact summary)\n\n`;
        for (const e of olderOnes) {
          const ch = (e as any).chapterNumber;
          const r = (e.result || '');
          // First 100 + last 100 chars to give opening + ending feel
          const head = r.slice(0, 200).replace(/\s+/g, ' ');
          const tail = r.slice(-200).replace(/\s+/g, ' ');
          context += `**Ch ${ch}** opening: ${head}\n  ending: ${tail}\n\n`;
        }
      }
      if (lastTwo.length > 0) {
        context += `## Most recent chapter${lastTwo.length === 1 ? '' : 's'} (full)\n\n`;
        for (const e of lastTwo) {
          const ch = (e as any).chapterNumber;
          const phaseLabel = e.phase === 'polish' ? 'polished' : 'first draft';
          context += `### Chapter ${ch} (${phaseLabel})\n\n`;
          // Cap at 4000 chars per chapter so context doesn't blow up at high N.
          const r = e.result || '';
          context += (r.length > 4000 ? r.slice(0, 2000) + '\n[...]\n' + r.slice(-2000) : r);
          context += '\n\n';
        }
      }
      return context;
    }

    // Other steps (assembly, etc.) — modest history.
    const recent = completed.slice(-3);
    if (recent.length > 0) {
      context += `## Recent steps\n\n`;
      for (const r of recent) {
        const trunc = (r.result || '').length > 1500
          ? (r.result || '').slice(-1500) : (r.result || '');
        context += `### ${r.label}\n${trunc}\n\n`;
      }
    }
    return context;
  }

  private buildNovelPipelineContext(project: Project, step: ProjectStep): string {
    let context = '';
    const completed = project.steps.filter(s => s.status === 'completed' && s.result);

    const getPhaseResults = (phase: string) =>
      completed.filter(s => s.phase === phase);

    const truncate = (text: string, max: number) =>
      text.length > max ? text.slice(0, max) + '\n\n[...truncated...]' : text;

    switch (step.phase) {
      case 'premise': {
        // First premise step gets just the config; second gets first premise result
        const priorPremise = getPhaseResults('premise');
        if (priorPremise.length > 0) {
          context += `## Prior Premise Work\n\n${priorPremise.map(s => s.result).join('\n\n')}\n\n`;
        }
        break;
      }

      case 'bible': {
        // Bible steps get the full premise
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${premiseResults.map(s => s.result).join('\n\n')}\n\n`;
        }
        // Plus any prior bible steps
        const priorBible = getPhaseResults('bible').filter(s => s.id !== step.id);
        if (priorBible.length > 0) {
          context += `## Book Bible (so far)\n\n`;
          for (const bs of priorBible) {
            context += `### ${bs.label}\n${truncate(bs.result!, 1500)}\n\n`;
          }
        }
        break;
      }

      case 'outline': {
        // Outline gets premise + summarized bible
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${truncate(premiseResults.map(s => s.result).join('\n\n'), 3000)}\n\n`;
        }
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 1000)}\n\n`;
          }
        }
        // Prior outline steps
        const priorOutline = getPhaseResults('outline').filter(s => s.id !== step.id);
        if (priorOutline.length > 0) {
          context += `## Outline (so far)\n\n${priorOutline.map(s => s.result).join('\n\n')}\n\n`;
        }
        break;
      }

      case 'writing': {
        // Writing steps get: premise (brief) + bible (summaries) + outline + last 2 chapters (sliding window)
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${truncate(premiseResults.map(s => s.result).join('\n\n'), 1500)}\n\n`;
        }
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible (key details)\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 600)}\n\n`;
          }
        }
        // Full outline
        const outlineResults = getPhaseResults('outline');
        if (outlineResults.length > 0) {
          context += `## Outline\n\n${truncate(outlineResults.map(s => s.result).join('\n\n'), 4000)}\n\n`;
        }
        // Try ContextEngine first for smarter context
        const engineContext = this.contextEngine?.getRelevantContext(project.id, step.id, step.prompt || '', 12000);
        if (engineContext && engineContext.length > 100) {
          context += engineContext + '\n\n';
        } else {
          // Fall back to existing sliding window behavior
          // Sliding window: last 2 completed chapter results
          const writtenChapters = getPhaseResults('writing');
          if (writtenChapters.length > 0) {
            const recent = writtenChapters.slice(-2);
            context += `## Recent Chapters (for continuity)\n\n`;
            for (const ch of recent) {
              context += `### ${ch.label}\n${truncate(ch.result!, 2000)}\n\n`;
            }
          }
        }  // end fallback
        break;
      }

      case 'revision': {
        // Revision gets: bible summaries + outline summary + all chapter summaries
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 800)}\n\n`;
          }
        }
        const outlineResults = getPhaseResults('outline');
        if (outlineResults.length > 0) {
          context += `## Outline\n\n${truncate(outlineResults.map(s => s.result).join('\n\n'), 3000)}\n\n`;
        }
        // Brief summaries of all chapters
        const writtenChapters = getPhaseResults('writing');
        if (writtenChapters.length > 0) {
          context += `## Chapter Drafts (summaries)\n\n`;
          for (const ch of writtenChapters) {
            context += `### ${ch.label}\n${truncate(ch.result!, 500)}\n\n`;
          }
        }
        break;
      }

      case 'assembly': {
        // Assembly gets a brief overview of everything
        const totalWords = getPhaseResults('writing').reduce((sum, s) => {
          return sum + (s.result?.split(/\s+/).length || 0);
        }, 0);
        context += `## Pipeline Summary\n\n`;
        context += `- Chapters written: ${getPhaseResults('writing').length}\n`;
        context += `- Approximate total words: ${totalWords.toLocaleString()}\n`;
        context += `- Revision steps completed: ${getPhaseResults('revision').length}\n\n`;
        // Include consistency check results if available
        const consistencyCheck = completed.find(s => s.label === 'Consistency check');
        if (consistencyCheck?.result) {
          context += `## Consistency Check Results\n\n${truncate(consistencyCheck.result, 3000)}\n\n`;
        }
        break;
      }

      default: {
        // Fallback: include all prior results (truncated)
        for (const cs of completed) {
          context += `### ${cs.label}\n${truncate(cs.result!, 1000)}\n\n`;
        }
      }
    }

    return context;
  }

  // ── Smart Project from Natural Language ──

  /**
   * Infer the best project type from a natural language description.
   * Used when the user just says what they want without specifying a type.
   */
  inferProjectType(description: string): ProjectType {
    const lower = description.toLowerCase();

    // Novel pipeline signals — ONLY when explicitly asking for a full novel/book
    if (lower.match(/\b(novel|full book|write a book|write my book|entire book|complete novel|full manuscript|book from scratch|novel pipeline|write a complete)\b/)) {
      return 'novel-pipeline';
    }

    // Pipeline signals — wants the full production chain
    if (lower.match(/\b(pipeline|full production|end.?to.?end|planning through launch|all phases)\b/)) {
      return 'pipeline';
    }

    // Book Planning signals
    if (lower.match(/\b(plan|outline|structure|plot|brainstorm|concept|story map|beat sheet|premise|logline|synopsis)\b/)) {
      return 'book-planning';
    }

    // Book Bible signals
    if (lower.match(/\b(world.?build|book.?bible|bible|magic system|timeline|backstory|lore|character bible|continuity)\b/)) {
      return 'book-bible';
    }

    // Book Production signals
    if (lower.match(/\b(chapter|scene|prose|manuscript|draft|write.*chapter|write.*scene|book production)\b/)) {
      return 'book-production';
    }

    // Deep revision signals — must come before general revision
    if (lower.match(/\b(deep.?revis|deep.?edit|full.?revision|manuscript.?review|beta.?reader|comprehensive.?edit|revision.?pipeline|deep.?analysis|manuscript.?analysis|manuscript.?audit|edit.*book|revise|rewrite|feedback|critique|proofread|consistency)\b/)) {
      return 'deep-revision';
    }

    // Format & Export signals
    if (lower.match(/\b(export|format|compile|epub|pdf|docx|publish|kdp|kindle|front matter|back matter)\b/)) {
      return 'format-export';
    }

    // Book Launch signals
    if (lower.match(/\b(launch|blurb|amazon desc|keywords|ad copy|advertise|promote|market|social media|book description|categories)\b/)) {
      return 'book-launch';
    }

    // Default: let the AI planner figure out the best approach
    return 'custom';
  }

  /**
   * Create a full pipeline: chains all 6 project phases from a single idea.
   * Each phase is a separate sub-project linked by pipelineId.
   */
  createPipeline(
    title: string,
    description: string,
    personaId?: string,
    config?: NovelPipelineConfig,
    bookSlug?: string
  ): { pipelineId: string; projects: Project[] } {
    const pipelineId = `pipeline-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const phases: Array<{ type: ProjectType; label: string; phaseNum: number }> = [
      { type: 'book-planning', label: `${title} — Planning`, phaseNum: 1 },
      { type: 'book-bible', label: `${title} — Book Bible`, phaseNum: 2 },
      { type: 'book-production', label: `${title} — Production`, phaseNum: 3 },
      { type: 'deep-revision', label: `${title} — Deep Revision`, phaseNum: 4 },
      { type: 'format-export', label: `${title} — Format & Export`, phaseNum: 5 },
      { type: 'book-launch', label: `${title} — Book Launch`, phaseNum: 6 },
    ];

    const projects: Project[] = [];
    for (const phase of phases) {
      let project: Project;
      if (phase.type === 'book-production') {
        // Book production uses the novel pipeline chapter-writing logic
        project = this.createBookProduction(phase.label, description, config);
        // Phase 8: createBookProduction takes no context; stamp bookSlug directly.
        if (bookSlug) project.bookSlug = bookSlug;
      } else {
        // Static phases build their multi-step pipeline from the library
        // (injected resolver — keeps the engine decoupled from LibraryService).
        // Fail-soft: if the resolver is unset or the pipeline is missing, the
        // helper falls back to the single-step custom project.
        // Phase 8: thread bookSlug into context so createProjectResolved lifts it.
        project = this.createProjectResolved(phase.type, phase.label, description, { pipelineTitle: title, ...config, ...(bookSlug ? { bookSlug } : {}) });
      }
      project.pipelineId = pipelineId;
      project.pipelinePhase = phase.phaseNum;
      if (personaId) project.personaId = personaId;
      projects.push(project);
    }

    // Only the first phase starts as pending-ready; others wait
    // (Pipeline advancement is managed by the dashboard/API)
    this.persistState();
    return { pipelineId, projects };
  }

  /**
   * Create a Book Production project with dynamic chapter steps.
   */
  createBookProduction(title: string, description: string, config: NovelPipelineConfig = {}): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();
    const chapters = Math.min(Math.max(config.targetChapters || 25, 1), 200);
    const wordsPerChapter = Math.max(config.targetWordsPerChapter || 3000, 100);

    const steps: ProjectStep[] = [];
    for (let ch = 1; ch <= chapters; ch++) {
      steps.push({
        id: `${id}-step-${ch * 2 - 1}`,
        label: `Write Chapter ${ch}`,
        phase: 'writing',
        skill: 'write',
        taskType: 'creative_writing',
        prompt: `Write Chapter ${ch} of "${title}".\n\nInstructions:\n- Follow the outline beats and book bible for this chapter\n- You MUST write at least ${wordsPerChapter} words of actual prose narrative\n- Open with a hook — no throat-clearing\n- End with a reason to turn the page\n- Include sensory details and internal tension\n- Write the COMPLETE chapter as actual prose, not a summary\n\n${description}`,
        status: 'pending',
        wordCountTarget: wordsPerChapter,
        chapterNumber: ch,
      });
      // Bug fix (2026-04): the previous "Self-review Chapter N" step was
      // analysis-only — the AI produced suggestions but never applied them.
      // The compile step then mixed review notes into the manuscript because
      // both steps shared `phase: 'writing'`. Replaced with a polish step
      // that ACTUALLY rewrites the chapter incorporating its own critique
      // in a single pass, and is marked phase='polish' so compile and
      // context-engine know to treat it as the canonical chapter output.
      steps.push({
        id: `${id}-step-${ch * 2}`,
        label: `Polish Chapter ${ch}`,
        phase: 'polish',
        skill: 'revise',
        taskType: 'revision',
        prompt: `You just wrote Chapter ${ch} of "${title}" (in your context above).\n\nProduce a REVISED, POLISHED version of THE ENTIRE chapter. Apply these fixes as you rewrite:\n- Tighten pacing; cut throat-clearing\n- Strengthen weak verbs; remove unnecessary -ly adverbs\n- Replace filter words (saw, heard, felt, noticed, realized) with direct sensory experience\n- Cut repetition and redundancy\n- Sharpen dialogue; remove "as you know Bob" exposition\n- Maintain the chapter's plot beats and emotional arc — don't change the story, just the prose quality\n- Ensure word count is at least ${wordsPerChapter}\n\nCRITICAL OUTPUT RULES:\n1. Output the COMPLETE polished chapter as prose. No commentary. No "here's the revised version:" preamble.\n2. Do NOT output a list of changes or a critique.\n3. Do NOT shorten the chapter. The polished version should be the same length or longer.\n4. Start directly with the chapter content (or "# Chapter ${ch}: ..." heading).`,
        status: 'pending',
        wordCountTarget: wordsPerChapter,
        chapterNumber: ch,
      });
    }

    // Assembly step
    steps.push({
      id: `${id}-step-${chapters * 2 + 1}`,
      label: 'Compile manuscript',
      phase: 'assembly',
      taskType: 'general',
      prompt: `Generate a completion report for "${title}". Total chapters: ${chapters}. Target: ~${(chapters * wordsPerChapter).toLocaleString()} words. Assess strengths, areas for improvement, and next steps.`,
      status: 'pending',
    });

    const project: Project = {
      id,
      type: 'book-production',
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: {
        targetChapters: chapters,
        targetWordsPerChapter: wordsPerChapter,
        estimatedTotalWords: chapters * wordsPerChapter,
        ...config,
      },
    };

    this.projects.set(id, project);
    this.persistState();
    return project;
  }

  /**
   * Get all projects belonging to a pipeline.
   */
  getPipelineProjects(pipelineId: string): Project[] {
    return Array.from(this.projects.values())
      .filter(p => p.pipelineId === pipelineId)
      .sort((a, b) => (a.pipelinePhase || 0) - (b.pipelinePhase || 0));
  }

  // ── Core Lessons (self-improvement feedback loop) ──

  /**
   * Load Core Lessons from the self-improvement analysis file.
   * Cached for 5 minutes to avoid re-reading disk every step.
   * Returns null if no core lessons exist yet.
   */
  private async getCoreLessons(): Promise<string | null> {
    const now = Date.now();
    // Return cached version if less than 5 minutes old
    if (this.coreLessonsCache !== null && (now - this.coreLessonsCacheTime) < 300000) {
      return this.coreLessonsCache;
    }

    const coreLessonsPath = join(this.rootDir, 'workspace', '.agent', 'core-lessons.md');
    if (!existsSync(coreLessonsPath)) {
      this.coreLessonsCache = null;
      this.coreLessonsCacheTime = now;
      return null;
    }

    try {
      const content = await readFile(coreLessonsPath, 'utf-8');
      // Strip the header, just get the lessons content (max 1500 chars to not bloat context)
      const body = content.replace(/^#.*\n\n\*[^*]+\*\n\n/, '').trim();
      this.coreLessonsCache = body.length > 1500 ? body.substring(0, 1500) + '\n...' : body;
      this.coreLessonsCacheTime = now;
      return this.coreLessonsCache;
    } catch {
      this.coreLessonsCache = null;
      this.coreLessonsCacheTime = now;
      return null;
    }
  }

  // ── Private Helpers ──

  private expandTemplate(template: string, vars: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === 'string') {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }
    // Clean up any remaining unexpanded vars
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  private inferTaskType(description: string): string {
    const type = this.inferProjectType(description);
    const taskMap: Record<ProjectType, string> = {
      'book-planning': 'outline',
      'book-bible': 'book_bible',
      'book-production': 'creative_writing',
      'deep-revision': 'revision',
      'format-export': 'general',
      'book-launch': 'marketing',
      'novel-pipeline': 'creative_writing',
      pipeline: 'general',
      custom: 'general',
    };
    return taskMap[type] || 'general';
  }

  private enhanceWithAuthorOS(steps: ProjectStep[]): ProjectStep[] {
    if (!this.authorOS) return steps;

    const availableTools = this.authorOS.getAvailableTools();
    return steps.map(step => {
      // If the step suggests a tool, check if it's available
      if (step.toolSuggestion && !availableTools.includes(step.toolSuggestion)) {
        // Tool not available — clear suggestion but keep the step
        step.toolSuggestion = undefined;
      }
      return step;
    });
  }

  private enrichWithPriorResults(prompt: string, project: Project): string {
    // Prior step results are already included in buildProjectContext() system context.
    // Don't duplicate them in the user message — it wastes tokens and can confuse the AI.
    // Just add a brief note referencing the previous step so the AI knows to build on it.
    if (prompt.includes('we developed') || prompt.includes('we created')) {
      return prompt;
    }

    const lastCompleted = [...project.steps].reverse().find(s => s.status === 'completed' && s.result);
    if (lastCompleted) {
      return `[Build on the work from "${lastCompleted.label}" — see system context for details.]\n\n${prompt}`;
    }

    return prompt;
  }
}
