/**
 * Assistant Companion Routes
 *
 * "伴走して" / "伴走をやめる" for a task ラピ did not create (companion design
 * 4.3, Q1). Tasks she creates are accompanied from the moment they exist; these
 * two let the user add or remove any other task. Each is a declared capability
 * that refuses to run unconfirmed and records its act in AssistantAction.
 *
 * Not responsible for what accompanying means day to day (the digest is stage
 * 2) — only for the TaskCompanion row.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  assertCapabilityAllowed,
  recordAction,
  ConfirmationRequiredError,
  type AssistantCapabilityId,
} from '../../services/assistant';
import {
  startCompanion,
  stopCompanion,
  setCompanionSource,
  type CompanionDb,
} from '../../services/companion';

const logger = createLogger('assistant-companion');
const db = prisma as unknown as CompanionDb;

/** Refuse an unconfirmed write, recording the refusal. Returns true when refused. */
async function refuseUnconfirmed(
  id: AssistantCapabilityId,
  body: { taskId: number; confirmed: boolean },
): Promise<boolean> {
  try {
    assertCapabilityAllowed(id, { confirmed: body.confirmed });
    return false;
  } catch (err) {
    if (!(err instanceof ConfirmationRequiredError)) throw err;
    await recordAction({
      capabilityId: id,
      status: 'refused',
      args: body,
      taskId: body.taskId,
      errorMessage: err.message,
    });
    return true;
  }
}

const body = t.Object({ taskId: t.Number(), confirmed: t.Boolean() });

export const assistantCompanionRoutes = new Elysia({ prefix: '/assistant/companion' })
  .post(
    '/start',
    async ({ body, set }) => {
      if (await refuseUnconfirmed('companion.start', body)) {
        set.status = 400;
        return { success: false, error: 'confirmation_required' };
      }
      const result = await startCompanion(db, body.taskId);
      if (!result.ok) {
        await recordAction({
          capabilityId: 'companion.start',
          status: 'refused',
          args: body,
          taskId: body.taskId,
          errorMessage: result.reason,
        });
        set.status = result.reason === 'task_not_found' ? 404 : 409;
        return { success: false, error: result.reason };
      }
      const actionId = await recordAction({
        capabilityId: 'companion.start',
        status: 'executed',
        args: { taskId: body.taskId },
        taskId: body.taskId,
        result: { outcome: result.outcome, companionId: result.companion.id },
      });
      await setCompanionSource(db, body.taskId, actionId).catch((err: unknown) =>
        logger.warn({ err, taskId: body.taskId }, 'companion source link failed'),
      );
      return { success: true, outcome: result.outcome, actionId };
    },
    { body },
  )

  .post(
    '/stop',
    async ({ body, set }) => {
      if (await refuseUnconfirmed('companion.stop', body)) {
        set.status = 400;
        return { success: false, error: 'confirmation_required' };
      }
      const result = await stopCompanion(db, body.taskId);
      if (!result.ok) {
        await recordAction({
          capabilityId: 'companion.stop',
          status: 'refused',
          args: body,
          taskId: body.taskId,
          errorMessage: result.reason,
        });
        set.status = 409;
        return { success: false, error: result.reason };
      }
      const actionId = await recordAction({
        capabilityId: 'companion.stop',
        status: 'executed',
        args: { taskId: body.taskId },
        taskId: body.taskId,
        // before/after in the shape task.update keeps, for a later undo.
        result: { before: { closedAt: null }, after: { closedAt: result.closedAt.toISOString() } },
      });
      return { success: true, actionId, closedAt: result.closedAt.toISOString() };
    },
    { body },
  );

export default assistantCompanionRoutes;
