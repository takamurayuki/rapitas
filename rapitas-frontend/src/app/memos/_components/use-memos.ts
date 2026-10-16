/**
 * useMemos
 *
 * List view model for the /memos page: filtered fetch, add, done toggle,
 * reminder update, and delete against the /memos API.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { Memo, MemoFilter } from './memo.types';

/**
 * Provide memo list state and handlers.
 *
 * @returns Memos, filter state, and CRUD handlers. / メモ一覧・フィルタ・操作。
 */
export function useMemos() {
  const t = useTranslations('memos');
  const { showToast } = useToast();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [filter, setFilter] = useState<MemoFilter>('open');
  const [isLoading, setIsLoading] = useState(true);

  const fetchMemos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/memos?filter=${filter}`);
      if (res.ok) setMemos((await res.json()) as Memo[]);
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setIsLoading(true);
    fetchMemos();
  }, [fetchMemos]);

  const addMemo = useCallback(
    async (content: string, remindAt: Date | null) => {
      if (!content.trim()) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/memos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: content.trim(),
            remindAt: remindAt ? remindAt.toISOString() : null,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchMemos();
        return true;
      } catch {
        showToast(t('messages.saveFailed'), 'error');
        return false;
      }
    },
    [fetchMemos, showToast, t],
  );

  const patchMemo = useCallback(
    async (id: number, payload: { isDone?: boolean; remindAt?: string | null }) => {
      try {
        const res = await fetch(`${API_BASE_URL}/memos/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchMemos();
        return true;
      } catch {
        showToast(t('messages.saveFailed'), 'error');
        return false;
      }
    },
    [fetchMemos, showToast, t],
  );

  const toggleDone = useCallback(
    (memo: Memo) => patchMemo(memo.id, { isDone: !memo.isDone }),
    [patchMemo],
  );

  const deleteMemo = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/memos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setMemos((prev) => prev.filter((m) => m.id !== id));
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      }
    },
    [showToast, t],
  );

  return { memos, filter, setFilter, isLoading, addMemo, toggleDone, patchMemo, deleteMemo };
}
