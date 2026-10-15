'use client';
/**
 * LineageTreeList
 *
 * Hierarchical text list of the estimated lineage (the canonical view — the
 * SVG graph is an aid). Each child row shows its estimated confidence and
 * evidence class; root-cause candidates are highlighted with the estimated
 * number of downstream events a fix would remove.
 */
import { useTranslations } from 'next-intl';
import type { LineageRow } from '../types';
import { formatConfidence } from '../failure-lineage.utils';

interface LineageTreeListProps {
  rows: LineageRow[];
}

/** Max visual indentation steps so deep chains stay readable. */
const MAX_INDENT = 8;

export function LineageTreeList({ rows }: LineageTreeListProps) {
  const t = useTranslations('agents.failureLineage');
  return (
    <ul className="space-y-1" data-testid="lineage-tree">
      {rows.map(({ node, depth, parentEdge, reducedCount }) => {
        const isCandidate = reducedCount !== null;
        return (
          <li
            key={node.id}
            data-testid="lineage-row"
            data-candidate={isCandidate ? 'true' : 'false'}
            style={{ marginLeft: `${Math.min(depth, MAX_INDENT) * 16}px` }}
            className={
              isCandidate
                ? 'rounded-lg border-2 border-rose-400 bg-rose-50 p-2 dark:border-rose-500 dark:bg-rose-900/20'
                : 'rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800'
            }
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={
                  node.level === 'ERROR'
                    ? 'rounded px-1.5 py-0.5 font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    : 'rounded px-1.5 py-0.5 font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                }
              >
                {node.level}
              </span>
              {isCandidate && (
                <span
                  data-testid="candidate-badge"
                  className="rounded px-1.5 py-0.5 font-semibold bg-rose-600 text-white dark:bg-rose-500"
                >
                  {t('candidateBadge')}
                </span>
              )}
              {parentEdge && (
                <span
                  data-testid="edge-confidence"
                  className="text-zinc-500 dark:text-zinc-400"
                  title={t('estimatedRelation')}
                >
                  {t('edgeConfidence', {
                    confidence: formatConfidence(parentEdge.confidence),
                    basis: t(`basis.${parentEdge.basis}`),
                  })}
                </span>
              )}
              <span className="text-zinc-400 dark:text-zinc-500">
                {new Date(node.timestamp).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 break-words font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {node.template}
            </p>
            {isCandidate && (
              <p
                data-testid="reduced-estimate"
                className="mt-1 text-xs font-semibold text-rose-700 dark:text-rose-300"
              >
                {t('reducedEstimate', { count: reducedCount })}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
