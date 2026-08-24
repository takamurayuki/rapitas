/**
 * Memory System API Routes
 * Timeline, consolidation, contradiction management, queue status, forgetting sweep, and RAG testing.
 */
import { Elysia, t } from 'elysia';
import { queryEvents } from '../../services/memory/timeline';
import { getConsolidationRuns, runConsolidation } from '../../services/memory/consolidation';
import {
  getUnresolvedContradictions,
  resolveContradiction,
} from '../../services/memory/contradiction';
import { memoryTaskQueue } from '../../services/memory';
import { runForgettingSweep } from '../../services/memory/forgetting';
import { buildRAGContext } from '../../services/memory/rag/context-builder';
import { getEmbeddingCount } from '../../services/memory/rag/vector-index';
import { ensureEmbeddingReady } from '../../services/memory/rag/embedding';
import {
  countReindexPending,
  enqueueReindex,
  getEmbeddingIndexStatus,
  getReindexJob,
} from '../../services/memory/rag/reindex';
import { getRecallMetrics } from '../../services/memory/recall/recall-metrics';
import { getDecisionCalibrationStats } from '../../services/memory/decision-journal';
import type {
  ContradictionResolution,
  TimelineEventType,
  ActorType,
} from '../../services/memory/types';

// Type definitions for request bodies
interface ResolveContradictionBody {
  resolution: ContradictionResolution;
}

interface ReindexBody {
  dryRun?: boolean;
  maxEntries?: number;
}

export const memorySystemRoutes = new Elysia({ prefix: '/memory' })
  // GET /memory/timeline - List events
  .get(
    '/timeline',
    async ({ query }) => {
      return queryEvents({
        eventType: query.eventType as TimelineEventType | undefined,
        actorType: query.actorType as ActorType | undefined,
        correlationId: query.correlationId,
        since: query.since ? new Date(query.since) : undefined,
        until: query.until ? new Date(query.until) : undefined,
        limit: query.limit ? parseInt(query.limit) : 50,
        offset: query.offset ? parseInt(query.offset) : 0,
      });
    },
    {
      query: t.Object({
        eventType: t.Optional(t.String()),
        actorType: t.Optional(t.String()),
        correlationId: t.Optional(t.String()),
        since: t.Optional(t.String()),
        until: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  // GET /memory/consolidation/runs - Consolidation run history
  .get(
    '/consolidation/runs',
    async ({ query }) => {
      const limit = query.limit ? parseInt(query.limit) : 20;
      return getConsolidationRuns(limit);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    },
  )

  // POST /memory/consolidation/trigger - Manual trigger
  .post('/consolidation/trigger', async () => {
    const result = await runConsolidation();
    return result;
  })

  // GET /memory/contradictions - Unresolved contradictions
  .get(
    '/contradictions',
    async ({ query }) => {
      const limit = query.limit ? parseInt(query.limit) : 20;
      return getUnresolvedContradictions(limit);
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    },
  )

  // POST /memory/contradictions/:id/resolve - Resolve contradiction
  .post(
    '/contradictions/:id/resolve',
    async ({ params, body }) => {
      const id = parseInt(params.id);
      const typedBody = body as ResolveContradictionBody;
      await resolveContradiction(id, typedBody.resolution);
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        resolution: t.String(), // "keep_a" | "keep_b" | "merge" | "dismiss"
      }),
    },
  )

  // GET /memory/decisions/stats - Plan-gate decision calibration
  // (human approvals vs auto-approvals: whose judgment is more accurate)
  .get('/decisions/stats', async () => {
    return getDecisionCalibrationStats();
  })

  // GET /memory/queue/status - Queue status
  .get('/queue/status', async () => {
    const status = await memoryTaskQueue.getStatus();
    const embeddingCount = getEmbeddingCount();
    return { ...status, embeddingCount };
  })

  // POST /memory/forgetting/sweep - Manual forgetting sweep
  .post('/forgetting/sweep', async () => {
    const result = await runForgettingSweep();
    return result;
  })

  // GET /memory/recall/metrics - Recall attempt metrics (non-empty rate,
  // attempts per agent execution) over the last N days
  .get(
    '/recall/metrics',
    async ({ query }) => {
      const days = query.days ? parseInt(query.days) : 7;
      return getRecallMetrics(Number.isFinite(days) && days > 0 ? days : 7);
    },
    { query: t.Object({ days: t.Optional(t.String()) }) },
  )

  // GET /memory/embeddings/status - Embedding model / index migration status
  .get('/embeddings/status', async () => {
    const [status, reindexJob] = await Promise.all([getEmbeddingIndexStatus(), getReindexJob()]);
    return { ...status, reindexJob };
  })

  // POST /memory/embeddings/reindex - Re-embed with the active model
  // (dryRun → counts only; otherwise enqueues a `reembed` job, reusing a pending one)
  .post('/embeddings/reindex', async ({ body }) => {
    const typedBody = (body ?? {}) as ReindexBody;
    if (typedBody.dryRun) {
      const targetModel = await ensureEmbeddingReady();
      return { targetModel, pending: await countReindexPending(targetModel) };
    }
    const maxEntries =
      typeof typedBody.maxEntries === 'number' && typedBody.maxEntries > 0
        ? Math.floor(typedBody.maxEntries)
        : undefined;
    const jobId = await enqueueReindex(memoryTaskQueue, maxEntries);
    return { jobId };
  })

  // GET /memory/rag/test - RAG test
  .get(
    '/rag/test',
    async ({ query }) => {
      const context = await buildRAGContext(query.q, {
        limit: query.limit ? parseInt(query.limit) : 5,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : 0.5,
        themeId: query.themeId ? parseInt(query.themeId) : undefined,
      });
      return context;
    },
    {
      query: t.Object({
        q: t.String(),
        limit: t.Optional(t.String()),
        minSimilarity: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
      }),
    },
  );
