/**
 * Assistant Companion Routes
 *
 * "伴走して" / "伴走をやめる" for a task ラピ did not create (companion design
 * 4.3, Q1). Tasks she creates are accompanied from the moment they exist; these
 * two let the user add or remove any other task. Each is a declared capability
 * that refuses to run unconfirmed and records its act in AssistantAction.
 *
 * The user's way in is the consultation: a sentence like "伴走して" goes to
 * `/draft`, which reads it (deterministically, `companion-intent.ts`) and the
 * task's row, and proposes starting or stopping. The card shows that proposal;
 * pressing it calls `/start` or `/stop` with `confirmed: true` — the same
 * draft → confirm → commit shape as task.update-draft / task.update.
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
  readCompanionState,
  detectCompanionRequest,
  type CompanionDb,
} from '../../services/companion';
import { MAX_TEXT_LENGTH } from './assistant-intake.routes';

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
  /**
   * Read a consultation sentence and propose starting or stopping.
   *
   * `matched: false` means the sentence is not such a request and the client
   * sends it on as an ordinary consultation. Without a taskId the client is
   * asked to pick one (`needsTask`). When the request cannot apply (already
   * accompanied, not accompanied, finished) it says why instead of a proposal.
   */
  .post(
    '/draft',
    async ({ body, set }) => {
      const action = detectCompanionRequest(body.text);
      if (!action) return { success: true, matched: false };
      if (body.taskId === undefined)
        return { success: true, matched: true, action, needsTask: true };

      const state = await readCompanionState(db, body.taskId);
      if (!state.ok) {
        set.status = 404;
        return { success: false, error: 'not_found' };
      }
      const unavailable =
        action === 'start'
          ? state.active
            ? 'already_active'
            : state.task.status === 'done'
              ? 'task_done'
              : null
          : state.active
            ? null
            : 'not_active';
      await recordAction({
        capabilityId: 'companion.draft',
        status: unavailable ? 'refused' : 'proposed',
        args: { text: body.text, taskId: body.taskId },
        taskId: body.taskId,
        ...(unavailable
          ? { errorMessage: unavailable }
          : { result: { action, active: state.active } }),
      });
      return {
        success: true,
        matched: true,
        action,
        ...(unavailable ? { unavailable } : {}),
        proposal: {
          action,
          taskId: state.task.id,
          title: state.task.title,
          active: state.active,
          ...(state.companion
            ? {
                origin: state.companion.origin,
                ...(state.companion.startedAt
                  ? { startedAt: new Date(state.companion.startedAt).toISOString() }
                  : {}),
              }
            : {}),
        },
      };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
        taskId: t.Optional(t.Number()),
      }),
    },
  )

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
