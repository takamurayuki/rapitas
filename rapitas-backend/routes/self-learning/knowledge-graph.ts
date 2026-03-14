/**
 * Knowledge Graph API - 知識グラフエンドポイント
 */

import { Elysia } from 'elysia';
import {
  addNode,
  listNodes,
  getNode,
  addEdge,
  findRelated,
  getSubgraph,
  mergeNodes,
  getGraphStats,
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
    return listNodes({ nodeType: nodeType as any, search, page, limit, sortBy: sortBy as any });
  })

  .get('/nodes/:id', async ({ params }) => {
    const node = await getNode(parseInt(params.id));
    if (!node) return { error: 'Node not found' };
    return node;
  })

  .post('/nodes', async ({ body }) => {
    const { label, nodeType, description, properties, weight } = body as any;
    return addNode({ label, nodeType, description, properties, weight });
  })

  .get('/nodes/:id/related', async ({ params, query }) => {
    const edgeTypes = query.edgeTypes ? (query.edgeTypes as string).split(',') : undefined;
    return findRelated(parseInt(params.id), edgeTypes as any);
  })

  // --- Edges ---
  .post('/edges', async ({ body }) => {
    const { fromNodeId, toNodeId, edgeType, weight, metadata } = body as any;
    return addEdge({ fromNodeId, toNodeId, edgeType, weight, metadata });
  })

  // --- Subgraph ---
  .get('/subgraph', async ({ query }) => {
    const nodeId = parseInt(query.nodeId as string);
    const depth = query.depth ? parseInt(query.depth as string) : 2;
    const maxNodes = query.maxNodes ? parseInt(query.maxNodes as string) : 50;
    const edgeTypes = query.edgeTypes ? (query.edgeTypes as string).split(',') : undefined;

    if (isNaN(nodeId)) return { error: 'nodeId is required' };

    return getSubgraph({ nodeId, depth, edgeTypes: edgeTypes as any, maxNodes });
  })

  // --- Merge ---
  .post('/nodes/merge', async ({ body }) => {
    const { keepId, removeId } = body as any;
    return mergeNodes(keepId, removeId);
  })

  // --- Stats ---
  .get('/stats', async () => {
    return getGraphStats();
  });
