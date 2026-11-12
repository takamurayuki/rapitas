/**
 * Assistant Criteria Routes
 *
 * Stage 2 of the companion design (段E, 4.2, 4.5): ラピ proposing a change to
 * an existing task's completion criteria, the user confirming it, and undoing
 * it. Draft → confirm → write, like task.update:
 *  - POST /assistant/criteria-draft          (task.criteria-draft, reads only)
 *  - POST /assistant/task-criteria           (task.criteria-update, confirmed)
 *  - POST /assistant/task-criteria/revert    (undo of task.criteria-update)
 *
 * Every write goes through writeTaskCriteria with the revision the card was
 * built on, so a stale card, a review in progress, a held review, a pending
 * verdict or a done task all come back as 409 with the code saying which.
 * Not responsible for the criteria wording review (criteria.review).
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  assertCapabilityAllowed,
  recordAction,
  ConfirmationRequiredError,
} from '../../services/assistant';
import {
  writeTaskCriteria,
  criteriaFreezeReason,
  type CriteriaWriteDb,
  type CriteriaPatch,
} from '../../services/task/task-criteria-write';
import {
  computeCriteriaRevision,
  criteriaListsOf,
  revisionOfLists,
  type CriteriaLists,
} from '../../services/task/task-criteria-revision';
import { CRITERIA_REFUSAL_MESSAGES } from '../../services/task/task-criteria-messages';

const db = prisma as unknown as CriteriaWriteDb;

/** Who confirmed a ラピ criteria change, as recorded (single-user app: the user on the card). */
const CONFIRMED_BY = 'user';

/** Actor label on the acceptance_criteria_changed activity for ラピ's writes. */
const ASSISTANT_ACTOR = 'assistant:task.criteria-update (confirmed by user)';

const criteriaList = t.Array(t.String({ minLength: 1, maxLength: 2000 }), { maxItems: 50 });
const patchFields = {
  goals: t.Optional(criteriaList),
  constraints: t.Optional(criteriaList),
  acceptanceCriteria: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 2000 }), {
      minItems: 1,
      maxItems: 50,
    }),
  ),
  reason: t.String({ minLength: 1, maxLength: 1000 }),
};

/** One list's change, for the card. */
interface ListDiff {
  added: string[];
  removed: string[];
}

function diffList(before: string[], after: string[]): ListDiff {
  return {
    added: after.filter((x) => !before.includes(x)),
    removed: before.filter((x) => !after.includes(x)),
  };
}

function patchOf(body: {
  goals?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
}): CriteriaPatch | null {
  const patch: CriteriaPatch = {};
  if (body.goals) patch.goals = body.goals;
  if (body.constraints) patch.constraints = body.constraints;
  if (body.acceptanceCriteria) patch.acceptanceCriteria = body.acceptanceCriteria;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The record /revert reads back — the undo's only source. */
interface CriteriaChangeRecord {
  before: CriteriaLists;
  after: CriteriaLists;
  previousRevision: string;
  revision: string;
  reason: string;
  confirmedBy: string;
}

export const assistantCriteriaRoutes = new Elysia({ prefix: '/assistant' })
  .post(
    '/criteria-draft',
    async ({ body, set }) => {
      const row = await prisma.task.findUnique({
        where: { id: body.taskId },
        select: {
          id: true,
          title: true,
          goals: true,
          constraints: true,
          acceptanceCriteria: true,
          status: true,
          workflowStatus: true,
          haltReason: true,
          juryRunId: true,
        },
      });
      if (!row) {
        set.status = 404;
        return { success: false, error: 'not_found' };
      }
      const patch = patchOf(body);
      if (!patch) {
        set.status = 400;
        return { success: false, error: 'nothing to change' };
      }
      const before = criteriaListsOf(row);
      const after: CriteriaLists = { ...before, ...patch };
      const blockedBy = criteriaFreezeReason(row);
      const draft = {
        taskId: row.id,
        title: row.title,
        // The card sends this back on confirm; a different current revision = 409.
        criteriaRevision: computeCriteriaRevision(row),
        proposedRevision: revisionOfLists(after),
        before,
        after,
        diff: {
          goals: diffList(before.goals, after.goals),
          constraints: diffList(before.constraints, after.constraints),
          acceptanceCriteria: diffList(before.acceptanceCriteria, after.acceptanceCriteria),
        },
        reason: body.reason,
        // Shown on the card up front ("終わってから変えましょう"); the write re-checks.
        blockedBy,
        ...(blockedBy ? { blockedMessage: CRITERIA_REFUSAL_MESSAGES[blockedBy] } : {}),
      };
      await recordAction({
        capabilityId: 'task.criteria-draft',
        status: 'proposed',
        args: body,
        taskId: row.id,
        result: draft,
      });
      return { success: true, draft };
    },
    { body: t.Object({ taskId: t.Number(), ...patchFields }) },
  )

  .post(
    '/task-criteria',
    async ({ body, set }) => {
      try {
        assertCapabilityAllowed('task.criteria-update', { confirmed: body.confirmed });
      } catch (err) {
        if (!(err instanceof ConfirmationRequiredError)) throw err;
        await recordAction({
          capabilityId: 'task.criteria-update',
          status: 'refused',
          args: body,
          taskId: body.taskId,
          errorMessage: err.message,
        });
        set.status = 400;
        return { success: false, error: 'confirmation_required' };
      }
      const patch = patchOf(body);
      if (!patch) {
        set.status = 400;
        return { success: false, error: 'nothing to change' };
      }
      const written = await writeTaskCriteria(db, {
        taskId: body.taskId,
        next: patch,
        expectedCriteriaRevision: body.expectedCriteriaRevision,
        actor: ASSISTANT_ACTOR,
        reason: body.reason,
      });
      if (!written.ok) {
        await recordAction({
          capabilityId: 'task.criteria-update',
          status: 'refused',
          args: body,
          taskId: body.taskId,
          errorMessage: written.reason,
        });
        set.status = written.reason === 'not_found' ? 404 : 409;
        return {
          success: false,
          error: written.reason,
          ...(written.reason !== 'not_found'
            ? { message: CRITERIA_REFUSAL_MESSAGES[written.reason] }
            : {}),
          currentRevision: written.currentRevision,
        };
      }
      if (!written.changed) {
        set.status = 409;
        return { success: false, error: 'no_change', currentRevision: written.revision };
      }
      const record: CriteriaChangeRecord = {
        before: written.before,
        after: written.after,
        previousRevision: written.previousRevision,
        revision: written.revision,
        reason: body.reason,
        confirmedBy: CONFIRMED_BY,
      };
      const actionId = await recordAction({
        capabilityId: 'task.criteria-update',
        status: 'executed',
        args: { taskId: body.taskId, ...patch, reason: body.reason },
        taskId: body.taskId,
        result: record,
      });
      return { success: true, actionId, ...record };
    },
    {
      body: t.Object({
        taskId: t.Number(),
        confirmed: t.Boolean(),
        expectedCriteriaRevision: t.String({ minLength: 1, maxLength: 128 }),
        ...patchFields,
      }),
    },
  )

  .post(
    '/task-criteria/revert',
    async ({ body, set }) => {
      const action = await prisma.assistantAction.findUnique({ where: { id: body.actionId } });
      const record = (() => {
        try {
          return JSON.parse(action?.resultJson ?? '') as CriteriaChangeRecord;
        } catch {
          return null;
        }
      })();
      if (
        !action ||
        action.capabilityId !== 'task.criteria-update' ||
        action.status !== 'executed' ||
        action.taskId == null ||
        !record?.before ||
        typeof record.revision !== 'string'
      ) {
        set.status = 404;
        return { success: false, error: 'no_undoable_criteria_change' };
      }
      // "Undo only if nobody touched it since" = the current revision is the
      // one this change wrote (design 4.5, like revertTaskUpdate).
      const written = await writeTaskCriteria(db, {
        taskId: action.taskId,
        next: record.before,
        expectedCriteriaRevision: record.revision,
        actor: ASSISTANT_ACTOR,
        reason: `取り消し（操作 #${body.actionId}）`,
      });
      if (!written.ok) {
        await recordAction({
          capabilityId: 'task.criteria-update',
          status: 'refused',
          args: { revertOf: body.actionId },
          taskId: action.taskId,
          errorMessage: written.reason,
        });
        set.status = written.reason === 'not_found' ? 404 : 409;
        return {
          success: false,
          error: written.reason,
          ...(written.reason !== 'not_found'
            ? { message: CRITERIA_REFUSAL_MESSAGES[written.reason] }
            : {}),
          currentRevision: written.currentRevision,
        };
      }
      // An undo is itself a change, recorded so it, too, can be undone.
      const undo: CriteriaChangeRecord = {
        before: written.before,
        after: written.after,
        previousRevision: written.previousRevision,
        revision: written.revision,
        reason: `取り消し（操作 #${body.actionId}）`,
        confirmedBy: CONFIRMED_BY,
      };
      const actionId = await recordAction({
        capabilityId: 'task.criteria-update',
        status: 'executed',
        args: { revertOf: body.actionId },
        taskId: action.taskId,
        result: undo,
      });
      return { success: true, actionId, ...undo };
    },
    { body: t.Object({ actionId: t.Number() }) },
  );

export default assistantCriteriaRoutes;
