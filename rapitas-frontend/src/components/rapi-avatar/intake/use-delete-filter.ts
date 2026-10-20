'use client';
/**
 * useDeleteFilter
 *
 * Previewing a bulk clear-out, then removing what the user approved.
 *
 * The filter only ever builds a list. Deletion runs against the ids that came
 * back and are still ticked — the conditions are never re-evaluated server
 * side, so nothing can be removed that was not on screen. When more matched
 * than the preview carries, only the listed ones go and the rest wait for
 * another pass.
 *
 * Removals are sent in batches because the delete route caps a call at 50,
 * and the trash ids from every batch are kept so one undo puts all of it back.
 */
import { useCallback, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { DeletionResult } from './use-delete-proposal';

const logger = createLogger('rapi-bulk-cleanup');

/** The delete route's per-call ceiling. */
const BATCH_SIZE = 50;

export interface FilterMatch {
  id: number;
  title: string;
  status: string;
  updatedAt: string;
}

export interface DeleteFilterCriteria {
  themeId?: number;
  statuses: string[];
  updatedBeforeDays?: number;
}

export interface UseDeleteFilter {
  matches: FilterMatch[];
  chosen: Set<number>;
  /** Everything the conditions matched, which may exceed what is listed. */
  total: number;
  /** True when more matched than the preview carries. */
  truncated: boolean;
  /** Protected tasks the conditions hit, which will not be removed. */
  excludedProtected: number;
  previewing: boolean;
  removing: boolean;
  /** How far through the batches, for a clear-out of hundreds. */
  progress: { done: number; of: number } | null;
  error: boolean;
  results: DeletionResult[] | null;
  undoable: number[];
  preview: (criteria: DeleteFilterCriteria) => Promise<void>;
  toggle: (id: number) => void;
  removeChosen: () => Promise<void>;
  undo: () => Promise<void>;
  reset: () => void;
}

/**
 * Preview a bulk clear-out and carry it out in batches.
 *
 * @returns The matches, the selection, and the actions / 該当・選択・操作
 */
export function useDeleteFilter(): UseDeleteFilter {
  const [matches, setMatches] = useState<FilterMatch[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [excludedProtected, setExcludedProtected] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState(false);
  const [results, setResults] = useState<DeletionResult[] | null>(null);
  const [undoable, setUndoable] = useState<number[]>([]);

  const reset = useCallback(() => {
    setMatches([]);
    setChosen(new Set());
    setTotal(0);
    setTruncated(false);
    setExcludedProtected(0);
    setResults(null);
    setUndoable([]);
    setProgress(null);
    setError(false);
  }, []);

  const preview = useCallback(async (criteria: DeleteFilterCriteria) => {
    setPreviewing(true);
    setError(false);
    setResults(null);
    setUndoable([]);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/delete-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criteria),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        matches?: FilterMatch[];
        total?: number;
        truncated?: boolean;
        excludedProtected?: number;
      };
      const list = data.matches ?? [];
      setMatches(list);
      setChosen(new Set(list.map((m) => m.id)));
      setTotal(data.total ?? list.length);
      setTruncated(data.truncated ?? false);
      setExcludedProtected(data.excludedProtected ?? 0);
    } catch (err) {
      logger.warn({ err }, 'delete filter preview failed');
      setMatches([]);
      setError(true);
    } finally {
      setPreviewing(false);
    }
  }, []);

  const toggle = useCallback((id: number) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeChosen = useCallback(async () => {
    // Only ids that were listed AND are still ticked. Never the conditions.
    const ids = matches.map((m) => m.id).filter((id) => chosen.has(id));
    if (ids.length === 0) return;

    setRemoving(true);
    setError(false);
    const collected: DeletionResult[] = [];
    const trashIds: number[] = [];
    const batches = Math.ceil(ids.length / BATCH_SIZE);
    setProgress({ done: 0, of: batches });

    try {
      for (let i = 0; i < batches; i += 1) {
        const batch = ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const res = await fetch(`${API_BASE_URL}/assistant/task-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true, taskIds: batch }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results?: DeletionResult[] };
        for (const r of data.results ?? []) {
          collected.push(r);
          if (r.trashId !== undefined) trashIds.push(r.trashId);
        }
        setProgress({ done: i + 1, of: batches });
      }
      setResults(collected);
      setUndoable(trashIds);
      setMatches([]);
      setChosen(new Set());
    } catch (err) {
      // Whatever already went is in the trash and is reported, so a failure
      // part-way through is recoverable rather than a mystery.
      logger.warn({ err, removed: collected.length }, 'bulk removal stopped early');
      setResults(collected);
      setUndoable(trashIds);
      setError(true);
    } finally {
      setRemoving(false);
    }
  }, [matches, chosen]);

  const undo = useCallback(async () => {
    if (undoable.length === 0) return;
    setRemoving(true);
    try {
      for (const trashId of undoable) {
        await fetch(`${API_BASE_URL}/task-trash/${trashId}/restore`, { method: 'POST' });
      }
      setUndoable([]);
      setResults(null);
    } catch (err) {
      logger.warn({ err }, 'undo failed');
      setError(true);
    } finally {
      setRemoving(false);
    }
  }, [undoable]);

  const removable = useMemo(() => chosen.size > 0, [chosen]);

  return {
    matches,
    chosen,
    total,
    truncated,
    excludedProtected,
    previewing,
    removing,
    progress,
    error,
    results,
    undoable,
    preview,
    toggle,
    removeChosen: removable ? removeChosen : async () => {},
    undo,
    reset,
  };
}
