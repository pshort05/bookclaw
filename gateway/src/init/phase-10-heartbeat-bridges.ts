import { join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { HeartbeatService } from '../services/heartbeat.js';
import { resolveReviewGates } from '../services/human-review.js';
import { acquireDrive, releaseDrive } from '../services/pipeline/scheduler.js';
import { TelegramBridge } from '../bridges/telegram.js';
import { DiscordBridge } from '../bridges/discord.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phase 7: heartbeat (+ autonomous-mode wiring) and Phase 8: Telegram/Discord
 * bridges. Kept in one module because the `commandHandlers` built for the
 * heartbeat's autonomous step-runner is also handed to the Telegram bridge.
 */
export async function initHeartbeatAndBridges(gw: BookClawGateway): Promise<void> {
  // ── Phase 7: Heartbeat ──
  gw.heartbeat = new HeartbeatService(gw.config.get('heartbeat'), gw.memory);

  // Wire autonomous mode — heartbeat can now trigger project steps on a schedule
  const commandHandlers = gw.buildTelegramCommandHandlers();
  gw.heartbeat.setAutonomous(
    // Run one project step (reuses the same logic as Telegram /project command)
    async (projectId: string) => commandHandlers.startAndRunProject(projectId),
    // List projects with remaining step counts. Sequence phase-ordering gate
    // (config-not-code pipelines): drop a pending phase whose earlier sequence
    // phases haven't completed, so autonomous mode never runs a later phase ahead
    // of an unfinished earlier one. Active (already-running) projects always pass.
    () => gw.projectEngine.listProjects()
      .filter(g => g.status !== 'pending' || gw.projectEngine.sequencePredecessorsComplete(g))
      .map(g => ({
        id: g.id,
        title: g.title,
        status: g.status,
        progress: `${g.progress}%`,
        progressNum: g.progress,
        stepsRemaining: g.steps.filter(s => s.status === 'pending' || s.status === 'active').length,
        type: g.type,
      })),
    // Broadcast status to dashboard (WebSocket) and Telegram
    (message: string) => {
      gw.io.emit('autonomous-status', { message, timestamp: new Date().toISOString() });
      if (gw.telegram) {
        gw.telegram.broadcastToAllowed?.(message);
      }
    },
    // Self-improvement analysis callback
    async (projectId: string) => {
      const project = gw.projectEngine.getProject(projectId);
      if (!project) return null;

      // Read the last completed step results for analysis
      const completedSteps = project.steps
        .filter((s: any) => s.status === 'completed' && s.result)
        .slice(-10);

      if (completedSteps.length === 0) return null;

      const sampleText = completedSteps
        .map((s: any) => `### ${s.label}\n${(s.result || '').substring(0, 1500)}`)
        .join('\n\n');

      try {
        const provider = gw.aiRouter.selectProvider('general');
        const result = await gw.aiRouter.complete({
          provider: provider.id,
          system: 'You are a writing coach analyzing completed manuscript output. Be specific and actionable.',
          messages: [{
            role: 'user' as const,
            content: `Analyze this writing from the completed project "${project.title}". Identify:\n\n` +
              `1. 3-5 actionable insights for improving future writing\n` +
              `2. 2-3 specific strengths to maintain\n` +
              `3. 2-3 specific weaknesses to address\n\n` +
              `Return ONLY valid JSON: {"insights":["..."],"strengths":["..."],"weaknesses":["..."]}\n\n` +
              `Writing samples:\n\n${sampleText}`,
          }],
        });

        // Parse AI response
        const cleaned = result.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
        const parsed = JSON.parse(cleaned);

        // Save to self-improve log
        const workspaceDir = join(ROOT_DIR, 'workspace');
        const agentDir = join(workspaceDir, '.agent');
        await fs.mkdir(agentDir, { recursive: true });
        const logPath = join(agentDir, 'self-improve-log.json');
        let log: any[] = [];
        try {
          if (existsSync(logPath)) {
            log = JSON.parse(await fs.readFile(logPath, 'utf-8'));
          }
        } catch { /* start fresh */ }

        log.push({
          projectId,
          projectTitle: project.title,
          timestamp: new Date().toISOString(),
          ...parsed,
        });

        // Keep last 50 entries
        if (log.length > 50) log = log.slice(-50);
        await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf-8');

        gw.activityLog.log({
          type: 'system',
          source: 'internal',
          goalId: projectId,
          message: `Self-improvement analysis saved: ${parsed.insights?.length || 0} insights`,
          metadata: { insights: parsed.insights?.length, strengths: parsed.strengths?.length },
        });

        // ── Core Lessons Consolidation ──
        // Every 5 entries, distill ALL insights into a persistent "Core Lessons" file.
        // This prevents old improvements from being forgotten as new ones are added.
        // Core Lessons get injected into future project system prompts.
        if (log.length % 5 === 0 && log.length >= 5) {
          try {
            const allInsights = log.flatMap((l: any) => l.insights || []);
            const allStrengths = log.flatMap((l: any) => l.strengths || []);
            const allWeaknesses = log.flatMap((l: any) => l.weaknesses || []);

            const consolidateResult = await gw.aiRouter.complete({
              provider: provider.id,
              system: 'You are a writing coach creating a persistent learning document. Distill patterns from many observations into timeless, actionable principles. Remove duplicates. Keep the most important lessons. Be concise — each lesson should be 1-2 sentences max.',
              messages: [{
                role: 'user' as const,
                content: `Consolidate these observations from ${log.length} completed writing projects into Core Lessons.\n\n` +
                  `ALL INSIGHTS:\n${allInsights.map((i: string, n: number) => `${n + 1}. ${i}`).join('\n')}\n\n` +
                  `ALL STRENGTHS:\n${allStrengths.map((s: string, n: number) => `${n + 1}. ${s}`).join('\n')}\n\n` +
                  `ALL WEAKNESSES:\n${allWeaknesses.map((w: string, n: number) => `${n + 1}. ${w}`).join('\n')}\n\n` +
                  `Create a concise Core Lessons document with these sections:\n` +
                  `1. TOP PRINCIPLES (5-7 most important writing lessons learned)\n` +
                  `2. PROVEN STRENGTHS (3-5 things to keep doing)\n` +
                  `3. RECURRING WEAKNESSES (3-5 things to actively avoid)\n` +
                  `4. STYLE NOTES (any consistent voice/style observations)\n\n` +
                  `Write in second person ("You tend to..." / "Your strength is..."). Be specific and actionable. Max 500 words total.`,
              }],
            });

            const coreLessonsPath = join(agentDir, 'core-lessons.md');
            const coreLessonsContent = `# BookClaw Core Lessons\n\n` +
              `*Auto-consolidated from ${log.length} project analyses on ${new Date().toISOString().split('T')[0]}*\n\n` +
              consolidateResult.text;
            await fs.writeFile(coreLessonsPath, coreLessonsContent, 'utf-8');
            console.log(`  🧠 Core Lessons consolidated from ${log.length} analyses`);
          } catch (consolidateErr) {
            console.log(`  ⚠ Core Lessons consolidation failed: ${consolidateErr}`);
          }
        }

        return parsed;
      } catch {
        return null;
      }
    },
    // Follow-up project creation for completed novel pipelines
    async (originalProjectId: string, originalTitle: string, originalType: string) => {
      if (originalType !== 'novel-pipeline') return null;

      const followUpTitle = `Polish & Publish: ${originalTitle}`;
      const followUpDesc = `Follow-up tasks after completing the first draft of "${originalTitle}". ` +
        `Prepare for beta readers, write query letter, create synopsis.`;

      const project = gw.projectEngine.createProjectResolved('book-launch', followUpTitle, followUpDesc, {
        parentProjectId: originalProjectId,
        parentTitle: originalTitle,
        autoCreated: true,
      });

      gw.activityLog.log({
        type: 'project_created',
        source: 'internal',
        goalId: project.id,
        message: `Auto-created follow-up project: "${followUpTitle}"`,
        metadata: { parentProjectId: originalProjectId, steps: project.steps.length },
      });

      return project.id;
    },
    // Idle task: run configurable author-focused tasks when no projects are active
    // Loads tasks from workspace/.config/idle-tasks.json (user-editable via dashboard)
    async () => {
      // Load tasks from config file, falling back to defaults
      const idleConfigPath = join(ROOT_DIR, 'workspace', '.config', 'idle-tasks.json');
      let idleTasks: Array<{ label: string; prompt: string; enabled?: boolean }> = [];
      try {
        if ((await import('fs')).existsSync(idleConfigPath)) {
          const raw = await fs.readFile(idleConfigPath, 'utf-8');
          const parsed = JSON.parse(raw);
          idleTasks = (parsed.tasks || []).filter((t: any) => t.enabled !== false);
        }
      } catch { /* fall through to defaults */ }

      if (idleTasks.length === 0) {
        idleTasks = (await import('../services/idle-tasks-defaults.js')).DEFAULT_IDLE_TASKS;
        // Save defaults on first run
        try {
          const configDir = join(ROOT_DIR, 'workspace', '.config');
          await fs.mkdir(configDir, { recursive: true });
          await fs.writeFile(idleConfigPath, JSON.stringify({ tasks: idleTasks }, null, 2), 'utf-8');
        } catch { /* non-fatal */ }
      }

      if (idleTasks.length === 0) return null;

      // Pick a random task
      const task = idleTasks[Math.floor(Math.random() * idleTasks.length)];

      try {
        const provider = gw.aiRouter.selectProvider('general');
        const result = await gw.aiRouter.complete({
          provider: provider.id,
          system: 'You are BookClaw, an AI writing agent for authors. Be detailed, actionable, and expert-level.',
          messages: [{ role: 'user' as const, content: task.prompt }],
          maxTokens: 2000,
        });

        if (result.text && result.text.length > 20) {
          // Save to workspace
          const idleDir = join(ROOT_DIR, 'workspace', '.agent');
          await fs.mkdir(idleDir, { recursive: true });
          const dateStr = new Date().toISOString().split('T')[0];
          await fs.writeFile(
            join(idleDir, `idle-${dateStr}.md`),
            `# ${task.label}\n*Generated ${new Date().toISOString()}*\n\n${result.text}`,
            'utf-8'
          );

          gw.activityLog.log({
            type: 'system',
            source: 'internal',
            message: `Idle task: ${task.label}`,
            metadata: { taskType: task.label },
          });

          return `${task.label}: ${result.text.substring(0, 200)}`;
        }
        return null;
      } catch {
        return null;
      }
    }
  );

  gw.heartbeat.start();

  // Human Review resolver + driver sweep. Resolves approved/rejected/expired
  // gates, then — when the autonomous heartbeat is NOT actively driving (it would
  // otherwise pick up resumed projects itself, and double-driving would race) —
  // re-drives each resumed pipeline forward to its next gate / error / end. This
  // makes an approved gate continue even on a dashboard-only (non-autonomous)
  // deployment. Runs regardless of mode; fail-soft.
  const driveProject = async (projectId: string) => {
    // Claim a drive slot: the shared per-project lock so this resolver/headless
    // driver never runs the same project concurrently with a browser
    // /auto-execute (or /execute) run — two runners on the same active step
    // duplicate/overwrite chapters + double AI cost (bug-review #2) — PLUS the
    // Flagship Plan 6 global concurrency cap. Skip entirely if the project is
    // already driven; queue (this is a background sweep, not an HTTP request,
    // so blocking here is safe) if the cap is reached.
    if (!(await acquireDrive(gw.driveScheduler, gw.projectEngine, projectId))) return;
    try {
      for (let i = 0; i < 500; i++) {
        const p = gw.projectEngine.getProject(projectId);
        if (!p || p.status !== 'active' || !p.steps.some((s: any) => s.status === 'active')) break;
        const r = await commandHandlers.startAndRunProject(projectId);
        if (r && 'error' in r) break; // next gate hit, error raised, or nothing runnable
      }
    } finally {
      releaseDrive(gw.driveScheduler, gw.projectEngine, projectId);
    }
  };
  setInterval(async () => {
    if (!gw.confirmationGate || !gw.projectEngine) return;
    try {
      const resumed = await resolveReviewGates({
        gate: gw.confirmationGate, engine: gw.projectEngine,
        // H1 fix: a cadence-gate chapter approved through the generic
        // Confirmations UI resumes here, not through /review/action — without
        // this, its summary/entity extraction (which the drive loops normally
        // run inline right after completeStep) would never run.
        contextExtraction: {
          contextEngine: gw.contextEngine,
          aiComplete: (r: any) => gw.aiRouter.complete(r),
          aiSelectProvider: (t: string) => gw.aiRouter.selectProvider(t),
        },
      });
      const auto = gw.heartbeat?.getAutonomousStatus?.();
      const heartbeatDriving = !!(auto?.enabled && !auto?.paused);
      if (resumed.length && !heartbeatDriving) {
        for (const id of resumed) await driveProject(id);
      }
    } catch (err) {
      console.error('[human-review] resolver sweep error:', err);
    }
  }, 60_000).unref();

  // B1 (run-review 2026-07-01): headless server-side phase driver. In the default
  // posture the ONLY thing that drives a phase-project's generation is a browser
  // (studio PipelineRail fires /auto-execute) or the autonomous heartbeat. With
  // neither, `advancePipeline` (the phase-06 completion hook) marks the next
  // phase-project `active` but nothing runs it, so a chained multi-phase novel run
  // orphans at every phase boundary when no tab is open (confirmed root cause of
  // the 663 stall). Opt-in via BOOKCLAW_HEADLESS_PIPELINE=1: when a phase-project
  // completes, drive the freshly-advanced next phase to its next gate / error /
  // end, server-side. Gated behind the flag so the cost-safe default (no AI spend
  // without a human present) is preserved, and skipped when the autonomous
  // heartbeat is already driving (it would otherwise double-drive + race).
  // Assumes headless use (no concurrent browser driver on the same pipeline).
  if (process.env.BOOKCLAW_HEADLESS_PIPELINE === '1') {
    gw.projectEngine.onProjectCompleted(async (project: any) => {
      if (!project?.pipelineId) return;
      const auto = gw.heartbeat?.getAutonomousStatus?.();
      if (auto?.enabled && !auto?.paused) return; // heartbeat already drives it
      // advancePipeline runs synchronously in the earlier-registered phase-06
      // completion hook, so the next phase is already `active` by the time this
      // fires. driveProject then drives it (and its completion chains onward).
      const next = gw.projectEngine.getPipelineProjects(project.pipelineId)
        .find((p: any) => p.status === 'active' && p.id !== project.id);
      if (next) await driveProject(next.id);
    });
    console.log('  ✓ Headless pipeline driver: ON (BOOKCLAW_HEADLESS_PIPELINE=1) — phases advance server-side with no browser open');
  }

  const autonomousLabel = gw.config.get('heartbeat.autonomousEnabled')
    ? ` + autonomous every ${gw.config.get('heartbeat.autonomousIntervalMinutes', 30)}min`
    : '';
  console.log(`  ✓ Heartbeat: every ${gw.config.get('heartbeat.intervalMinutes', 15)} minutes${autonomousLabel}`);

  // ── Phase 8: Bridges ──
  if (gw.config.get('bridges.telegram.enabled')) {
    const token = await gw.vault.get('telegram_bot_token');
    if (token) {
      gw.telegram = new TelegramBridge(token, gw.config.get('bridges.telegram'));
      gw.telegram.onMessage((content, channel, respond) =>
        gw.handleMessage(content, channel, respond)
      );
      gw.telegram.setCommandHandlers(commandHandlers);
      await gw.telegram.connect();
      console.log('  ✓ Telegram bridge connected (command center mode)');
    } else {
      console.log('  ⚠ Telegram enabled but no token in vault');
    }
  }

  if (gw.config.get('bridges.discord.enabled')) {
    const token = await gw.vault.get('discord_bot_token');
    if (token) {
      gw.discord = new DiscordBridge(token, gw.config.get('bridges.discord'));
      await gw.discord.connect();
      console.log('  ✓ Discord bridge connected');
    } else {
      console.log('  ⚠ Discord enabled but no token in vault');
    }
  }
}
