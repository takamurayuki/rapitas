/**
 * Knowledge Graph - 知識をグラフ構造で管理
 *
 * ノード: concept, problem, solution, technology, pattern
 * エッジ: related, causes, solves, requires, part_of, similar_to
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type {
  CreateNodeInput,
  CreateEdgeInput,
  SubgraphQuery,
  GraphNode,
  GraphEdge,
  Subgraph,
  KnowledgeNodeType,
  KnowledgeEdgeType,
} from './types';

const log = createLogger('self-learning:knowledge-graph');

// --- Node Operations ---

/**
 * ノードを追加（既存の場合はweightを加算）
 */
export async function addNode(input: CreateNodeInput): Promise<GraphNode> {
  const existing = await prisma.knowledgeGraphNode.findUnique({
    where: {
      label_nodeType: { label: input.label, nodeType: input.nodeType },
    },
  });

  if (existing) {
    const updated = await prisma.knowledgeGraphNode.update({
      where: { id: existing.id },
      data: {
        weight: existing.weight + (input.weight ?? 0.1),
        accessCount: existing.accessCount + 1,
        lastAccessedAt: new Date(),
        description: input.description ?? existing.description,
      },
    });
    return parseNode(updated);
  }

  const node = await prisma.knowledgeGraphNode.create({
    data: {
      label: input.label,
      nodeType: input.nodeType,
      description: input.description,
      properties: JSON.stringify(input.properties ?? {}),
      weight: input.weight ?? 1.0,
    },
  });

  log.info({ nodeId: node.id, label: node.label }, 'Knowledge graph node added');
  return parseNode(node);
}

/**
 * ノード一覧を取得
 */
export async function listNodes(
  options: {
    nodeType?: KnowledgeNodeType;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: 'weight' | 'accessCount' | 'createdAt';
  } = {},
) {
  const { nodeType, search, page = 1, limit = 50, sortBy = 'weight' } = options;

  const where: Record<string, unknown> = {};
  if (nodeType) where.nodeType = nodeType;
  if (search) {
    where.OR = [
      { label: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [nodes, total] = await Promise.all([
    prisma.knowledgeGraphNode.findMany({
      where,
      orderBy: { [sortBy]: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.knowledgeGraphNode.count({ where }),
  ]);

  return {
    nodes: nodes.map(parseNode),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * ノードを取得
 */
export async function getNode(id: number) {
  const node = await prisma.knowledgeGraphNode.findUnique({ where: { id } });
  if (!node) return null;

  // アクセスカウントを更新
  await prisma.knowledgeGraphNode.update({
    where: { id },
    data: { accessCount: node.accessCount + 1, lastAccessedAt: new Date() },
  });

  return parseNode(node);
}

// --- Edge Operations ---

/**
 * エッジを追加（既存の場合はweightを加算）
 */
export async function addEdge(input: CreateEdgeInput): Promise<GraphEdge> {
  const existing = await prisma.knowledgeGraphEdge.findUnique({
    where: {
      fromNodeId_toNodeId_edgeType: {
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        edgeType: input.edgeType,
      },
    },
  });

  if (existing) {
    const updated = await prisma.knowledgeGraphEdge.update({
      where: { id: existing.id },
      data: { weight: existing.weight + (input.weight ?? 0.1) },
    });
    return parseEdge(updated);
  }

  const edge = await prisma.knowledgeGraphEdge.create({
    data: {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      edgeType: input.edgeType,
      weight: input.weight ?? 1.0,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });

  log.info(
    { edgeId: edge.id, from: input.fromNodeId, to: input.toNodeId },
    'Knowledge graph edge added',
  );
  return parseEdge(edge);
}

// --- Graph Traversal ---

/**
 * 関連ノードを取得
 */
export async function findRelated(nodeId: number, edgeTypes?: KnowledgeEdgeType[]) {
  const where: Record<string, unknown> = {
    OR: [{ fromNodeId: nodeId }, { toNodeId: nodeId }],
  };
  if (edgeTypes?.length) {
    where.edgeType = { in: edgeTypes };
  }

  const edges = await prisma.knowledgeGraphEdge.findMany({
    where,
    include: {
      fromNode: true,
      toNode: true,
    },
    orderBy: { weight: 'desc' },
  });

  // 隣接ノードを重複なしで返す
  const nodeMap = new Map<number, GraphNode>();
  for (const edge of edges) {
    const relatedNode = edge.fromNodeId === nodeId ? edge.toNode : edge.fromNode;
    if (!nodeMap.has(relatedNode.id)) {
      nodeMap.set(relatedNode.id, parseNode(relatedNode));
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: edges.map(parseEdge),
  };
}

/**
 * サブグラフを取得（BFS探索）
 */
export async function getSubgraph(query: SubgraphQuery): Promise<Subgraph> {
  const { nodeId, depth = 2, edgeTypes, maxNodes = 50 } = query;

  const visitedNodes = new Set<number>();
  const collectedEdges: GraphEdge[] = [];
  let frontier = [nodeId];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const nextFrontier: number[] = [];

    for (const currentId of frontier) {
      if (visitedNodes.has(currentId) || visitedNodes.size >= maxNodes) continue;
      visitedNodes.add(currentId);

      const where: Record<string, unknown> = {
        OR: [{ fromNodeId: currentId }, { toNodeId: currentId }],
      };
      if (edgeTypes?.length) {
        where.edgeType = { in: edgeTypes };
      }

      const edges = await prisma.knowledgeGraphEdge.findMany({ where });

      for (const edge of edges) {
        collectedEdges.push(parseEdge(edge));
        const neighborId = edge.fromNodeId === currentId ? edge.toNodeId : edge.fromNodeId;
        if (!visitedNodes.has(neighborId)) {
          nextFrontier.push(neighborId);
        }
      }
    }

    frontier = nextFrontier;
  }

  // ノードデータを取得
  const nodes = await prisma.knowledgeGraphNode.findMany({
    where: { id: { in: Array.from(visitedNodes) } },
  });

  // エッジの重複を除去
  const uniqueEdges = Array.from(new Map(collectedEdges.map((e) => [e.id, e])).values());

  return {
    nodes: nodes.map(parseNode),
    edges: uniqueEdges,
  };
}

/**
 * ノードを統合（2つのノードを1つにマージ）
 */
export async function mergeNodes(keepId: number, removeId: number) {
  // removeId のエッジを keepId に移行
  await prisma.knowledgeGraphEdge.updateMany({
    where: { fromNodeId: removeId },
    data: { fromNodeId: keepId },
  });
  await prisma.knowledgeGraphEdge.updateMany({
    where: { toNodeId: removeId },
    data: { toNodeId: keepId },
  });

  // 重複エッジを削除（自己ループ含む）
  await prisma.knowledgeGraphEdge.deleteMany({
    where: { fromNodeId: keepId, toNodeId: keepId },
  });

  // removeId を削除
  await prisma.knowledgeGraphNode.delete({ where: { id: removeId } });

  log.info({ keepId, removeId }, 'Nodes merged');
  return getNode(keepId);
}

/**
 * グラフ統計を取得
 */
export async function getGraphStats() {
  const [nodeCount, edgeCount, byType, byEdgeType] = await Promise.all([
    prisma.knowledgeGraphNode.count(),
    prisma.knowledgeGraphEdge.count(),
    prisma.knowledgeGraphNode.groupBy({
      by: ['nodeType'],
      _count: { id: true },
    }),
    prisma.knowledgeGraphEdge.groupBy({
      by: ['edgeType'],
      _count: { id: true },
    }),
  ]);

  return {
    nodeCount,
    edgeCount,
    byNodeType: Object.fromEntries(
      (byType as Array<{ nodeType: string; _count: { id: number } }>).map((t) => [
        t.nodeType,
        t._count.id,
      ]),
    ),
    byEdgeType: Object.fromEntries(
      (byEdgeType as Array<{ edgeType: string; _count: { id: number } }>).map((t) => [
        t.edgeType,
        t._count.id,
      ]),
    ),
  };
}

// --- Helper ---

function parseNode(raw: Record<string, unknown>): GraphNode {
  return {
    id: raw.id as number,
    label: raw.label as string,
    nodeType: raw.nodeType as KnowledgeNodeType,
    description: raw.description as string | null,
    properties:
      typeof raw.properties === 'string'
        ? JSON.parse(raw.properties)
        : (raw.properties as Record<string, unknown>),
    weight: raw.weight as number,
  };
}

function parseEdge(raw: Record<string, unknown>): GraphEdge {
  return {
    id: raw.id as number,
    fromNodeId: raw.fromNodeId as number,
    toNodeId: raw.toNodeId as number,
    edgeType: raw.edgeType as KnowledgeEdgeType,
    weight: raw.weight as number,
  };
}
