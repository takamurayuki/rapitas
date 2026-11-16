'use client';
/**
 * TaskPrerequisites
 *
 * The tasks a task waits for before it starts (開始条件, #1559), in the task
 * detail's spec section: each with whether it is done, added by searching
 * titles or a number and removed one at a time, each change saved at once.
 * Auto-run does not start the task until every one is done, and the server
 * refuses itself, unknown tasks and cycles with a message this shows as is.
 * Not responsible for the start conditions in words.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { PrerequisiteSearch, type PrerequisiteCandidate } from './PrerequisiteSearch';

type Prerequisite = PrerequisiteCandidate;

/** Task numbers from "12, #13 14" — anything that is not a positive integer is dropped. */
export function parseTaskNumbers(raw: string): number[] {
  return [
    ...new Set(
      raw
        .split(/[\s,、]+/)
        .map((s) => Number(s.replace(/^#/, '')))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

/**
 * @param props.taskId - The task that waits / 待つタスク
 */
export function TaskPrerequisites({ taskId }: { taskId: number }) {
  const t = useTranslations('task');
  const { showToast } = useToast();
  const [items, setItems] = useState<Prerequisite[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/dependencies`);
      if (!res.ok) return;
      const body = (await res.json()) as { prerequisites?: Prerequisite[] };
      setItems(body.prerequisites ?? []);
    } catch {
      // Shown as none; the editor still works.
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list is only replaced by what the server saved, so a refusal leaves it as it was.
  const save = async (ids: number[]) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/dependencies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOn: ids }),
      });
      const body = (await res.json().catch(() => null)) as {
        prerequisites?: Prerequisite[];
        error?: string;
      } | null;
      if (!res.ok) {
        showToast(body?.error ?? t('prerequisitesSaveFailed'), 'error');
        return;
      }
      setItems(body?.prerequisites ?? []);
      showToast(t('prerequisitesSaved'), 'success');
    } catch {
      showToast(t('prerequisitesSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const ids = items.map((p) => p.id);
  return (
    <div data-prerequisites className="space-y-2">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('prerequisites')}</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('prerequisitesNone')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((p) => (
            <li
              key={p.id}
              data-prerequisite={p.id}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 pl-2 pr-1 py-0.5 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <span className="text-xs text-zinc-400">#{p.id}</span>
              <span className="max-w-[16rem] truncate">{p.title}</span>
              <span
                className={`text-xs ${p.status === 'done' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}
              >
                {p.status === 'done' ? t('prerequisiteDone') : t('prerequisiteOpen')}
              </span>
              <button
                type="button"
                onClick={() => void save(ids.filter((id) => id !== p.id))}
                disabled={saving}
                aria-label={`${t('prerequisitesRemove')} #${p.id}`}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PrerequisiteSearch
        excludeIds={[taskId, ...ids]}
        onPick={(c) => void save([...ids, c.id])}
        disabled={saving}
      />
    </div>
  );
}
