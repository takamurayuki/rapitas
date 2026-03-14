/**
 * Experiments API - 実験管理エンドポイント
 */

import { Elysia } from 'elysia';
import {
  createExperiment,
  updateExperiment,
  runResearch,
  getExperiment,
  listExperiments,
  getExperimentTimeline,
} from '../../services/self-learning';
import {
  createHypothesis,
  updateHypothesisStatus,
  reviseHypothesis,
  getHypotheses,
  rankHypotheses,
} from '../../services/self-learning';
import { performReview, getReviews } from '../../services/self-learning';
import { saveEpisode, summarizeExperiment } from '../../services/self-learning';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:experiments');

export const experimentsRoutes = new Elysia({ prefix: '/experiments' })
  // --- Experiment CRUD ---
  .get('/', async ({ query }) => {
    const page = query.page ? parseInt(query.page as string) : 1;
    const limit = query.limit ? parseInt(query.limit as string) : 20;
    const status = query.status as string | undefined;
    const taskId = query.taskId ? parseInt(query.taskId as string) : undefined;
    return listExperiments({ page, limit, status: status as any, taskId });
  })

  .get('/:id', async ({ params }) => {
    const experiment = await getExperiment(parseInt(params.id));
    if (!experiment) return { error: 'Experiment not found' };
    return experiment;
  })

  .post('/', async ({ body }) => {
    const { taskId, title, metadata } = body as any;
    return createExperiment({ taskId, title, metadata });
  })

  .put('/:id', async ({ params, body }) => {
    return updateExperiment(parseInt(params.id), body as any);
  })

  // --- Research ---
  .post('/:id/research', async ({ params, body }) => {
    const { query } = body as any;
    return runResearch(parseInt(params.id), query);
  })

  // --- Evaluate ---
  .post('/:id/evaluate', async ({ params, body }) => {
    return updateExperiment(parseInt(params.id), {
      evaluation: body as any,
      status: 'evaluating',
    });
  })

  // --- Timeline ---
  .get('/:id/timeline', async ({ params }) => {
    return getExperimentTimeline(parseInt(params.id));
  })

  // --- Summary ---
  .get('/:id/summary', async ({ params }) => {
    return summarizeExperiment(parseInt(params.id));
  })

  // --- Hypotheses ---
  .get('/:id/hypotheses', async ({ params }) => {
    return getHypotheses(parseInt(params.id));
  })

  .post('/:id/hypotheses', async ({ params, body }) => {
    const { content, reasoning, confidence, priority } = body as any;
    return createHypothesis({
      experimentId: parseInt(params.id),
      content,
      reasoning,
      confidence,
      priority,
    });
  })

  .put('/:id/hypotheses/:hId/status', async ({ params, body }) => {
    const { status, testResult } = body as any;
    return updateHypothesisStatus(parseInt(params.hId), status, testResult);
  })

  .post('/:id/hypotheses/:hId/revise', async ({ params, body }) => {
    const { content, reasoning } = body as any;
    return reviseHypothesis(parseInt(params.hId), content, reasoning);
  })

  .get('/:id/hypotheses/ranking', async ({ params }) => {
    return rankHypotheses(parseInt(params.id));
  })

  // --- Critic Reviews ---
  .get('/:id/reviews', async ({ params }) => {
    return getReviews(parseInt(params.id));
  })

  .post('/:id/reviews', async ({ params, body }) => {
    const { phase, targetContent, context } = body as any;
    return performReview({
      experimentId: parseInt(params.id),
      phase,
      targetContent,
      context,
    });
  })

  // --- Episodes ---
  .post('/:id/episodes', async ({ params, body }) => {
    const { phase, content, context, outcome, emotionalTag, importance } = body as any;
    return saveEpisode({
      experimentId: parseInt(params.id),
      phase,
      content,
      context,
      outcome,
      emotionalTag,
      importance,
    });
  });
