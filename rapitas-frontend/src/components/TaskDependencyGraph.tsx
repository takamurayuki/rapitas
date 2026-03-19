'use client';

/**
 * TaskDependencyGraph
 *
 * Visualizes cross-task file dependency relationships as an interactive graph.
 * Uses SVG for rendering nodes and edges with depth-based layout.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GitBranch, AlertTriangle, Info } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type GraphNode = {
  id: number;
  title: string;
  depth: number;
  independenceScore: number;
  parallelizability: number;
  status: string;
  files: string[];
};

type GraphEdge = {
  fromTaskId: number;
  toTaskId: number;
  type: string;
  weight: number;
  sharedResources: string[];
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalPath: number[];
  maxDepth: number;
  plan: {
    parallelEfficiency: number;
    estimatedTotalDuration: number;
    maxConcurrency: number;
  };
  recommendations: string[];
  warnings: string[];
};

type Props = {
  themeId?: number;
  taskIds?: number[];
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#a1a1aa',
  scheduled: '#3b82f6',
  running: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  blocked: '#ef4444',
  todo: '#a1a1aa',
  'in-progress': '#f59e0b',
  done: '#10b981',
};

const EDGE_COLORS: Record<string, string> = {
  file_sharing: '#f59e0b',
  sequential: '#3b82f6',
  data_flow: '#8b5cf6',
  resource: '#ef4444',
  logical: '#6b7280',
};

export function TaskDependencyGraph({ themeId, taskIds }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (themeId) params.append('themeId', themeId.toString());
      params.append('limit', '30');

      const res = await fetch(`${API_BASE_URL}/parallel/dependency-graph?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setData(json.data);
      }
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, [themeId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  /** Layout nodes by depth level with vertical spacing. */
  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return { nodes: [], width: 0, height: 0 };

    const depthGroups = new Map<number, GraphNode[]>();
    for (const node of data.nodes) {
      const group = depthGroups.get(node.depth) || [];
      group.push(node);
      depthGroups.set(node.depth, group);
    }

    const nodeWidth = 140;
    const nodeHeight = 50;
    const xGap = 180;
    const yGap = 70;
    const padding = 40;

    const maxNodesInLevel = Math.max(...Array.from(depthGroups.values()).map((g) => g.length));
    const totalWidth = ((data.maxDepth || 0) + 1) * xGap + padding * 2;
    const totalHeight = maxNodesInLevel * yGap + padding * 2;

    const positions = new Map<number, { x: number; y: number }>();

    for (const [depth, nodes] of depthGroups) {
      const x = padding + depth * xGap;
      const groupHeight = nodes.length * yGap;
      const startY = (totalHeight - groupHeight) / 2;

      nodes.forEach((node, i) => {
        positions.set(node.id, { x, y: startY + i * yGap });
      });
    }

    return {
      nodes: data.nodes.map((n) => ({ ...n, pos: positions.get(n.id) || { x: 0, y: 0 } })),
      width: Math.max(totalWidth, 400),
      height: Math.max(totalHeight, 200),
      nodeWidth,
      nodeHeight,
      positions,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 animate-pulse">
        <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-40 mb-3" />
        <div className="h-48 bg-zinc-200 dark:bg-zinc-700 rounded" />
      </div>
    );
  }

  if (!data || data.nodes.length < 2) return null;

  const isCritical = (id: number) => data.criticalPath?.includes(id);
  const isConnectedToHovered = (nodeId: number) => {
    if (!hoveredNode) return false;
    return data.edges.some(
      (e) =>
        (e.fromTaskId === hoveredNode && e.toTaskId === nodeId) ||
        (e.toTaskId === hoveredNode && e.fromTaskId === nodeId),
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-500" />
            依存関係グラフ
          </h3>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span>{data.nodes.length}タスク</span>
            <span>{data.edges.length}依存</span>
            {data.plan && (
              <span className="text-emerald-600 dark:text-emerald-400">
                並列効率 {Math.round(data.plan.parallelEfficiency)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={layout.width}
          height={layout.height}
          className="min-w-full"
        >
          {/* Edges */}
          {data.edges.map((edge) => {
            const from = layout.positions?.get(edge.fromTaskId);
            const to = layout.positions?.get(edge.toTaskId);
            if (!from || !to) return null;

            const edgeKey = `${edge.fromTaskId}-${edge.toTaskId}`;
            const isHighlighted = hoveredEdge === edgeKey ||
              hoveredNode === edge.fromTaskId ||
              hoveredNode === edge.toTaskId;
            const color = EDGE_COLORS[edge.type] || '#6b7280';

            return (
              <g key={edgeKey}>
                <line
                  x1={from.x + 140}
                  y1={from.y + 25}
                  x2={to.x}
                  y2={to.y + 25}
                  stroke={color}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  strokeOpacity={isHighlighted ? 1 : 0.4}
                  strokeDasharray={edge.type === 'file_sharing' ? '' : '4 4'}
                  onMouseEnter={() => setHoveredEdge(edgeKey)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ cursor: 'pointer' }}
                />
                {/* Arrow */}
                <polygon
                  points={`${to.x},${to.y + 25} ${to.x - 8},${to.y + 20} ${to.x - 8},${to.y + 30}`}
                  fill={color}
                  opacity={isHighlighted ? 1 : 0.4}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {layout.nodes.map((node) => {
            const { pos } = node;
            const statusColor = STATUS_COLORS[node.status] || '#a1a1aa';
            const critical = isCritical(node.id);
            const highlighted = hoveredNode === node.id || isConnectedToHovered(node.id);
            const dimmed = hoveredNode !== null && !highlighted && hoveredNode !== node.id;

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'pointer' }}
                opacity={dimmed ? 0.3 : 1}
              >
                <rect
                  width={140}
                  height={50}
                  rx={8}
                  fill={critical ? '#1e1b4b' : '#18181b'}
                  stroke={critical ? '#818cf8' : statusColor}
                  strokeWidth={highlighted ? 2.5 : 1.5}
                />
                {/* Status indicator */}
                <circle cx={12} cy={14} r={4} fill={statusColor} />
                <text
                  x={22}
                  y={18}
                  fontSize={11}
                  fontWeight={600}
                  fill="#e4e4e7"
                  className="select-none"
                >
                  #{node.id}
                </text>
                <text
                  x={8}
                  y={36}
                  fontSize={10}
                  fill="#a1a1aa"
                  className="select-none"
                >
                  {node.title.length > 16 ? node.title.slice(0, 14) + '...' : node.title}
                </text>
                {/* Independence badge */}
                <text
                  x={118}
                  y={18}
                  fontSize={9}
                  fill={node.independenceScore > 70 ? '#10b981' : '#f59e0b'}
                  textAnchor="end"
                  className="select-none"
                >
                  {node.independenceScore}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend & Info */}
      <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-xs text-zinc-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />ファイル共有
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />順序依存
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />クリティカルパス
          </span>
        </div>
        {data.warnings.length > 0 && (
          <span className="flex items-center gap-1 text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            {data.warnings.length}件の警告
          </span>
        )}
      </div>

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700">
          {data.recommendations.slice(0, 2).map((r, i) => (
            <p key={i} className="text-xs text-zinc-500 dark:text-zinc-400 flex items-start gap-1.5 mb-1">
              <Info className="w-3 h-3 mt-0.5 text-blue-400 shrink-0" />
              {r}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
