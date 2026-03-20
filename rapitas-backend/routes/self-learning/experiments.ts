/**
 * Experiments API - 実験管理エンドポイント
 */

import { Elysia, t } from 'elysia';
import {
  createExperiment,
  updateExperiment,
  runResearch,
  getExperiment,
  listExperiments,
  getExperimentTimeline,
  ExperimentPhase,
  CreateExperimentInput,
  UpdateExperimentInput,
  CreateHypothesisInput,
  CriticReviewInput,
  CreateEpisodeInput,
  HypothesisStatus,
  HypothesisTestResult,
  ExperimentEvaluation,
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
    return listExperiments({ page, limit, status: status as ExperimentPhase | undefined, taskId });
  })

  .get('/:id', async ({ params }) => {
    const experiment = await getExperiment(parseInt(params.id));
    if (!experiment) return { error: 'Experiment not found' };
    return experiment;
  })

  .post('/', async ({ body }) => {
    return createExperiment(body);
  }, {
    body: t.Object({
      taskId: t.Number(),
      title: t.String(),
      metadata: t.Optional(t.Record(t.String(), t.Any()))
    })
  })

  .put('/:id', async ({ params, body }) => {
    return updateExperiment(parseInt(params.id), {
      ...body,
      status: body.status as ExperimentPhase | undefined,
      evaluation: body.evaluation ? {
        ...body.evaluation,
        testsPassed: 0,
        testsFailed: 0,
        errorsEncountered: [],
        overallSuccess: true
      } : undefined
    });
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      metadata: t.Optional(t.Record(t.String(), t.Any())),
      status: t.Optional(t.String()),
      evaluation: t.Optional(t.Object({
        learningValue: t.Number(),
        confidence: t.Number(),
        applicability: t.Number(),
        insights: t.Array(t.String())
      }))
    })
  })

  // --- Research ---
  .post('/:id/research', async ({ params, body }) => {
    return runResearch(parseInt(params.id), body.query);
  }, {
    body: t.Object({
      query: t.String()
    })
  })

  // --- Evaluate ---
  .post('/:id/evaluate', async ({ params, body }) => {
    return updateExperiment(parseInt(params.id), {
      evaluation: {
        ...body,
        testsPassed: 0,
        testsFailed: 0,
        errorsEncountered: [],
        overallSuccess: true
      },
      status: 'evaluating',
    });
  }, {
    body: t.Object({
      learningValue: t.Number(),
      confidence: t.Number(),
      applicability: t.Number(),
      insights: t.Array(t.String())
    })
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
    return createHypothesis({
      experimentId: parseInt(params.id),
      ...body,
    });
  }, {
    body: t.Object({
      content: t.String(),
      reasoning: t.Optional(t.String()),
      confidence: t.Number(),
      priority: t.Number()
    })
  })

  .put('/:id/hypotheses/:hId/status', async ({ params, body }) => {
    return updateHypothesisStatus(parseInt(params.hId), body.status as HypothesisStatus, body.testResult);
  }, {
    body: t.Object({
      status: t.String(),
      testResult: t.Optional(t.Object({
        outcome: t.String(),
        evidence: t.String(),
        confidence: t.Number(),
        metadata: t.Optional(t.Record(t.String(), t.Any()))
      }))
    })
  })

  .post('/:id/hypotheses/:hId/revise', async ({ params, body }) => {
    return reviseHypothesis(parseInt(params.hId), body.content, body.reasoning);
  }, {
    body: t.Object({
      content: t.String(),
      reasoning: t.Optional(t.String())
    })
  })

  .get('/:id/hypotheses/ranking', async ({ params }) => {
    return rankHypotheses(parseInt(params.id));
  })

  // --- Critic Reviews ---
  .get('/:id/reviews', async ({ params }) => {
    return getReviews(parseInt(params.id));
  })

  .post('/:id/reviews', async ({ params, body }) => {
    return performReview({
      experimentId: parseInt(params.id),
      phase: body.phase as CriticPhase,
      targetContent: body.targetContent,
      context: body.context,
    });
  }, {
    body: t.Object({
      phase: t.String(),
      targetContent: t.String(),
      context: t.Optional(t.String())
    })
  })

  // --- Episodes ---
  .post('/:id/episodes', async ({ params, body }) => {
    return saveEpisode({
      experimentId: parseInt(params.id),
      phase: body.phase as EpisodePhase,
      content: body.content,
      context: body.context,
      outcome: body.outcome,
      emotionalTag: body.emotionalTag,
      importance: body.importance,
    });
  }, {
    body: t.Object({
      phase: t.String(),
      content: t.String(),
      context: t.Optional(t.String()),
      outcome: t.Optional(t.String()),
      emotionalTag: t.Optional(t.String()),
      importance: t.Number()
    })
  });
