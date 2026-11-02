/**
 * Assistant Update Routes
 *
 * Stage 6 of ラピ's roadmap (#1119): changing a task's status, priority, theme
 * or due date, and arming auto-run for a theme. Each is one declared
 * capability that refuses to run unconfirmed, records its act, and can be
 * undone — the task change by writing back the values its audit row kept,
 * auto-run by stopping it (the existing stop control).
 *
 * `update-draft` only reads: it turns a sentence into a proposal card. What
 * gets written is the change the user confirmed, against the id on the card.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  assertCapabilityAllowed,
  recordAction,
  ConfirmationRequiredError,
  validateTaskChanges,
  applyTaskUpdate,
  revertTaskUpdate,
  proposeTaskUpdate,
  CANDIDATE_WINDOW,
  type AssistantCapabilityId,
  type FieldValues,
  type TaskUpdateDb,
} from '../../services/assistant';
import { MAX_TEXT_LENGTH } from './assistant-intake.routes';

const logger = createLogger('assistant-update');
const db = prisma as unknown as TaskUpdateDb;

/** Refuse an unconfirmed write, recording the refusal. Returns true when refused. */
async function refuseUnconfirmed(
  id: AssistantCapabilityId,
  confirmed: boolean,
  args: unknown,
): Promise<boolean> {
  try {
    assertCapabilityAllowed(id, { confirmed });
    return false;
  } catch (err) {
    if (!(err instanceof ConfirmationRequiredError)) throw err;
    await recordAction({ capabilityId: id, status: 'refused', args, errorMessage: err.message });
    return true;
  }
}

export const assistantUpdateRoutes = new Elysia({ prefix: '/assistant' })
  .post(
    '/update-draft',
    async ({ body }) => {
      // Same bounded, recently-touched window as the delete proposal: a
      // prompt that cannot hold the backlog would silently drop part of it.
      const tasks = await prisma.task.findMany({
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_WINDOW,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          themeId: true,
          dueDate: true,
        },
      });
      const proposal = await proposeTaskUpdate(body.text, tasks);
      await recordAction({
        capabilityId: 'task.update-draft',
        status: 'proposed',
        args: { text: body.text },
        result: proposal,
      });
      return { success: true, proposal, considered: tasks.length };
    },
    { body: t.Object({ text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }) }) },
  )

  .post(
    '/task-update',
    async ({ body, set }) => {
      if (await refuseUnconfirmed('task.update', body.confirmed, body)) {
        set.status = 400;
        return { success: false, error: 'confirmation_required' };
      }
      const checked = validateTaskChanges(body.changes);
      if (!checked.ok) {
        set.status = 400;
        return { success: false, error: checked.error };
      }
      const applied = await applyTaskUpdate(db, body.taskId, checked.changes);
      if (!applied.ok) {
        await recordAction({
          capabilityId: 'task.update',
          status: 'refused',
          args: body,
          taskId: body.taskId,
          errorMessage: applied.reason,
        });
        set.status = applied.reason === 'not_found' ? 404 : 409;
        return { success: false, error: applied.reason };
      }
      const actionId = await recordAction({
        capabilityId: 'task.update',
        status: 'executed',
        args: { taskId: body.taskId, changes: checked.changes },
        taskId: body.taskId,
        // before/after is what /revert reads back — the undo's only source.
        result: { before: applied.before, after: applied.after },
      });
      return { success: true, actionId, before: applied.before, after: applied.after };
    },
    {
      body: t.Object({
        taskId: t.Number(),
        confirmed: t.Boolean(),
        changes: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  .post(
    '/task-update/revert',
    async ({ body, set }) => {
      const action = await prisma.assistantAction.findUnique({ where: { id: body.actionId } });
      const record = (() => {
        try {
          return JSON.parse(action?.resultJson ?? '') as {
            before: FieldValues;
            after: FieldValues;
          };
        } catch {
          return null;
        }
      })();
      if (
        !action ||
        action.capabilityId !== 'task.update' ||
        action.status !== 'executed' ||
        action.taskId == null ||
        !record?.after
      ) {
        set.status = 404;
        return { success: false, error: 'no_undoable_update' };
      }
      const reverted = await revertTaskUpdate(db, action.taskId, record);
      if (!reverted.ok) {
        set.status = reverted.reason === 'not_found' ? 404 : 409;
        return { success: false, error: reverted.reason, conflicts: reverted.conflicts ?? [] };
      }
      // An undo is itself a change; recorded with its own before/after so it,
      // too, can be undone.
      await recordAction({
        capabilityId: 'task.update',
        status: 'executed',
        args: { revertOf: body.actionId },
        taskId: action.taskId,
        result: { before: record.after, after: record.before },
      });
      return { success: true };
    },
    { body: t.Object({ actionId: t.Number() }) },
  )

  .post(
    '/autorun-start',
    async ({ body, set }) => {
      if (await refuseUnconfirmed('autorun.start', body.confirmed, body)) {
        set.status = 400;
        return { success: false, error: 'confirmation_required' };
      }
      const { startAutoRun } =
        await import('../../services/workflow/auto-run/theme-auto-run-mutations');
      try {
        const state = await startAutoRun(body.themeId);
        await recordAction({
          capabilityId: 'autorun.start',
          status: 'executed',
          args: { themeId: body.themeId },
          result: state,
        });
        return { success: true, autoRun: state };
      } catch (err) {
        logger.error({ err, themeId: body.themeId }, 'assistant auto-run start failed');
        await recordAction({
          capabilityId: 'autorun.start',
          status: 'failed',
          args: { themeId: body.themeId },
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        set.status = 500;
        return { success: false, error: 'start_failed' };
      }
    },
    { body: t.Object({ themeId: t.Number(), confirmed: t.Boolean() }) },
  );

export default assistantUpdateRoutes;
