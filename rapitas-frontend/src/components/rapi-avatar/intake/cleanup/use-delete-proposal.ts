'use client';
/**
 * useDeleteProposal
 *
 * Asking ラピ which tasks to clear away, and — separately, only once the
 * user has ticked them — removing those.
 *
 * The separation is the whole point. `POST /assistant/delete-draft` writes
 * nothing; `POST /assistant/task-delete` is reached only through `remove()`,
 * carries the confirmation, and is given the ids the user actually left
 * ticked, not the ids that were proposed.
 */
import { useCallback, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rapi-delete');

/** One task ラピ suggests removing. */
export interface DeleteCandidate {
  id: number;
  title: string;
  status: string;
  themeId: number | null;
  reason: string;
}

/** What happened to one task when the removal ran. */
export interface DeletionResult {
  taskId: number;
  outcome: 'deleted' | 'protected' | 'not_found' | 'failed';
  trashId?: number;
}

export interface UseDeleteProposal {
  candidates: DeleteCandidate[];
  /** The ids still ticked — what will actually be removed. */
  chosen: Set<number>;
  /** How many tasks ラピ weighed, so the UI need not imply it saw them all. */
  considered: number;
  unclear: string[];
  /** False when the model could not be reached; the list is then empty by default, not because nothing matched. */
  available: boolean;
  proposing: boolean;
  removing: boolean;
  error: boolean;
  results: DeletionResult[] | null;
  /** Trash rows from the last removal, for the undo. */
  undoable: number[];
  propose: (text: string) => Promise<void>;
  toggle: (id: number) => void;
  remove: () => Promise<void>;
  undo: () => Promise<void>;
  reset: () => void;
}

/**
 * Ask which tasks should go, then remove the ones the user confirms.
 *
 * @returns The proposal, the user's selection, and the three actions / 提案・選択・3つの操作
 */
export function useDeleteProposal(): UseDeleteProposal {
  const [candidates, setCandidates] = useState<DeleteCandidate[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [considered, setConsidered] = useState(0);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [available, setAvailable] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(false);
  const [results, setResults] = useState<DeletionResult[] | null>(null);
  const [undoable, setUndoable] = useState<number[]>([]);

  const reset = useCallback(() => {
    setCandidates([]);
    setChosen(new Set());
    setUnclear([]);
    setResults(null);
    setUndoable([]);
    setError(false);
  }, []);

  const propose = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setProposing(true);
    setError(false);
    setResults(null);
    setUndoable([]);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/delete-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        candidates?: DeleteCandidate[];
        considered?: number;
        unclear?: string[];
        available?: boolean;
      };
      const list = data.candidates ?? [];
      setCandidates(list);
      // Pre-ticked, because the user asked for these to go — but every one is
      // visible and unticking is a click.
      setChosen(new Set(list.map((c) => c.id)));
      setConsidered(data.considered ?? 0);
      setUnclear(data.unclear ?? []);
      setAvailable(data.available !== false);
    } catch (err) {
      logger.warn({ err }, 'delete proposal failed');
      setCandidates([]);
      setError(true);
    } finally {
      setProposing(false);
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

  const remove = useCallback(async () => {
    const taskIds = candidates.map((c) => c.id).filter((id) => chosen.has(id));
    // Guarded here as well as in the UI: an empty list must never reach a
    // delete endpoint, whatever path gets here.
    if (taskIds.length === 0) return;
    setRemoving(true);
    setError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/task-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true, taskIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: DeletionResult[] };
      const done = data.results ?? [];
      setResults(done);
      setUndoable(done.filter((r) => r.trashId !== undefined).map((r) => r.trashId as number));
      setCandidates([]);
      setChosen(new Set());
    } catch (err) {
      logger.warn({ err }, 'deletion failed');
      setError(true);
    } finally {
      setRemoving(false);
    }
  }, [candidates, chosen]);

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
    candidates,
    chosen,
    considered,
    unclear,
    available,
    proposing,
    removing,
    error,
    results,
    undoable,
    propose,
    toggle,
    remove: removable ? remove : async () => {},
    undo,
    reset,
  };
}
