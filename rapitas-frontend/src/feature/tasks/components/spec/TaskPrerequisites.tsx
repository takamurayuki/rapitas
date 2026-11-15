'use client';
/**
 * TaskPrerequisites
 *
 * The tasks a task waits for before it starts (開始条件, #1559), in the task
 * detail's spec section: each with whether it is done, and a small editor
 * that takes task numbers. Auto-run does not start the task until every one
 * is done, and the server refuses itself, unknown tasks and cycles with a
 * message this shows as is. Not responsible for the start conditions in words.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';

interface Prerequisite {
  id: number;
  title: string;
  status: string;
}

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
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/dependencies`);
      if (!res.ok) return;
      const body = (await res.json()) as { prerequisites?: Prerequisite[] };
      const list = body.prerequisites ?? [];
      setItems(list);
      setDraft(list.map((p) => p.id).join(', '));
    } catch {
      // Shown as none; the editor still works.
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/dependencies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOn: parseTaskNumbers(draft) }),
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

  return (
    <div data-prerequisites>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
        {t('prerequisites')}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('prerequisitesNone')}</p>
      ) : (
        <ul className="space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
          {items.map((p) => (
            <li key={p.id} data-prerequisite={p.id}>
              #{p.id} {p.title}
              <span
                className={`ml-2 text-xs ${p.status === 'done' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}
              >
                {p.status === 'done' ? t('prerequisiteDone') : t('prerequisiteOpen')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('prerequisitesInput')}
          aria-label={t('prerequisitesInput')}
          className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {t('prerequisitesSave')}
        </button>
      </div>
    </div>
  );
}
