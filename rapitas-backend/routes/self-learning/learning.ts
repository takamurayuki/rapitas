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
  getPromptEvolutionSummary,
  getLearningStats,
  getGrowthTimeline,
  getMemoryOverview,
  LearningPatternType,
  LearningCategory,
  EpisodePhase,
} from '../../services/self-learning';
import { createLogger } from '../../config/logger';
import { prisma } from '../../config/database';

const log = createLogger('routes:learning');
import { findSimilarEpisodes, getEpisodeStats } from '../../services/self-learning';

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

  // --- Prompt Evolution ---
  .get('/prompt-evolution', async ({ query }) => {
    const category = query.category as string | undefined;
    return getPromptEvolutionHistory(category);
  })

  /** Proposals awaiting human review (approve/reject on /system-prompts). */
  .get('/prompt-evolution/proposals', async () => {
    const { listProposals } = await import('../../services/self-learning/prompt-evolution-worker');
    return { proposals: await listProposals() };
  })

  /** Approve or reject a proposed role-prompt addendum. */
  .post('/prompt-evolution/:id/review', async ({ params, body, set }) => {
    const id = parseInt((params as { id: string }).id, 10);
    const approved = (body as { approved?: boolean } | null)?.approved;
    if (!Number.isInteger(id) || typeof approved !== 'boolean') {
      set.status = 400;
      return { error: 'id and approved (boolean) are required' };
    }
    const { reviewProposal } = await import('../../services/self-learning/prompt-evolution-worker');
    const ok = await reviewProposal(id, approved);
    if (!ok) {
      set.status = 404;
      return { error: 'Proposal not found or not in proposed state' };
    }
    return { success: true, approved };
  })

  /**
   * Current-vs-candidate comparison result for one PromptEvolution candidate
   * (success-rate/cost/duration delta, failure-cause breakdown, verdict).
   * Returns `{ comparison: null }` when no shadow-run comparison has been
   * recorded yet — the approval UI shows a "comparison not run" warning
   * rather than blocking approval.
   */
  .get('/prompt-evolution/:id/comparison', async ({ params, set }) => {
    const id = parseInt((params as { id: string }).id, 10);
    if (!Number.isInteger(id)) {
      set.status = 400;
      return { error: 'id must be an integer' };
    }
    const { readComparisonRecord } =
      await import('../../services/self-learning/comparison/prompt-comparison-store');
    return { comparison: readComparisonRecord(id) };
  })

  /**
   * Limit an approved candidate's application to a small set of task ids
   * (段階採用). Requires a comparison record to already exist — staging is
   * part of the same human-approval flow that reviews the comparison result.
   */
  .post(
    '/prompt-evolution/:id/stage',
    async ({ params, body, set }) => {
      const id = parseInt((params as { id: string }).id, 10);
      if (!Number.isInteger(id)) {
        set.status = 400;
        return { error: 'id must be an integer' };
      }
      const { readComparisonRecord, writeComparisonRecord } =
        await import('../../services/self-learning/comparison/prompt-comparison-store');
      const record = readComparisonRecord(id);
      if (!record) {
        set.status = 404;
        return { error: 'comparison_not_run' };
      }
      const taskIds = body.taskIds;
      writeComparisonRecord({ ...record, stagedTaskIds: taskIds });
      return { status: 'staged', taskIds };
    },
    { body: t.Object({ taskIds: t.Array(t.Number()) }) },
  )

  /**
   * Trigger a current-vs-candidate shadow-run comparison for a `proposed`
   * candidate. Responds immediately (lock acquired + an `in_progress` record
   * seeded synchronously via `beginComparisonRun`) while the shadow runs
   * execute in the background via `finishComparisonRun` — a single comparison
   * run can take minutes, well beyond an HTTP request's usual budget
   * (plan.md 設計判断の根拠 — 実行方式).
   */
  .post(
    '/prompt-evolution/:id/compare',
    async ({ params, body, set }) => {
      const id = parseInt((params as { id: string }).id, 10);
      if (!Number.isInteger(id)) {
        set.status = 400;
        return { error: 'id must be an integer' };
      }
      const evolution = await prisma.promptEvolution.findUnique({
        where: { id },
        select: { id: true, status: true, basePromptKey: true, afterPrompt: true },
      });
      if (!evolution) {
        set.status = 404;
        return { error: 'not_found' };
      }
      if (evolution.status !== 'proposed') {
        set.status = 400;
        return { error: 'not_proposed' };
      }
      const role = evolution.basePromptKey?.replace(/^workflow_role_/, '') ?? 'unknown';
      const {
        DEFAULT_COMPARISON_MODEL,
        DEFAULT_COMPARISON_BUDGET_USD,
        beginComparisonRun,
        finishComparisonRun,
        selectComparisonSampleTasks,
        ComparisonLockedError,
      } = await import('../../services/self-learning/comparison/prompt-comparison-runner');
      const budgetUsd = body.budgetUsd ?? DEFAULT_COMPARISON_BUDGET_USD;
      // Empty/omitted sampleTaskIds = let the server pick (mirrors the
      // scheduler hook's automatic sampling) so the manual trigger button
      // doesn't require a task-id picker UI (plan.md 実装者への申し送り事項 #2).
      const sampleTaskIds =
        body.sampleTaskIds.length > 0
          ? body.sampleTaskIds
          : await selectComparisonSampleTasks(role, 5);
      try {
        beginComparisonRun({
          evolutionId: id,
          role,
          modelName: DEFAULT_COMPARISON_MODEL,
          sampleTaskIds,
          budgetUsd,
        });
      } catch (err) {
        if (err instanceof ComparisonLockedError) {
          set.status = 409;
          return { error: 'comparison_locked' };
        }
        throw err;
      }
      void finishComparisonRun({
        evolutionId: id,
        role,
        modelName: DEFAULT_COMPARISON_MODEL,
        afterPrompt: evolution.afterPrompt,
        sampleTaskIds,
        budgetUsd,
      }).catch((err) => {
        log.error({ err, evolutionId: id }, '[learning] Background prompt comparison failed');
      });
      set.status = 202;
      // Ties the ad-hoc trigger id back to the evolutionId it started (no persisted
      // execution row exists to derive a real id from — ComparisonRecord itself is
      // keyed by evolutionId in the store) so the response value is at least
      // traceable rather than a bare timestamp.
      const runId = id * 1_000_000_000_000 + (Date.now() % 1_000_000_000_000);
      return { runId, status: 'running' };
    },
    {
      body: t.Object({
        sampleTaskIds: t.Array(t.Number()),
        budgetUsd: t.Optional(t.Number()),
      }),
    },
  )

  /**
   * Read-only summary of the PromptEvolution table, grouped by
   * basePromptKey/category: entry/pending/completed counts and performance
   * trend per group. Does not pick or promote a "winner" prompt.
   */
  .get('/prompt-evolution/summary', async ({ set }) => {
    try {
      const data = await getPromptEvolutionSummary();
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error summarizing prompt evolution');
      set.status = 500;
      return { success: false, data: [] };
    }
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
