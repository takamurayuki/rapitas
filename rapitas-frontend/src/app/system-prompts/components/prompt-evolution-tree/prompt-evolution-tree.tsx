'use client';

/**
 * PromptEvolutionTree
 *
 * Orchestrator for the lineage-tree tab (task #937): fetches the tree via
 * usePromptEvolutionTree, flattens it for rendering, and delegates each row
 * to PromptEvolutionTreeNodeRow. Minimal logic here — data fetching lives in
 * the hook, per-row detail/revalidate lives in the node component.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { GitGraph } from 'lucide-react';
import { usePromptEvolutionTree } from './use-prompt-evolution-tree';
import { PromptEvolutionTreeNodeRow } from './prompt-evolution-tree-node';
import { flattenTree } from './prompt-evolution-tree.utils';

export function PromptEvolutionTree() {
  const t = useTranslations('prompts.promptEvolution.tree');
  const { roots, loading, loadFailed, revalidating, revalidateNode } = usePromptEvolutionTree();

  const rows = useMemo(() => (roots ? flattenTree(roots) : []), [roots]);

  if (loading) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        <GitGraph className="h-4 w-4 text-zinc-400" />
        {t('title')}
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>

      {loadFailed ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('loadFailed')}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('empty')}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-1 dark:border-zinc-700 dark:bg-zinc-800">
          {rows.map(({ node, depth }) => (
            <PromptEvolutionTreeNodeRow
              key={node.id}
              node={node}
              depth={depth}
              revalidating={revalidating === node.id}
              onRevalidate={revalidateNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
