/**
 * Knowledge API Routes
 * 知識エントリのCRUD、ベクトル検索、ピン留め、統計
 */
import { Elysia, t } from "elysia";
import {
  createKnowledgeEntry,
  updateKnowledgeEntry,
  archiveKnowledgeEntry,
  pinKnowledgeEntry,
  listKnowledgeEntries,
  getKnowledgeStats,
} from "../../services/memory";
import { searchKnowledge } from "../../services/memory/rag/search";
import { boostDecayOnAccess } from "../../services/memory/forgetting";
import { prisma } from "../../config/database";

export const knowledgeRoutes = new Elysia({ prefix: "/knowledge" })
  // GET /knowledge - エントリ一覧
  .get(
    "/",
    async ({ query }) => {
      const result = await listKnowledgeEntries({
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
        sourceType: query.sourceType as any,
        category: query.category as any,
        forgettingStage: query.forgettingStage as any,
        validationStatus: query.validationStatus as any,
        themeId: query.themeId ? parseInt(query.themeId) : undefined,
        search: query.search,
        sortBy: query.sortBy as any,
        sortOrder: query.sortOrder as any,
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

  // GET /knowledge/search - ベクトル類似検索
  .get(
    "/search",
    async ({ query }) => {
      const results = await searchKnowledge({
        query: query.q,
        limit: query.limit ? parseInt(query.limit) : 10,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : 0.5,
        forgettingStage: query.forgettingStage as any,
        category: query.category as any,
        themeId: query.themeId ? parseInt(query.themeId) : undefined,
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
      }),
    },
  )

  // GET /knowledge/stats - 統計情報
  .get("/stats", async () => {
    return getKnowledgeStats();
  })

  // GET /knowledge/:id - エントリ詳細
  .get(
    "/:id",
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
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      if (!entry) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      // アクセスカウント更新
      await boostDecayOnAccess(id);

      return { ...entry, tags: JSON.parse(entry.tags) };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // POST /knowledge - 作成
  .post(
    "/",
    async ({ body }) => {
      const entry = await createKnowledgeEntry({
        sourceType: body.sourceType as any,
        sourceId: body.sourceId,
        title: body.title,
        content: body.content,
        category: body.category as any,
        tags: body.tags,
        confidence: body.confidence,
        themeId: body.themeId,
        taskId: body.taskId,
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

  // PUT /knowledge/:id - 更新
  .put(
    "/:id",
    async ({ params, body }) => {
      const id = parseInt(params.id);
      const entry = await updateKnowledgeEntry(id, {
        title: body.title,
        content: body.content,
        category: body.category as any,
        tags: body.tags,
        confidence: body.confidence,
        themeId: body.themeId,
        taskId: body.taskId,
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

  // DELETE /knowledge/:id - アーカイブ
  .delete(
    "/:id",
    async ({ params }) => {
      const id = parseInt(params.id);
      const entry = await archiveKnowledgeEntry(id);
      return { success: true, entry };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // POST /knowledge/:id/pin - ピン留め
  .post(
    "/:id/pin",
    async ({ params, body }) => {
      const id = parseInt(params.id);
      const until = new Date(body.until);
      const entry = await pinKnowledgeEntry(id, until);
      return entry;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ until: t.String() }),
    },
  );
