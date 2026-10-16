'use client';
/**
 * LineageGraph
 *
 * Self-drawn SVG (no graph library) of the subgraph under the root-cause
 * candidates: columns = depth, edges labelled with their estimated
 * confidence, candidate nodes highlighted. The hierarchical list is the
 * canonical view; this is a visual aid capped at MAX_GRAPH_NODES.
 */
import { useTranslations } from 'next-intl';
import type { LineageRow } from '../types';
import { formatConfidence } from '../failure-lineage.utils';

interface LineageGraphProps {
  rows: LineageRow[];
}

/** Node cap keeps the SVG responsive; the list still shows everything. */
export const MAX_GRAPH_NODES = 40;
const COL_W = 190;
const ROW_H = 44;
const NODE_W = 150;
const NODE_H = 28;

export function LineageGraph({ rows }: LineageGraphProps) {
  const t = useTranslations('agents.failureLineage');
  const shown = rows.slice(0, MAX_GRAPH_NODES);
  if (shown.length === 0) return null;
  const pos = new Map(
    shown.map((r, i) => [r.node.id, { x: 10 + Math.min(r.depth, 6) * COL_W, y: 10 + i * ROW_H }]),
  );
  const width = 20 + 7 * COL_W;
  const height = 20 + shown.length * ROW_H;

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800">
      <svg
        data-testid="lineage-graph"
        role="img"
        aria-label={t('graphLabel')}
        width={width}
        height={height}
      >
        {shown.map((r) => {
          const edge = r.parentEdge;
          const from = edge ? pos.get(edge.parentId) : undefined;
          const to = pos.get(r.node.id);
          if (!edge || !from || !to) return null;
          return (
            <g key={`e-${r.node.id}`}>
              <line
                x1={from.x + NODE_W}
                y1={from.y + NODE_H / 2}
                x2={to.x}
                y2={to.y + NODE_H / 2}
                strokeDasharray="4 3"
                className="stroke-zinc-400 dark:stroke-zinc-500"
              />
              <text
                x={(from.x + NODE_W + to.x) / 2}
                y={(from.y + to.y) / 2 + NODE_H / 2 - 3}
                fontSize="10"
                textAnchor="middle"
                className="fill-zinc-500 dark:fill-zinc-400"
              >
                {formatConfidence(edge.confidence)}
              </text>
            </g>
          );
        })}
        {shown.map((r) => {
          const p = pos.get(r.node.id);
          if (!p) return null;
          const candidate = r.reducedCount !== null;
          return (
            <g key={`n-${r.node.id}`} data-candidate={candidate ? 'true' : 'false'}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                strokeWidth={candidate ? 2.5 : 1}
                className={
                  candidate
                    ? 'fill-rose-50 stroke-rose-500 dark:fill-rose-900/30 dark:stroke-rose-400'
                    : 'fill-zinc-50 stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-600'
                }
              />
              <text
                x={p.x + 6}
                y={p.y + NODE_H / 2 + 4}
                fontSize="10"
                className="fill-zinc-800 dark:fill-zinc-200"
              >
                {r.node.template.slice(0, 24)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
