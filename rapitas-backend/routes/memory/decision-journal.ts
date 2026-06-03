/**
 * decision-journal routes
 *
 * HTTP API for the デシジョンジャーナル (Decision Journal). Records deliberate
 * decisions with predicted outcomes and confidence levels, then lets the user
 * review them against actual results to calibrate their judgment over time.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  createDecision,
  listDecisions,
  updateDecision,
  deleteDecision,
  getReviewDue,
  recordReview,
  getCalibrationStats,
  convertDecisionToTask,
  normalizeCalibration,
  normalizeStatus,
  type DecisionStatus,
  type CalibrationVerdict,
} from '../../services/memory/decision-journal-service';

const log = createLogger('routes:decision-journal');

export const decisionJournalRoutes = new Elysia()
  /** List decisions with optional filters and pagination. */
  .get(
    '/decision-journal',
    async ({ query }) => {
      const status = normalizeStatus(query.status) as DecisionStatus | 'all';
      const rawStatus = query.status === 'all' ? 'all' : status;
      const calibration = query.calibration
        ? (normalizeCalibration(query.calibration) as CalibrationVerdict)
        : undefined;
      const themeId = query.themeId ? parseInt(query.themeId) : undefined;
      const limit = query.limit ? parseInt(query.limit) : 20;
      const offset = query.offset ? parseInt(query.offset) : 0;
      return listDecisions({ status: rawStatus, calibration, themeId, limit, offset });
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        calibration: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  /** Decisions whose review date has arrived (today's review queue). */
  .get(
    '/decision-journal/review-due',
    async ({ query }) => {
      const limit = query.limit ? parseInt(query.limit) : 20;
      const entries = await getReviewDue(limit);
      return { decisions: entries };
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
    },
  )

  /** Calibration accuracy statistics. */
  .get('/decision-journal/stats', async () => getCalibrationStats())

  /** Create a new decision entry. */
  .post(
    '/decision-journal',
    async ({ body, set }) => {
      if (!body.decision?.trim() || !body.context?.trim() || !body.predictedOutcome?.trim()) {
        set.status = 400;
        return { error: '決定・背景・予想結果は必須です' };
      }
      try {
        const entry = await createDecision({
          decision: body.decision.trim(),
          context: body.context.trim(),
          rationale: body.rationale?.trim() || undefined,
          predictedOutcome: body.predictedOutcome.trim(),
          confidence: body.confidence ?? 0.5,
          reviewDate: body.reviewDate ? new Date(body.reviewDate) : undefined,
          themeId: body.themeId ?? undefined,
        });
        return { success: true, id: entry.id };
      } catch (err) {
        log.error({ err }, 'Failed to create decision');
        set.status = 500;
        return { error: '決定の登録に失敗しました' };
      }
    },
    {
      body: t.Object({
        decision: t.String({ minLength: 1 }),
        context: t.String({ minLength: 1 }),
        predictedOutcome: t.String({ minLength: 1 }),
        rationale: t.Optional(t.String()),
        confidence: t.Optional(t.Number()),
        reviewDate: t.Optional(t.String()),
        themeId: t.Optional(t.Number()),
      }),
    },
  )

  /** Update editable fields of a decision. */
  .patch(
    '/decision-journal/:id',
    async ({ params, body, set }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        set.status = 400;
        return { error: 'Invalid ID' };
      }

      const input: Parameters<typeof updateDecision>[1] = {};
      if (body.decision !== undefined) input.decision = body.decision;
      if (body.context !== undefined) input.context = body.context;
      if ('rationale' in body) input.rationale = body.rationale ?? null;
      if (body.predictedOutcome !== undefined) input.predictedOutcome = body.predictedOutcome;
      if (body.confidence !== undefined) input.confidence = body.confidence;
      if ('reviewDate' in body)
        input.reviewDate = body.reviewDate ? new Date(body.reviewDate) : null;
      if (body.status !== undefined) input.status = normalizeStatus(body.status);
      if ('themeId' in body) input.themeId = body.themeId ?? null;

      const ok = await updateDecision(id, input);
      if (!ok) {
        set.status = 404;
        return { error: '決定が見つかりません' };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        decision: t.Optional(t.String()),
        context: t.Optional(t.String()),
        rationale: t.Optional(t.Union([t.String(), t.Null()])),
        predictedOutcome: t.Optional(t.String()),
        confidence: t.Optional(t.Number()),
        reviewDate: t.Optional(t.Union([t.String(), t.Null()])),
        status: t.Optional(t.String()),
        themeId: t.Optional(t.Union([t.Number(), t.Null()])),
      }),
    },
  )

  /** Delete a decision entry. */
  .delete(
    '/decision-journal/:id',
    async ({ params, set }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        set.status = 400;
        return { error: 'Invalid ID' };
      }
      const ok = await deleteDecision(id);
      if (!ok) {
        set.status = 404;
        return { error: '決定が見つかりません' };
      }
      return { success: true };
    },
    { params: t.Object({ id: t.String() }) },
  )

  /** Record the actual outcome and calibration verdict at review time. */
  .post(
    '/decision-journal/:id/review',
    async ({ params, body, set }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        set.status = 400;
        return { error: 'Invalid ID' };
      }
      if (!body.actualOutcome?.trim()) {
        set.status = 400;
        return { error: '実際の結果は必須です' };
      }
      const ok = await recordReview(id, {
        actualOutcome: body.actualOutcome.trim(),
        calibration: normalizeCalibration(body.calibration),
      });
      if (!ok) {
        set.status = 404;
        return { error: '決定が見つかりません' };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        actualOutcome: t.String({ minLength: 1 }),
        calibration: t.String({ minLength: 1 }),
      }),
    },
  )

  /** Convert a decision into a dedicated follow-up task. */
  .post(
    '/decision-journal/:id/convert-to-task',
    async ({ params, set }) => {
      const id = parseInt(params.id);
      if (isNaN(id)) {
        set.status = 400;
        return { error: 'Invalid ID' };
      }
      try {
        const taskId = await convertDecisionToTask(id);
        if (taskId === null) {
          set.status = 404;
          return { error: '決定が見つかりません' };
        }
        return { success: true, taskId };
      } catch (err) {
        log.error({ err, id }, 'Failed to convert decision to task');
        set.status = 400;
        return { error: err instanceof Error ? err.message : 'タスク化に失敗しました' };
      }
    },
    { params: t.Object({ id: t.String() }) },
  );
