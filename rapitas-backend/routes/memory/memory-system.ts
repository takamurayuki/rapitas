/**
 * Memory System API Routes
 * タイムライン、固定化、矛盾管理、キュー状態、忘却スイープ、RAGテスト
 */
import { Elysia, t } from "elysia";
import { queryEvents } from "../../services/memory/timeline";
import { getConsolidationRuns, runConsolidation } from "../../services/memory/consolidation";
import {
  getUnresolvedContradictions,
  resolveContradiction,
} from "../../services/memory/contradiction";
import { memoryTaskQueue } from "../../services/memory";
import { runForgettingSweep } from "../../services/memory/forgetting";
import { buildRAGContext } from "../../services/memory/rag/context-builder";
import { getEmbeddingCount } from "../../services/memory/rag/vector-index";
import type { ContradictionResolution } from "../../services/memory/types";

export const memorySystemRoutes = new Elysia({ prefix: "/memory" })
  // GET /memory/timeline - イベント一覧
  .get(
    "/timeline",
    async ({ query }) => {
      return queryEvents({
        eventType: query.eventType as any,
        actorType: query.actorType as any,
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

  // GET /memory/consolidation/runs - 固定化実行履歴
  .get(
    "/consolidation/runs",
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

  // POST /memory/consolidation/trigger - 手動トリガー
  .post("/consolidation/trigger", async () => {
    const result = await runConsolidation();
    return result;
  })

  // GET /memory/contradictions - 未解決矛盾一覧
  .get(
    "/contradictions",
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

  // POST /memory/contradictions/:id/resolve - 矛盾解決
  .post(
    "/contradictions/:id/resolve",
    async ({ params, body }) => {
      const id = parseInt(params.id);
      await resolveContradiction(id, body.resolution as ContradictionResolution);
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        resolution: t.String(), // "keep_a" | "keep_b" | "merge" | "dismiss"
      }),
    },
  )

  // GET /memory/queue/status - キュー状態
  .get("/queue/status", async () => {
    const status = await memoryTaskQueue.getStatus();
    const embeddingCount = getEmbeddingCount();
    return { ...status, embeddingCount };
  })

  // POST /memory/forgetting/sweep - 忘却スイープ手動実行
  .post("/forgetting/sweep", async () => {
    const result = await runForgettingSweep();
    return result;
  })

  // GET /memory/rag/test - RAGテスト
  .get(
    "/rag/test",
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
