/**
 * Knowledge Graph API - 知識グラフエンドポイント
 */

import { Elysia, t } from 'elysia';
import {
  addNode,
  listNodes,
  getNode,
  addEdge,
  findRelated,
  getSubgraph,
  mergeNodes,
  getGraphStats,
  CreateNodeInput,
  CreateEdgeInput,
  KnowledgeNodeType,
  KnowledgeEdgeType,
} from '../../services/self-learning';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:knowledge-graph');

export const knowledgeGraphRoutes = new Elysia({ prefix: '/knowledge-graph' })
  // --- Nodes ---
  .get('/nodes', async ({ query }) => {
    const page = query.page ? parseInt(query.page as string) : 1;
    const limit = query.limit ? parseInt(query.limit as string) : 50;
    const nodeType = query.nodeType as string | undefined;
    const search = query.search as string | undefined;
    const sortBy = (query.sortBy as string) ?? 'weight';
    return listNodes({
      nodeType: nodeType as KnowledgeNodeType | undefined,
      search,
      page,
      limit,
      sortBy: sortBy as 'weight' | 'accessCount' | 'createdAt',
    });
  })

  .get('/nodes/:id', async ({ params }) => {
    const node = await getNode(parseInt(params.id));
    if (!node) return { error: 'Node not found' };
    return node;
  })

  .post(
    '/nodes',
    async ({ body }) => {
      return addNode({
        ...body,
        nodeType: body.nodeType as KnowledgeNodeType,
      });
    },
    {
      body: t.Object({
        label: t.String(),
        nodeType: t.String(),
        description: t.Optional(t.String()),
        properties: t.Optional(t.Record(t.String(), t.Any())),
        weight: t.Optional(t.Number()),
      }),
    },
  )

  .get('/nodes/:id/related', async ({ params, query }) => {
    const edgeTypes = query.edgeTypes ? (query.edgeTypes as string).split(',') : undefined;
    return findRelated(parseInt(params.id), edgeTypes as KnowledgeEdgeType[] | undefined);
  })

  // --- Edges ---
  .post(
    '/edges',
    async ({ body }) => {
      return addEdge({
        ...body,
        edgeType: body.edgeType as KnowledgeEdgeType,
      });
    },
    {
      body: t.Object({
        fromNodeId: t.Number(),
        toNodeId: t.Number(),
        edgeType: t.String(),
        weight: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    },
  )

  // --- Subgraph ---
  .get('/subgraph', async ({ query }) => {
    const nodeId = parseInt(query.nodeId as string);
    const depth = query.depth ? parseInt(query.depth as string) : 2;
    const maxNodes = query.maxNodes ? parseInt(query.maxNodes as string) : 50;
    const edgeTypes = query.edgeTypes ? (query.edgeTypes as string).split(',') : undefined;

    if (isNaN(nodeId)) return { error: 'nodeId is required' };

    return getSubgraph({
      nodeId,
      depth,
      edgeTypes: edgeTypes as KnowledgeEdgeType[] | undefined,
      maxNodes,
    });
  })

  // --- Merge ---
  .post(
    '/nodes/merge',
    async ({ body }) => {
      return mergeNodes(body.keepId, body.removeId);
    },
    {
      body: t.Object({
        keepId: t.Number(),
        removeId: t.Number(),
      }),
    },
  )

  // --- Stats ---
  .get('/stats', async () => {
    return getGraphStats();
  });
