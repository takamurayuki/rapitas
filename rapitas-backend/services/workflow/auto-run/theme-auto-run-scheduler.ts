/**
 * theme-auto-run-scheduler
 *
 * Single global poller that drives per-theme task auto-execution.
 * Each tick (~12 s) it:
 *  1. Finds all running/stopping/paused ThemeAutoRun records.
 *  2. For stopping themes: cancels queue items and stops in-flight executions.
 *  3. For paused themes: checks whether a waiting_approval gate was resolved.
 *  4. For running themes: checks completion/failure of the current task,
 *     then enqueues the next eligible task.
 *
 * Execution is ALWAYS delegated to the existing WorkflowRunner via
 * WorkflowQueueService.enqueue() — the scheduler never spawns agents itself.
 * Global auto-run concurrency = AUTO_RUN_GLOBAL_MAX_CONCURRENCY (default 1).
 * This is a separate limit from WorkflowRunner.maxConcurrency (which governs
 * ALL queue items including subtasks).
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import {
  resolveTaskThemeId,
  resolveTaskWorkflowState,
  resolveTaskWorkingDirectory,
} from '../../task/task-resolver';
import { WorkflowQueueService } from '../workflow-queue';
import { WorkflowRunner } from '../workflow-runner';
import { AgentWorkerManager } from '../../agents/agent-worker-manager';
import { realtimeService } from '../../communication/realtime-service';
import { promoteBacklogForTheme, hasPromotableBacklog } from './backlog-task-promoter';
import { recordStartupCommit, maybeRestartForUpdate } from './dev-restart-on-dry';
import { logCycleEvent } from '../../observability';
import {
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  POLL_INTERVAL_MS,
  COOLDOWN_MS,
  MAX_TASK_WALL_MS,
  getGlobalAutoRunActiveCount,
  getThemeActiveQueueItems,
  hasItemAwaitingApproval,
  isAwaitingUserAnswer,
  selectNextTask,
} from './auto-run-selection';
import {
  findByStatuses,
  setCurrentTask,
  onTaskCompleted,
  onTaskFailed,
  onAwaitingPlanApproval,
  resumeAutoRun,
  finalizeStop,
  getAutoRunState,
  startAutoRun,
  type ThemeAutoRunState,
} from './theme-auto-run-service';
import {
  notifyAwaitingPlanApproval,
  notifyAwaitingUserAnswer,
  notifyTaskSkipped,
  notifyAllDone,
} from './auto-run-notifications';

const log = createLogger('theme-auto-run-scheduler');

export class ThemeAutoRunScheduler {
  private static instance: ThemeAutoRunScheduler;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private queue = WorkflowQueueService.getInstance();
  private agentWorkerManager = AgentWorkerManager.getInstance();

  static getInstance(): ThemeAutoRunScheduler {
    if (!ThemeAutoRunScheduler.instance) {
      ThemeAutoRunScheduler.instance = new ThemeAutoRunScheduler();
    }
    return ThemeAutoRunScheduler.instance;
  }

  /** Start the scheduler (idempotent). */
  start(): void {
    // CRITICAL: the WorkflowRunner is what actually DEQUEUES and executes queued
    // items (via advanceWorkflow → role agent). It is only auto-started by
    // AIOrchestra.enqueueTask — which this scheduler bypasses by enqueuing
    // through WorkflowQueueService directly. Without this, auto-run items sit at
    // 'queued' forever and never run (observed: tasks enqueued but no agent ran).
    // startProcessing() is idempotent, so calling it on every start() is safe.
    WorkflowRunner.getInstance().startProcessing();

    // Capture the commit this backend booted on so the optional dry-restart only
    // fires once new commits actually land (avoids restarting on every dry tick).
    void recordStartupCommit();

    if (this.running) return;
    this.running = true;
    this.tick();
    this.pollTimer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    log.info('[ThemeAutoRunScheduler] Started');
  }

  /** Stop the scheduler (does NOT stop in-flight tasks — use stopAutoRun() for that). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    log.info('[ThemeAutoRunScheduler] Stopped');
  }

  /**
   * Recover on server restart:
   *  - Any ThemeAutoRun still in 'running'/'paused' OR idle-but-ARMED
   *    (enabled:true) should resume — start the scheduler so its tick drives them.
   *  - 'stopping' records are cleaned up (the previous execution was killed by
   *    the restart; treat as idle).
   *
   * CRITICAL for the perpetual loop: an `all_done` theme parks at status:'idle'
   * with enabled:true (armed) waiting for processIdleThemes to auto-resume it when
   * work reappears. But processIdleThemes only runs while the scheduler is
   * TICKING. If recovery resumed only 'running'/'paused', ANY restart while a
   * theme was idle (including the self-deploy restart, which fires precisely at
   * the 0-agent all_done quiet point) would leave the scheduler stopped and the
   * loop permanently dead. Resuming on enabled:true closes that self-defeating gap.
   */
  async recoverOnStartup(): Promise<void> {
    // Clean up 'stopping' records left from a crash during stop
    await prisma.themeAutoRun.updateMany({
      where: { status: 'stopping' },
      data: { status: 'idle', enabled: false, currentTaskId: null },
    });

    const running = await findByStatuses(['running', 'paused']);
    const armed = await prisma.themeAutoRun
      .count({ where: { enabled: true, status: 'idle' } })
      .catch(() => 0);
    if (running.length > 0 || armed > 0) {
      log.info(
        `[ThemeAutoRunScheduler] Resuming after restart (running/paused=${running.length}, armed-idle=${armed})`,
      );
      this.start();
    }
  }

  /**
   * Hook: called when a plan is approved for a task.
   * If the task's theme was paused waiting for approval, resume it.
   *
   * @param taskId - The task whose plan was just approved / 承認されたタスクID
   */
  async onPlanApproved(taskId: number): Promise<void> {
    const task = await resolveTaskThemeId(taskId);
    if (!task?.themeId) return;

    const state = await getAutoRunState(task.themeId);
    if (state?.status === 'paused' && state.currentTaskId === taskId) {
      await resumeAutoRun(task.themeId);
      log.info(
        `[ThemeAutoRunScheduler] Theme ${task.themeId} resumed after plan approval for task ${taskId}`,
      );
      this.broadcastAutoRunUpdate(task.themeId);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal tick
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      // NOTE: Single query for all statuses; split in JS to avoid 4 DB roundtrips per tick.
      const allStates = await findByStatuses(['stopping', 'running', 'paused', 'idle']);
      const byStatus = (s: string) => allStates.filter((r) => r.status === s);

      await this.processStoppingThemes(byStatus('stopping'));
      await this.processRunningThemes(byStatus('running'));
      await this.processPausedThemes(byStatus('paused'));
      await this.processIdleThemes(byStatus('idle'));

      // Apply committed fixes during the brief 0-agent gap BETWEEN tasks. The
      // all_done branch alone (advanceTheme → maybeRestartForUpdate) missed this:
      // with auto-create refilling the queue the theme rarely reaches all_done,
      // and even then the just-finished agent's count still lagged > 0, so the
      // restart was skipped and fixes NEVER auto-deployed (observed: cycles=0
      // while monitoring). Poll it here instead — maybeRestartForUpdate restarts
      // ONLY when (a) no agent is executing (active==0 → a RUNNING agent is never
      // interrupted), (b) a theme is still enabled (a STOPPED system, enabled:0,
      // never self-reboots — the original reason this was removed is now covered
      // by that gate), (c) HEAD moved past the startup commit, and (d) the 10-min
      // rate limit allows it. That is exactly "apply when idle + something new,
      // without disturbing work".
      await maybeRestartForUpdate(0);
    } catch (err) {
      log.error({ err }, '[ThemeAutoRunScheduler] Tick error');
    }
  }

  /** Handle themes in 'stopping' status: cancel queue items and stop the agent. */
  private async processStoppingThemes(stopping: ThemeAutoRunState[]): Promise<void> {
    for (const state of stopping) {
      try {
        await this.stopThemeExecution(state.themeId, state.currentTaskId);
        await finalizeStop(state.themeId);
        this.broadcastAutoRunUpdate(state.themeId);
        log.info(`[ThemeAutoRunScheduler] Theme ${state.themeId} stopped`);
        logCycleEvent('theme.stopped', {
          theme: state.themeId,
          task: state.currentTaskId ?? undefined,
          msg: 'auto-run stopped by user',
        });
      } catch (err) {
        log.error({ err }, `[ThemeAutoRunScheduler] Error stopping theme ${state.themeId}`);
      }
    }
  }

  /**
   * Auto-resume themes that completed all work and went idle-but-ARMED
   * (enabled:true) once new work appears — a fresh todo task, or a backlog item
   * that can now be promoted (a backlog job added a concern/idea, or a freed cap
   * slot). This is what makes auto-run self-sustaining instead of dying at the
   * first dry. A USER stop leaves enabled:false and is never auto-resumed.
   */
  private async processIdleThemes(idle: ThemeAutoRunState[]): Promise<void> {
    for (const state of idle) {
      if (!state.enabled) continue; // user-stopped → stay stopped
      try {
        // Mirror selectNextTask's eligibility (parentId:null — the scheduler only
        // drives TOP-LEVEL tasks; subtasks are run by AIOrchestra). Counting
        // subtasks here let a stuck todo SUBTASK resume the theme, which then went
        // straight back to all_done because selection skips it — a 12s idle⇄running
        // flap that never made progress.
        const todo = await prisma.task
          .count({ where: { themeId: state.themeId, status: 'todo', parentId: null } })
          .catch(() => 0);
        const hasWork = todo > 0 || (await hasPromotableBacklog(state.themeId));
        if (!hasWork) continue;

        await startAutoRun(state.themeId);
        this.broadcastAutoRunUpdate(state.themeId);
        log.info(
          { themeId: state.themeId, todo },
          '[ThemeAutoRunScheduler] new work appeared — auto-resumed idle theme',
        );
        logCycleEvent('theme.resumed', {
          theme: state.themeId,
          todo,
          cause: todo > 0 ? 'new_todo' : 'backlog_promotable',
          msg: 'idle theme auto-resumed (new work appeared)',
        });
      } catch (err) {
        log.warn(
          { err, themeId: state.themeId },
          '[ThemeAutoRunScheduler] idle auto-resume failed',
        );
      }
    }
  }

  /** For paused themes, check whether approval was granted and auto-resume. */
  private async processPausedThemes(paused: ThemeAutoRunState[]): Promise<void> {
    for (const state of paused) {
      if (!state.currentTaskId) continue;
      try {
        // If the queue item is no longer 'waiting_approval' (e.g. user approved in UI)
        // AND the ThemeAutoRun was not already resumed by onPlanApproved(), resume now.
        const queueItems = await getThemeActiveQueueItems(prisma, state.themeId);
        const stillWaiting = hasItemAwaitingApproval(queueItems);

        // If queue item is gone (completed during pause) or re-queued after approval
        if (!stillWaiting) {
          const taskItem = await prisma.workflowQueueItem.findFirst({
            where: { taskId: state.currentTaskId, status: 'queued' },
          });
          if (taskItem) {
            // Plan was approved, item is back in queue — resume the theme
            await resumeAutoRun(state.themeId);
            this.broadcastAutoRunUpdate(state.themeId);
            log.info(
              `[ThemeAutoRunScheduler] Theme ${state.themeId} auto-resumed (plan approved detected)`,
            );
          }
        }
      } catch (err) {
        log.error(
          { err },
          `[ThemeAutoRunScheduler] Error processing paused theme ${state.themeId}`,
        );
      }
    }
  }

  /** Core logic: advance running themes to their next task. */
  private async processRunningThemes(running: ThemeAutoRunState[]): Promise<void> {
    if (running.length === 0) return;

    const globalActive = await getGlobalAutoRunActiveCount(prisma);

    for (const state of running) {
      try {
        await this.advanceTheme(
          state.themeId,
          state.currentTaskId,
          state.order,
          globalActive,
          state.lastRunAt,
        );
      } catch (err) {
        log.error({ err }, `[ThemeAutoRunScheduler] Error advancing theme ${state.themeId}`);
      }
    }
  }

  /**
   * Advance a single running theme by one step.
   *
   * @param themeId - Theme to advance / 進めるテーマID
   * @param currentTaskId - Currently tracked task (may be null) / 現在のタスクID
   * @param order - Task selection order / タスク選択順序
   * @param globalActive - Current global auto-run active count / グローバルアクティブ数
   */
  private async advanceTheme(
    themeId: number,
    currentTaskId: number | null,
    order: 'priority' | 'created',
    globalActive: number,
    lastRunAt: string | null,
  ): Promise<void> {
    if (currentTaskId) {
      // Hang backstop: never let a wedged run burn tokens indefinitely. If the
      // task has been the current task longer than MAX_TASK_WALL_MS, force-stop
      // it, mark it blocked (skip), and advance. This sits ABOVE WorkflowRunner's
      // per-phase timeout as a whole-task safety net (the user's "正常性確認").
      // EXEMPT a task that is waiting for the USER'S ANSWER: it burns no tokens,
      // and force-stopping it runs revertChanges — destroying the agent's
      // uncommitted work just because the user was away for 45 min.
      if (lastRunAt && Date.now() - new Date(lastRunAt).getTime() >= MAX_TASK_WALL_MS) {
        if (await isAwaitingUserAnswer(prisma, currentTaskId)) {
          await notifyAwaitingUserAnswer(themeId, currentTaskId);
          return;
        }
        log.warn(
          `[ThemeAutoRunScheduler] Task ${currentTaskId} exceeded wall budget (${Math.round(
            MAX_TASK_WALL_MS / 60000,
          )}min) — force-stopping (theme ${themeId})`,
        );
        logCycleEvent('task.hang_backstop', {
          theme: themeId,
          task: currentTaskId,
          ok: false,
          cause: 'wall_budget_exceeded',
          wallMinutes: Math.round(MAX_TASK_WALL_MS / 60000),
          msg: 'task force-stopped by hang backstop',
        });
        await this.stopThemeExecution(themeId, currentTaskId);
        await prisma.task
          .update({ where: { id: currentTaskId }, data: { status: 'blocked' } })
          .catch(() => {});
        await onTaskFailed(themeId, `Task ${currentTaskId} timed out (auto-run hang guard)`);
        this.broadcastAutoRunUpdate(themeId);
        await new Promise((r) => setTimeout(r, COOLDOWN_MS));
        await this.advanceTheme(themeId, null, order, Math.max(0, globalActive - 1), null);
        return;
      }

      // Active queue items (queued / running / waiting_approval) for this task.
      const queueItems = await getThemeActiveQueueItems(prisma, themeId);
      const currentItems = queueItems.filter((i) => i.taskId === currentTaskId);

      // While the task still has an ACTIVE item it is in flight: never move on.
      // This is the core "one task fully completes before the next starts"
      // guarantee — the only non-terminal exit here is the approval pause.
      if (currentItems.length > 0) {
        if (hasItemAwaitingApproval(currentItems)) {
          await onAwaitingPlanApproval(themeId);
          await notifyAwaitingPlanApproval(themeId, currentTaskId);
          this.broadcastAutoRunUpdate(themeId);
          logCycleEvent('task.awaiting_approval', {
            theme: themeId,
            task: currentTaskId,
            cause: 'plan_approval_gate',
            msg: 'theme paused — plan awaiting approval',
          });
        }
        // queued / running → still working; wait for the next tick.
        return;
      }

      // No active item. Decide the outcome from the most recent TERMINAL queue
      // item FIRST, then fall back to task.status. Checking the terminal item
      // unconditionally (not only when an active item exists) fixes the stall
      // where a queue item failed after max retries but task.status was left
      // 'in-progress' (WorkflowRunner only sets task.status for subtasks) — the
      // theme used to hang here until the 45-min wall backstop.
      const terminalItem = await prisma.workflowQueueItem.findFirst({
        where: {
          themeId,
          taskId: currentTaskId,
          status: { in: ['completed', 'failed', 'cancelled'] },
        },
        orderBy: { completedAt: 'desc' },
        select: { id: true, status: true, errorMessage: true },
      });

      const task = await resolveTaskWorkflowState(currentTaskId);

      const isCompleted =
        terminalItem?.status === 'completed' ||
        task?.status === 'done' ||
        task?.workflowStatus === 'completed';
      const isFailed =
        terminalItem?.status === 'failed' ||
        terminalItem?.status === 'cancelled' ||
        task?.status === 'failed' ||
        task?.status === 'blocked';

      if (isCompleted) {
        await onTaskCompleted(themeId);
        this.broadcastAutoRunUpdate(themeId);
        logCycleEvent('task.completed', {
          theme: themeId,
          task: currentTaskId,
          ok: true,
          via: terminalItem?.status === 'completed' ? 'queue_item' : 'task_status',
          msg: 'task completed — advancing to next',
        });
        await new Promise((r) => setTimeout(r, COOLDOWN_MS));
        await this.advanceTheme(themeId, null, order, Math.max(0, globalActive - 1), null);
        return;
      }

      if (isFailed) {
        // A task parked as 'blocked' may actually be WAITING FOR A USER ANSWER
        // (AskUserQuestion), not failed. Hold the theme here: advancing would
        // start the next task's agent, which then runs concurrently with this
        // task's answer-resume — the "multiple agents launched" symptom.
        if (task?.status === 'blocked' && (await isAwaitingUserAnswer(prisma, currentTaskId))) {
          log.info(
            `[ThemeAutoRunScheduler] Task ${currentTaskId} is awaiting a user answer — holding, not advancing (theme ${themeId})`,
          );
          await notifyAwaitingUserAnswer(themeId, currentTaskId);
          this.broadcastAutoRunUpdate(themeId);
          logCycleEvent('task.awaiting_answer', {
            theme: themeId,
            task: currentTaskId,
            cause: 'ask_user_question',
            msg: 'theme holding — task awaiting user answer',
          });
          return;
        }
        const errMsg = terminalItem?.errorMessage ?? `Task ${currentTaskId} failed or was blocked`;
        // Mark the task blocked so selection skips it next time.
        if (task?.status !== 'blocked') {
          await prisma.task
            .update({ where: { id: currentTaskId }, data: { status: 'blocked' } })
            .catch(() => {});
        }
        await onTaskFailed(themeId, errMsg);
        await notifyTaskSkipped(themeId, currentTaskId, errMsg);
        this.broadcastAutoRunUpdate(themeId);
        logCycleEvent('task.blocked', {
          theme: themeId,
          task: currentTaskId,
          ok: false,
          cause: terminalItem?.status ?? 'blocked',
          msg: errMsg.slice(0, 200),
        });
        await new Promise((r) => setTimeout(r, COOLDOWN_MS));
        await this.advanceTheme(themeId, null, order, Math.max(0, globalActive - 1), null);
        return;
      }

      // No active AND no terminal queue item, and the task is not terminal:
      // the item vanished (e.g. cleared) while the task is still mid-workflow.
      // Re-enqueue the SAME task so it resumes — never silently stall. The
      // WorkflowRunner picks up from the task's current workflowStatus.
      try {
        await this.queue.enqueue({ taskId: currentTaskId, themeId, priority: 50 });
        await setCurrentTask(themeId, currentTaskId);
        this.broadcastAutoRunUpdate(themeId);
        log.warn(
          `[ThemeAutoRunScheduler] Task ${currentTaskId} had no queue item; re-enqueued to resume (theme ${themeId})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 'already in the queue' means a race re-created it — fine, just wait.
        if (!msg.includes('already in the queue')) {
          log.error({ err }, `[ThemeAutoRunScheduler] Failed to re-enqueue task ${currentTaskId}`);
        }
      }
      return;
    }

    // No current task — select and enqueue the next one
    if (globalActive >= AUTO_RUN_GLOBAL_MAX_CONCURRENCY) {
      return; // global limit reached
    }

    const skipIds: number[] = [];
    // Get blocked task IDs to skip
    const blockedTasks = await prisma.task.findMany({
      where: { themeId, status: 'blocked' },
      select: { id: true },
    });
    skipIds.push(...blockedTasks.map((t) => t.id));

    // Self-deploy at the TASK BOUNDARY (event-driven). We reach here only between
    // tasks — the prior one finished and the next is not yet selected — so it is a
    // reliable 0-agent moment. The tick poll and the all_done branch both MISSED
    // continuous auto-run: with auto-create refilling the queue the theme rarely
    // reaches all_done, and the inter-task gap is shorter than the tick can sample
    // (observed: 0 restarts over 30 min while HEAD had moved). Firing it HERE
    // catches every task boundary. No-op unless HEAD moved + no live agents + not
    // rate-limited; if it restarts, the process exits and dev.js relaunches.
    if (await maybeRestartForUpdate(themeId)) return;

    const result = await selectNextTask(prisma, themeId, order, skipIds, globalActive);

    if (!result.found) {
      if (result.reason === 'all_done') {
        // Optional dev safety: when enabled, this quiet point (no live agents) is
        // the safe moment to restart and pick up committed fixes BEFORE creating
        // more tasks. Only fires when HEAD moved since boot + no agents anywhere +
        // not rate-limited; otherwise it's a no-op. If it restarts, stop here.
        if (await maybeRestartForUpdate(themeId)) return;

        // Before idling, refill from the backlog (open concerns first, then ideas
        // once concerns are clear) up to the per-theme cap, so a theme that ran
        // out of work keeps progressing. When tasks were created, stay active —
        // the next tick selects them.
        const created = await promoteBacklogForTheme(themeId).catch((err) => {
          log.warn({ err, themeId }, '[ThemeAutoRunScheduler] Backlog promotion failed');
          return 0;
        });
        if (created > 0) {
          log.info(
            `[ThemeAutoRunScheduler] Theme ${themeId} — promoted ${created} backlog task(s); staying active`,
          );
          logCycleEvent('backlog.refill', {
            theme: themeId,
            created,
            msg: 'refilled from backlog — staying active',
          });
          this.broadcastAutoRunUpdate(themeId);
          return;
        }
        // All tasks done and backlog empty/capped/disabled — go idle but stay
        // ARMED (enabled:true) so processIdleThemes auto-resumes when new work
        // appears (a backlog job adds a concern/idea, or a freed cap slot lets a
        // promotion happen). A USER stop sets enabled:false (finalizeStop) and is
        // therefore never auto-resumed. This closes the perpetual loop.
        await prisma.themeAutoRun.updateMany({
          where: { themeId },
          data: { status: 'idle', enabled: true, currentTaskId: null },
        });
        log.info(`[ThemeAutoRunScheduler] Theme ${themeId} — all tasks done, idle (armed)`);
        logCycleEvent('theme.idle', {
          theme: themeId,
          cause: 'all_done_backlog_empty',
          msg: 'all tasks done, idle but armed (awaiting new work)',
        });
        await notifyAllDone(themeId);
        this.broadcastAutoRunUpdate(themeId);
      }
      return;
    }

    const taskId = result.taskId;

    // A re-run (a 'todo' task whose workflowStatus is a stale terminal state from
    // a prior run) has no forward transition from verify_done/completed — reset
    // it to 'draft' so the workflow actually re-runs (research/plan are reused
    // via isReusableArtifact, so this is cheap). Without this the task would be
    // dequeued and immediately fail "cannot advance from verify_done".
    const picked = await prisma.task
      .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
      .catch(() => null);
    if (picked?.workflowStatus === 'verify_done' || picked?.workflowStatus === 'completed') {
      await prisma.task
        .update({ where: { id: taskId }, data: { workflowStatus: 'draft' } })
        .catch(() => {});
      log.info(
        `[ThemeAutoRunScheduler] Task ${taskId} re-run — reset stale workflowStatus ${picked.workflowStatus} → draft`,
      );
    }

    // Enqueue via WorkflowQueueService with themeId set
    try {
      await this.queue.enqueue({ taskId, themeId, priority: 50 });
      await setCurrentTask(themeId, taskId);
      this.broadcastAutoRunUpdate(themeId);
      log.info(`[ThemeAutoRunScheduler] Enqueued task ${taskId} for theme ${themeId}`);
      logCycleEvent('task.enqueued', {
        theme: themeId,
        task: taskId,
        msg: 'next task selected and enqueued',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already in the queue')) {
        // Race: already queued (e.g. by a previous tick that was slightly slow)
        // Set currentTaskId without re-enqueuing
        await setCurrentTask(themeId, taskId);
        log.warn(`[ThemeAutoRunScheduler] Task ${taskId} was already queued; tracking it`);
      } else {
        log.error({ err }, `[ThemeAutoRunScheduler] Failed to enqueue task ${taskId}`);
      }
    }
  }

  /**
   * Stop a theme's current execution: cancel queue items and kill the in-flight agent.
   *
   * @param themeId - Theme to stop / 停止するテーマID
   * @param currentTaskId - Currently tracked task ID / 現在のタスクID
   */
  private async stopThemeExecution(themeId: number, currentTaskId: number | null): Promise<void> {
    // Cancel all auto-run queue items for this theme
    await prisma.workflowQueueItem.updateMany({
      where: {
        themeId,
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
      data: { status: 'cancelled', completedAt: new Date(), errorMessage: 'Auto-run stopped' },
    });

    if (!currentTaskId) return;

    // Stop the agent execution(s) if any are running
    try {
      const task = await resolveTaskWorkingDirectory(currentTaskId);
      const workDir = task?.workingDirectory ?? task?.theme?.workingDirectory;

      // Kill ALL in-flight agents across the theme — the current task, its
      // subtasks, and any other theme task with a live execution (not just the
      // first found) — and release their locks. A split parent's subtask runs
      // under a different taskId, so a current-task-only stop would orphan it.
      const { stopThemeAgents } = await import('../../agents/stop-task-agents');
      await stopThemeAgents(themeId, currentTaskId, { errorMessage: 'Auto-run stopped' }).catch(
        (err) => {
          log.warn({ err, themeId }, '[ThemeAutoRunScheduler] stopThemeAgents failed');
        },
      );

      // Revert any uncommitted changes
      if (workDir) {
        await this.agentWorkerManager.revertChanges(workDir).catch((err) => {
          log.warn(
            { err },
            `[ThemeAutoRunScheduler] Failed to revert changes for theme ${themeId}`,
          );
        });
      }

      // Reset task to 'todo'
      await prisma.task
        .update({ where: { id: currentTaskId }, data: { status: 'todo' } })
        .catch(() => {});
    } catch (err) {
      log.error(
        { err },
        `[ThemeAutoRunScheduler] Error stopping execution for task ${currentTaskId}`,
      );
    }
  }

  /** Broadcast SSE update for a theme's auto-run state change. */
  private broadcastAutoRunUpdate(themeId: number): void {
    try {
      realtimeService.broadcast('orchestra', 'auto_run_update', {
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // SSE unavailable — non-fatal
    }
  }
}
