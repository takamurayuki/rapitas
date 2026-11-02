'use client';
/**
 * useTaskDraft
 *
 * Holds the two halves of ラピ filing a task: asking the backend what it
 * understood, and — separately, only when the user says so — creating it.
 *
 * The separation is the point. `POST /assistant/task-draft` writes nothing;
 * `POST /tasks` is reached only through `file()`, and only once the user has
 * supplied whatever the draft could not work out. What is filed is the draft
 * as edited, never as proposed.
 *
 * Not responsible for drawing any of it.
 */
import { useCallback, useMemo, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import {
  isFileable,
  type DraftSource,
  type EditableDraft,
  type TaskDraft,
} from './task-draft-types';

const logger = createLogger('rapi-intake');

/** Turn a draft into the form the user edits. */
function toEditable(draft: TaskDraft): EditableDraft {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    dueDate: draft.dueDate,
    estimatedHours: draft.estimatedHours,
    themeId: draft.themeId,
    acceptanceCriteria: draft.acceptanceCriteria,
  };
}

export interface UseTaskDraft {
  /** What was proposed, kept so the UI can show the reasons beside each field. */
  draft: TaskDraft | null;
  /** Which reader produced it, so a weaker fallback draft can say so. */
  source: DraftSource | null;
  /** The same draft as the user now has it. */
  edited: EditableDraft | null;
  proposing: boolean;
  filing: boolean;
  error: boolean;
  /** Set once a task has been created, so the UI can link to it. */
  filedTaskId: number | null;
  fileable: boolean;
  propose: (text: string) => Promise<void>;
  edit: (patch: Partial<EditableDraft>) => void;
  file: () => Promise<void>;
  reset: () => void;
}

/**
 * Ask ラピ what it understood, then file it if the user approves.
 *
 * @returns The draft, what the user has changed, and the two actions / 下書き・編集内容・2つの操作
 */
export function useTaskDraft(): UseTaskDraft {
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [source, setSource] = useState<DraftSource | null>(null);
  const [edited, setEdited] = useState<EditableDraft | null>(null);
  const [proposing, setProposing] = useState(false);
  const [filing, setFiling] = useState(false);
  const [error, setError] = useState(false);
  const [filedTaskId, setFiledTaskId] = useState<number | null>(null);

  const reset = useCallback(() => {
    setDraft(null);
    setSource(null);
    setEdited(null);
    setError(false);
    setFiledTaskId(null);
  }, []);

  const propose = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setProposing(true);
    setError(false);
    setFiledTaskId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/task-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { draft: TaskDraft; source?: DraftSource };
      setDraft(data.draft);
      setSource(data.source ?? null);
      setEdited(toEditable(data.draft));
    } catch (err) {
      // Nothing was created, so there is nothing to undo — say so and stop.
      logger.warn({ err }, 'task draft failed');
      setDraft(null);
      setSource(null);
      setEdited(null);
      setError(true);
    } finally {
      setProposing(false);
    }
  }, []);

  const edit = useCallback((patch: Partial<EditableDraft>) => {
    setEdited((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const fileable = useMemo(() => (edited ? isFileable(edited) : false), [edited]);

  const file = useCallback(async () => {
    // Guarded here as well as in the UI: a draft missing its theme must not
    // become a task with a guessed one, whatever path reaches this.
    if (!edited || !isFileable(edited)) return;
    setFiling(true);
    setError(false);
    try {
      // Through ラピ's own surface rather than the general task API: that
      // route checks the act against the capability registry and refuses to
      // run without the confirmation this flag carries.
      const res = await fetch(`${API_BASE_URL}/assistant/task-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          task: {
            title: edited.title.trim(),
            themeId: edited.themeId,
            ...(edited.description ? { description: edited.description } : {}),
            ...(edited.priority ? { priority: edited.priority } : {}),
            ...(edited.dueDate ? { dueDate: edited.dueDate } : {}),
            ...(edited.estimatedHours ? { estimatedHours: edited.estimatedHours } : {}),
            ...(edited.acceptanceCriteria?.length
              ? { acceptanceCriteria: edited.acceptanceCriteria }
              : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as { id?: number };
      setFiledTaskId(created.id ?? null);
      setDraft(null);
      setEdited(null);
    } catch (err) {
      logger.warn({ err }, 'filing the draft failed');
      setError(true);
    } finally {
      setFiling(false);
    }
  }, [edited]);

  return {
    draft,
    source,
    edited,
    proposing,
    filing,
    error,
    filedTaskId,
    fileable,
    propose,
    edit,
    file,
    reset,
  };
}
