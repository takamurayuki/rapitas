/**
 * Learning API - 学習エンジンエンドポイント
 */

import { Elysia, t } from 'elysia';
import {
  analyzeFailure,
  extractStrategy,
  listPatterns,
  createPattern,
  recordPromptEvolution,
  getPromptEvolutionHistory,
  getLearningStats,
  getGrowthTimeline,
  getMemoryOverview,
  CreatePatternInput,
  LearningPatternType,
  LearningCategory,
  CriticPhase,
  EpisodePhase,
  CreatePromptEvolutionInput,
} from '../../services/self-learning';
import { getAverageScores } from '../../services/self-learning';
import { findSimilarEpisodes, getEpisodeStats } from '../../services/self-learning';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:learning');

export const learningRoutes = new Elysia({ prefix: '/learning' })
  // --- Patterns ---
  .get('/patterns', async ({ query }) => {
    const page = query.page ? parseInt(query.page as string) : 1;
    const limit = query.limit ? parseInt(query.limit as string) : 20;
    const patternType = query.patternType as string | undefined;
    const category = query.category as string | undefined;
    return listPatterns({
      patternType: patternType as LearningPatternType | undefined,
      category: category as LearningCategory | undefined,
      page,
      limit,
    });
  })

  .post(
    '/patterns',
    async ({ body }) => {
      return createPattern({
        patternType: body.patternType as LearningPatternType,
        category: body.category as LearningCategory,
        description: body.description,
        confidence: body.confidence,
      });
    },
    {
      body: t.Object({
        patternType: t.String(),
        title: t.String(),
        description: t.String(),
        category: t.String(),
        conditions: t.Array(t.String()),
        examples: t.Array(t.String()),
        relatedStrategies: t.Optional(t.Array(t.String())),
        confidence: t.Number(),
        frequency: t.Optional(t.Number()),
      }),
    },
  )

  // --- Analysis ---
  .post('/analyze/failure/:experimentId', async ({ params }) => {
    return analyzeFailure(parseInt(params.experimentId));
  })

  .post('/analyze/strategy/:experimentId', async ({ params }) => {
    return extractStrategy(parseInt(params.experimentId));
  })

  // --- Statistics ---
  .get('/stats', async () => {
    return getLearningStats();
  })

  // --- Critic Scores ---
  .get('/critic-scores', async ({ query }) => {
    const phase = query.phase as string | undefined;
    return getAverageScores(phase as CriticPhase | undefined);
  })

  // --- Prompt Evolution ---
  .get('/prompt-evolution', async ({ query }) => {
    const category = query.category as string | undefined;
    return getPromptEvolutionHistory(category);
  })

  .post(
    '/prompt-evolution',
    async ({ body }) => {
      return recordPromptEvolution({
        category: body.category,
        beforePrompt: body.prompt,
        afterPrompt: body.results,
        improvement: body.improvements?.join('; '),
        performanceDelta: body.performanceScore,
      });
    },
    {
      body: t.Object({
        category: t.String(),
        iteration: t.Number(),
        prompt: t.String(),
        results: t.String(),
        improvements: t.Array(t.String()),
        performanceScore: t.Number(),
      }),
    },
  )

  // --- Episode Search ---
  .get('/episodes/search', async ({ query }) => {
    const q = query.q as string;
    const phase = query.phase as string | undefined;
    const limit = query.limit ? parseInt(query.limit as string) : 10;
    const minImportance = query.minImportance ? parseFloat(query.minImportance as string) : 0;

    if (!q) return { error: "Query parameter 'q' is required" };

    return findSimilarEpisodes(q, {
      phase: phase as EpisodePhase | undefined,
      limit,
      minImportance,
    });
  })

  .get('/episodes/stats', async () => {
    return getEpisodeStats();
  })

  // --- Growth Timeline ---
  .get('/growth-timeline', async ({ query }) => {
    const period = (query.period as '7d' | '30d' | 'all') || '30d';
    return getGrowthTimeline(period);
  })

  // --- Memory Overview ---
  .get('/memory-overview', async () => {
    return getMemoryOverview();
  });
