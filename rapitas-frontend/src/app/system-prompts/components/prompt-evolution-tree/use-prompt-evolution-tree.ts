'use client';

/**
 * usePromptEvolutionTree
 *
 * Fetches `GET /learning/prompt-evolution/tree` and exposes a manual
 * per-node revalidate action (`POST .../:id/revalidate`) that patches the
 * returned node in place rather than refetching the whole tree.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type {
  PromptEvolutionTreeNode,
  PromptEvolutionTreeResponse,
} from './prompt-evolution-tree.types';

const logger = createLogger('usePromptEvolutionTree');

/** Outcome of a manual revalidate call, surfaced to the caller for a toast. */
export type RevalidateOutcome =
  | { ok: true; treeConfidence: PromptEvolutionTreeNode['treeConfidence'] }
  | { ok: false; reason: 'not_found' | 'not_applicable' | 'error' };

function replaceNodeConfidence(
  nodes: PromptEvolutionTreeNode[],
  id: number,
  treeConfidence: PromptEvolutionTreeNode['treeConfidence'],
): PromptEvolutionTreeNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, treeConfidence };
    if (node.children.length === 0) return node;
    return { ...node, children: replaceNodeConfidence(node.children, id, treeConfidence) };
  });
}

export interface UsePromptEvolutionTreeResult {
  roots: PromptEvolutionTreeNode[] | null;
  loading: boolean;
  loadFailed: boolean;
  refetch: () => void;
  revalidating: number | null;
  revalidateNode: (id: number) => Promise<RevalidateOutcome>;
}

/**
 * Loads the prompt-evolution lineage tree, optionally scoped to one
 * basePromptKey.
 *
 * @param basePromptKey - Optional lineage-group filter. / 絞り込み対象のグルーピングキー
 * @returns Tree state and actions. / ツリー状態と操作
 */
export function usePromptEvolutionTree(basePromptKey?: string): UsePromptEvolutionTreeResult {
  const [roots, setRoots] = useState<PromptEvolutionTreeNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [revalidating, setRevalidating] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    const url = new URL(`${API_BASE_URL}/learning/prompt-evolution/tree`);
    if (basePromptKey) url.searchParams.set('basePromptKey', basePromptKey);
    fetch(url.toString())
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as PromptEvolutionTreeResponse;
      })
      .then((v) => {
        if (cancelled) return;
        setRoots(v.roots);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to fetch prompt evolution tree:', err);
        setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [basePromptKey, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  const revalidateNode = useCallback(async (id: number): Promise<RevalidateOutcome> => {
    setRevalidating(id);
    try {
      const res = await fetch(`${API_BASE_URL}/learning/prompt-evolution/${id}/revalidate`, {
        method: 'POST',
      });
      if (res.status === 404) return { ok: false, reason: 'not_found' };
      if (res.status === 409) return { ok: false, reason: 'not_applicable' };
      if (!res.ok) return { ok: false, reason: 'error' };
      const body = (await res.json()) as {
        treeConfidence: PromptEvolutionTreeNode['treeConfidence'];
      };
      setRoots((prev) => (prev ? replaceNodeConfidence(prev, id, body.treeConfidence) : prev));
      return { ok: true, treeConfidence: body.treeConfidence };
    } catch (err) {
      logger.error('Failed to revalidate prompt evolution node:', err);
      return { ok: false, reason: 'error' };
    } finally {
      setRevalidating(null);
    }
  }, []);

  return { roots, loading, loadFailed, refetch, revalidating, revalidateNode };
}
