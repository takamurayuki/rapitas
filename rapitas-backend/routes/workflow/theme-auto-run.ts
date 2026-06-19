/**
 * theme-auto-run
 *
 * HTTP routes for per-theme auto-execution control.
 *
 * POST /themes/:id/auto-run  { action: 'start' | 'pause' | 'stop', order?: 'priority' | 'created' }
 * GET  /themes/:id/auto-run  → ThemeAutoRunState
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import {
  getOrCreateAutoRun,
  startAutoRun,
  pauseAutoRun,
  stopAutoRun,
} from '../../services/workflow/auto-run/theme-auto-run-service';
import { ThemeAutoRunScheduler } from '../../services/workflow/auto-run/theme-auto-run-scheduler';

const log = createLogger('routes:theme-auto-run');

export const themeAutoRunRoutes = new Elysia()

  /**
   * GET /themes/:id/auto-run — return the current auto-run state for a theme.
   */
  .get('/themes/:id/auto-run', async (context) => {
    const themeId = parseInt((context.params as { id: string }).id);
    if (!Number.isFinite(themeId)) {
      context.set.status = 400;
      return { success: false, error: 'Invalid theme ID' };
    }

    try {
      const state = await getOrCreateAutoRun(themeId);

      // Enrich with current task info if one is active
      let currentTask = null;
      if (state.currentTaskId) {
        currentTask = await prisma.task.findUnique({
          where: { id: state.currentTaskId },
          select: { id: true, title: true, status: true, workflowStatus: true },
        });
      }

      // Count remaining eligible tasks for this theme
      const remainingCount = await prisma.task.count({
        where: {
          themeId,
          status: { in: ['todo', 'in-progress'] },
          workflowStatus: { notIn: ['completed', 'verify_done'] },
          parentId: null,
        },
      });

      return {
        success: true,
        autoRun: state,
        currentTask,
        remainingCount,
      };
    } catch (err) {
      log.error({ err, themeId }, '[theme-auto-run] Failed to get state');
      context.set.status = 500;
      return { success: false, error: 'Failed to retrieve auto-run state' };
    }
  })

  /**
   * POST /themes/:id/auto-run — control auto-run (start / pause / stop).
   */
  .post('/themes/:id/auto-run', async (context) => {
    const themeId = parseInt((context.params as { id: string }).id);
    if (!Number.isFinite(themeId)) {
      context.set.status = 400;
      return { success: false, error: 'Invalid theme ID' };
    }

    const body = context.body as { action?: string; order?: string } | null;
    const action = body?.action;
    const order = (body?.order === 'created' ? 'created' : 'priority') as 'priority' | 'created';

    if (!['start', 'pause', 'stop'].includes(action ?? '')) {
      context.set.status = 400;
      return { success: false, error: 'action must be one of: start, pause, stop' };
    }

    // Verify the theme exists and is a development theme
    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
      select: { id: true, isDevelopment: true, workingDirectory: true },
    });
    if (!theme) {
      context.set.status = 404;
      return { success: false, error: 'Theme not found' };
    }
    if (!theme.isDevelopment || !theme.workingDirectory) {
      context.set.status = 400;
      return {
        success: false,
        error: '自動実行は開発モードで作業ディレクトリが設定されたテーマのみ利用できます。',
      };
    }

    const scheduler = ThemeAutoRunScheduler.getInstance();

    try {
      let state;
      if (action === 'start') {
        state = await startAutoRun(themeId, order);
        scheduler.start();
        log.info(`[theme-auto-run] Started auto-run for theme ${themeId}`);
      } else if (action === 'pause') {
        state = await pauseAutoRun(themeId);
        log.info(`[theme-auto-run] Paused auto-run for theme ${themeId}`);
      } else {
        // stop
        state = await stopAutoRun(themeId);
        log.info(`[theme-auto-run] Stop requested for theme ${themeId}`);
        // Immediately kill the in-flight agent the SAME way the (reliable)
        // task-detail stop does — stopTaskAgents — instead of only flipping the
        // state to 'stopping' and waiting for the scheduler's next tick to call
        // stopThemeExecution. That tick delay is why the agent sometimes keeps
        // running after the user presses the auto-run stop button. Idempotent, so
        // the scheduler's later cleanup pass is harmless.
        const runningTaskId = state.currentTaskId;
        if (runningTaskId) {
          const { stopTaskAgents } = await import('../../services/agents/stop-task-agents');
          await stopTaskAgents(runningTaskId, {
            errorMessage: 'Cancelled by user (auto-run stop)',
          }).catch((err) =>
            log.error(
              { err, themeId, taskId: runningTaskId },
              '[theme-auto-run] Failed to stop in-flight agent on stop',
            ),
          );
          log.info(
            `[theme-auto-run] Halted in-flight agent for task ${runningTaskId} (theme ${themeId})`,
          );
        }
      }

      return { success: true, autoRun: state };
    } catch (err) {
      log.error({ err, themeId, action }, '[theme-auto-run] Action failed');
      context.set.status = 500;
      return { success: false, error: 'Auto-run action failed' };
    }
  });
