/**
 * Knowledge API Routes
 * Knowledge entry CRUD, vector search, pinning, and statistics.
 */
import { Elysia, t } from 'elysia';
import {
  createKnowledgeEntry,
  updateKnowledgeEntry,
  archiveKnowledgeEntry,
  pinKnowledgeEntry,
  listKnowledgeEntries,
  getKnowledgeStats,
} from '../../services/memory';
import { searchKnowledgeHybrid } from '../../services/memory/recall/hybrid-search';
import { resetEmbeddingPipeline } from '../../services/memory/rag/embedding';
import { boostDecayOnAccess } from '../../services/memory/forgetting';
import { parseTagsAsStrings } from '../../services/memory/utils';
import { prisma } from '../../config/database';
import type {
  KnowledgeSourceType,
  KnowledgeCategory,
  ForgettingStage,
  ValidationStatus,
} from '../../services/memory/types';

// Type definitions for request bodies
interface CreateKnowledgeBody {
  sourceType: string;
  sourceId?: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  confidence?: number;
  themeId?: number;
  taskId?: number;
}

interface UpdateKnowledgeBody {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  confidence?: number;
  themeId?: number;
  taskId?: number;
}

interface PinKnowledgeBody {
  until: string;
}

const STAGES: ForgettingStage[] = ['active', 'dormant', 'archived'];

/** Parse `active,dormant` → valid stages; undefined when none are valid. */
function parseStagesParam(raw: string | undefined): ForgettingStage[] | undefined {
  if (!raw) return undefined;
  const stages = raw
    .split(',')
    .map((s) => s.trim() as ForgettingStage)
    .filter((s) => STAGES.includes(s));
  return stages.length > 0 ? stages : undefined;
}

export const knowledgeRoutes = new Elysia({ prefix: '/knowledge' })
  // GET /knowledge - List entries
  .get(
    '/',
    async ({ query }) => {
      const result = await listKnowledgeEntries({
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        sourceType: query.sourceType as KnowledgeSourceType | undefined,
        category: query.category as KnowledgeCategory | undefined,
        forgettingStage: query.forgettingStage as ForgettingStage | undefined,
        validationStatus: query.validationStatus as ValidationStatus | undefined,
        themeId: query.themeId ? parseInt(query.themeId) : undefined,
        search: query.search,
        sortBy: query.sortBy as
          | 'createdAt'
          | 'updatedAt'
          | 'confidence'
          | 'accessCount'
          | 'decayScore'
          | undefined,
        sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
      });
      return result;
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        sourceType: t.Optional(t.String()),
        category: t.Optional(t.String()),
        forgettingStage: t.Optional(t.String()),
        validationStatus: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        search: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    },
  )

  // GET /knowledge/search - Hybrid (vector + lexical) search. Defaults for
  // minSimilarity / stages / lexical come from RAPITAS_KB_RECALL_*.
  .get(
    '/search',
    async ({ query }) => {
      const results = await searchKnowledgeHybrid({
        query: query.q,
        limit: query.limit ? parseInt(query.limit) : 10,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : undefined,
        stages: parseStagesParam(query.forgettingStage),
        category: query.category as KnowledgeCategory | undefined,
        themeId: query.themeId ? parseInt(query.themeId) : undefined,
        lexical: query.lexical === undefined ? undefined : query.lexical !== '0',
        telemetry: { source: 'api' },
      });
      return { results };
    },
    {
      query: t.Object({
        q: t.String(),
        limit: t.Optional(t.String()),
        minSimilarity: t.Optional(t.String()),
        forgettingStage: t.Optional(t.String()),
        category: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        lexical: t.Optional(t.String()),
      }),
    },
  )

  // GET /knowledge/stats - Statistics
  .get('/stats', async () => {
    return getKnowledgeStats();
  })

  // POST /knowledge/embedding/reset - Reset embedding pipeline
  .post('/embedding/reset', async () => {
    resetEmbeddingPipeline();
    return { success: true, message: 'Embedding pipeline reset successfully' };
  })

  // GET /knowledge/:id - Entry details
  .get(
    '/:id',
    async ({ params }) => {
      const id = parseInt(params.id);
      const entry = await prisma.knowledgeEntry.findUnique({
        where: { id },
        include: {
          contradictions: {
            include: { entryB: { select: { id: true, title: true } } },
          },
          contradictedBy: {
            include: { entryA: { select: { id: true, title: true } } },
          },
          reconsolidations: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!entry) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      // Update access count to slow forgetting decay
      await boostDecayOnAccess(id);

      return { ...entry, tags: parseTagsAsStrings(entry.tags) };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // POST /knowledge - Create
  .post(
    '/',
    async ({ body }) => {
      const typedBody = body as CreateKnowledgeBody;
      const entry = await createKnowledgeEntry({
        sourceType: typedBody.sourceType as KnowledgeSourceType,
        sourceId: typedBody.sourceId,
        title: typedBody.title,
        content: typedBody.content,
        category: typedBody.category as KnowledgeCategory | undefined,
        tags: typedBody.tags,
        confidence: typedBody.confidence,
        themeId: typedBody.themeId,
        taskId: typedBody.taskId,
      });
      return entry;
    },
    {
      body: t.Object({
        sourceType: t.String(),
        sourceId: t.Optional(t.String()),
        title: t.String(),
        content: t.String(),
        category: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        confidence: t.Optional(t.Number()),
        themeId: t.Optional(t.Number()),
        taskId: t.Optional(t.Number()),
      }),
    },
  )

  // PUT /knowledge/:id - Update
  .put(
    '/:id',
    async ({ params, body }) => {
      const id = parseInt(params.id);
      const typedBody = body as UpdateKnowledgeBody;
      const entry = await updateKnowledgeEntry(id, {
        title: typedBody.title,
        content: typedBody.content,
        category: typedBody.category as KnowledgeCategory | undefined,
        tags: typedBody.tags,
        confidence: typedBody.confidence,
        themeId: typedBody.themeId,
        taskId: typedBody.taskId,
      });
      return entry;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        category: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        confidence: t.Optional(t.Number()),
        themeId: t.Optional(t.Number()),
        taskId: t.Optional(t.Number()),
      }),
    },
  )

  // DELETE /knowledge/:id - Archive
  .delete(
    '/:id',
    async ({ params }) => {
      const id = parseInt(params.id);
      const entry = await archiveKnowledgeEntry(id);
      return { success: true, entry };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // POST /knowledge/:id/pin - Pin entry
  .post(
    '/:id/pin',
    async ({ params, body }) => {
      const id = parseInt(params.id);
      const typedBody = body as PinKnowledgeBody;
      const until = new Date(typedBody.until);
      const entry = await pinKnowledgeEntry(id, until);
      return entry;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ until: t.String() }),
    },
  );
