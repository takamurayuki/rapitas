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
import type {
  ContradictionResolution,
  TimelineEventType,
  ActorType,
} from '../../services/memory/types';

// Type definitions for request bodies
interface ResolveContradictionBody {
  resolution: ContradictionResolution;
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
