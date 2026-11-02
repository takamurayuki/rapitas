'use client';
/**
 * useSharedSchedules
 *
 * Someone else's month, when they have shared it (#1270).
 *
 * Schedule events only — no tasks, by design and by endpoint. The window is
 * the visible month with a week of slack either side, so an event that starts
 * in the previous month and runs into this one still draws its bar.
 *
 * A refusal is kept as a reason rather than an empty list: "they stopped
 * sharing" and "they have nothing on" must not look the same on screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import {
  scheduleToCalendarEvent,
  type CalendarEvent,
  type SchedulePresentation,
} from '../_utils/calendar-helpers';

const logger = createLogger('useSharedSchedules');

/** Days of slack either side of the visible month. */
const SLACK_DAYS = 7;

/** Why a shared month could not be read. */
export type SharedScheduleRefusal = 'no_session' | 'not_shared' | 'failed';

export interface SharedSchedulesState {
  events: CalendarEvent[];
  loading: boolean;
  /** Null while all is well. */
  refusal: SharedScheduleRefusal | null;
}

/**
 * Read one workspace's shared schedule events for the month on screen.
 *
 * @param ownerWorkspaceId - Whose calendar to read; null reads nothing / 対象のワークスペース（null なら何も読まない）
 * @param month - Any date inside the visible month / 表示中の月のいずれかの日付
 * @returns The events, loading state, and any refusal / 予定・読み込み状態・拒否理由
 */
export function useSharedSchedules(
  ownerWorkspaceId: number | null,
  month: Date,
): SharedSchedulesState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refusal, setRefusal] = useState<SharedScheduleRefusal | null>(null);

  // Month boundaries, not the Date itself, so a new Date for the same month
  // does not refetch.
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const load = useCallback(async () => {
    if (ownerWorkspaceId === null) {
      setEvents([]);
      setRefusal(null);
      return;
    }
    setLoading(true);
    try {
      const from = new Date(year, monthIndex, 1 - SLACK_DAYS);
      const to = new Date(year, monthIndex + 1, SLACK_DAYS);
      const query = `from=${from.toISOString()}&to=${to.toISOString()}`;
      const res = await fetch(
        `${API_BASE_URL}/calendar-shares/${ownerWorkspaceId}/schedules?${query}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { reason?: SharedScheduleRefusal };
        setEvents([]);
        setRefusal(body.reason ?? 'failed');
        return;
      }
      const body = (await res.json()) as { events?: SchedulePresentation[] };
      setEvents((body.events ?? []).map(scheduleToCalendarEvent));
      setRefusal(null);
    } catch (e) {
      logger.error('Failed to read a shared calendar:', e);
      setEvents([]);
      setRefusal('failed');
    } finally {
      setLoading(false);
    }
  }, [ownerWorkspaceId, year, monthIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  return { events, loading, refusal };
}
