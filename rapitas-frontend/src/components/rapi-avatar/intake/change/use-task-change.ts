'use client';
/**
 * useTaskChange
 *
 * ラピ changing an existing task (#1119 stage 6): ask what a sentence means,
 * apply it only when the user presses the button, and undo it.
 *
 * Mirrors the delete flow's separation. `POST /assistant/update-draft` writes
 * nothing; `apply()` is the only path to `POST /assistant/task-update` and
 * sends the change on the card the user is looking at, with `confirmed`.
 */
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rapi-change');

/** The fields ラピ may change, as the server validates them. */
export interface TaskChanges {
  status?: 'todo' | 'in-progress' | 'done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  themeId?: number | null;
  dueDate?: string | null;
}

/** A checked proposal from the server. */
export interface ChangeProposal {
  taskId: number;
  title: string;
  changes: TaskChanges;
  reason: string;
}

export interface UseTaskChange {
  proposal: ChangeProposal | null;
  unclear: string[];
  proposing: boolean;
  applying: boolean;
  /** Set once applied: the audit id undo needs, and the values replaced. */
  applied: { actionId: number; before: Record<string, unknown> } | null;
  undone: boolean;
  /** Fields someone edited after ラピ did, when the undo was refused. */
  conflicts: string[];
  error: boolean;
  propose: (text: string) => Promise<void>;
  apply: () => Promise<void>;
  undo: () => Promise<void>;
  reset: () => void;
}

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/assistant${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

/**
 * Propose, apply and undo one change to one task.
 *
 * @returns State and the four actions / 状態と4つの操作
 */
export function useTaskChange(): UseTaskChange {
  const [proposal, setProposal] = useState<ChangeProposal | null>(null);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<UseTaskChange['applied']>(null);
  const [undone, setUndone] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState(false);

  const reset = useCallback(() => {
    setProposal(null);
    setUnclear([]);
    setApplied(null);
    setUndone(false);
    setConflicts([]);
    setError(false);
  }, []);

  const propose = useCallback(
    async (text: string) => {
      reset();
      setProposing(true);
      try {
        const { status, data } = await post('/update-draft', { text });
        const p = data.proposal as
          | ({ kind: 'proposal' } & ChangeProposal)
          | { kind: 'unclear'; unclear: string[] }
          | undefined;
        if (status >= 400 || !p) setError(true);
        else if (p.kind === 'proposal') {
          setProposal({ taskId: p.taskId, title: p.title, changes: p.changes, reason: p.reason });
        } else setUnclear(p.unclear);
      } catch (err) {
        logger.warn('update draft failed', err);
        setError(true);
      } finally {
        setProposing(false);
      }
    },
    [reset],
  );

  const apply = useCallback(async () => {
    if (!proposal) return;
    setApplying(true);
    try {
      const { status, data } = await post('/task-update', {
        taskId: proposal.taskId,
        changes: proposal.changes,
        confirmed: true,
      });
      if (status >= 400) setError(true);
      else
        setApplied({
          actionId: data.actionId as number,
          before: (data.before ?? {}) as Record<string, unknown>,
        });
    } catch (err) {
      logger.warn('task update failed', err);
      setError(true);
    } finally {
      setApplying(false);
    }
  }, [proposal]);

  const undo = useCallback(async () => {
    if (!applied) return;
    try {
      const { status, data } = await post('/task-update/revert', { actionId: applied.actionId });
      if (status === 409) setConflicts((data.conflicts as string[]) ?? []);
      else if (status >= 400) setError(true);
      else setUndone(true);
    } catch (err) {
      logger.warn('task update undo failed', err);
      setError(true);
    }
  }, [applied]);

  return {
    proposal,
    unclear,
    proposing,
    applying,
    applied,
    undone,
    conflicts,
    error,
    propose,
    apply,
    undo,
    reset,
  };
}
