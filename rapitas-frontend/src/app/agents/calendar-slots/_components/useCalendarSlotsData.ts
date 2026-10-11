/**
 * useCalendarSlotsData
 *
 * Loads the calendar-slot dashboard data (next runs, sync state, one page of
 * the execution log) from the backend and exposes paging + reload.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { NextRunsResponse, SlotLogsResponse, SyncStateResponse } from './calendar-slots-types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Fetch and hold the dashboard state.
 *
 * @param page - 1-based log page / ログのページ番号
 * @param limit - Log rows per page / 1ページの件数
 * @returns Data, loading/error flags and a reload function / データと状態
 */
export function useCalendarSlotsData(page: number, limit: number) {
  const [nextRuns, setNextRuns] = useState<NextRunsResponse | null>(null);
  const [syncState, setSyncState] = useState<SyncStateResponse | null>(null);
  const [logs, setLogs] = useState<SlotLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [n, s, l] = await Promise.all([
        getJson<NextRunsResponse>('/calendar-slots/next-runs'),
        getJson<SyncStateResponse>('/calendar-slots/sync-state'),
        getJson<SlotLogsResponse>(`/calendar-slots/logs?page=${page}&limit=${limit}`),
      ]);
      setNextRuns(n);
      setSyncState(s);
      setLogs(l);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { nextRuns, syncState, logs, loading, error, reload };
}
