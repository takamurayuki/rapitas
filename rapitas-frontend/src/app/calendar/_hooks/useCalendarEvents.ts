/**
 * useCalendarEvents
 *
 * Manages all server-state and mutation logic for the calendar page.
 * Composes task cache, exam goals, schedules, and paid leave data into a
 * unified CalendarEvent list.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ExamGoal, ScheduleEvent, ScheduleEventInput, PaidLeaveBalance } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useTaskAutoSync } from '@/hooks/task/useTaskAutoSync';
import { createLogger } from '@/lib/logger';
import type { CalendarEvent } from '../_utils/calendar-helpers';

const logger = createLogger('useCalendarEvents');
const API_BASE = API_BASE_URL;

/**
 * Central hook for the calendar page's data and mutations.
 *
 * @returns All event state, loading flags, and CRUD handlers.
 */
export function useCalendarEvents() {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const { showToast } = useToast();
  const cachedTasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamGoal[]>([]);
  const [schedules, setSchedules] = useState<ScheduleEvent[]>([]);
  const [paidLeaveBalance, setPaidLeaveBalance] = useState<PaidLeaveBalance | null>(null);

  const fetchPaidLeaveBalance = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/paid-leave/balance`);
      if (res.ok) {
        const balance = await res.json();
        setPaidLeaveBalance(balance.data || balance);
      }
    } catch (e) {
      logger.error('Failed to fetch paid leave balance:', e);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const taskFetch = taskCacheInitialized
        ? fetchTaskUpdates()
        : fetchAllTasks();

      const [, examsRes, schedulesRes] = await Promise.all([
        taskFetch,
        fetch(`${API_BASE}/exam-goals`),
        fetch(`${API_BASE}/schedules`),
        fetchPaidLeaveBalance(),
      ]);

      const examsData: ExamGoal[] = examsRes.ok ? await examsRes.json() : [];
      const schedulesData: ScheduleEvent[] = schedulesRes.ok
        ? await schedulesRes.json()
        : [];

      setExams(examsData);
      setSchedules(schedulesData);
    } catch (e) {
      logger.error('Failed to fetch events:', e);
    } finally {
      setLoading(false);
    }
  }, [taskCacheInitialized, fetchTaskUpdates, fetchAllTasks, fetchPaidLeaveBalance]);

  // NOTE: Auto-sync keeps calendar in sync when the user switches app focus.
  useTaskAutoSync({ enabled: true, interval: 30000, silent: true });

  // Build CalendarEvent list from cached tasks + local exams/schedules
  useEffect(() => {
    const taskEvents: CalendarEvent[] = cachedTasks
      .filter((t) => t.dueDate)
      .map((t) => ({
        id: t.id,
        title: t.title,
        date: t.dueDate!.split('T')[0],
        type: 'task' as const,
        status: t.status,
        color: t.theme?.color,
      }));

    const examEvents: CalendarEvent[] = exams.map((e) => ({
      id: e.id,
      title: e.name,
      date: e.examDate.split('T')[0],
      type: 'exam' as const,
      color: e.color,
    }));

    const scheduleEvents: CalendarEvent[] = schedules.map((s) => {
      // NOTE: Extract time directly from UTC ISO string to avoid timezone conversion issues.
      const extractUTCTime = (isoStr: string) => {
        const timePart = isoStr.split('T')[1]; // "HH:MM:SS.000Z"
        if (!timePart) return undefined;
        return timePart.slice(0, 5); // "HH:MM"
      };
      const timeStr = s.isAllDay ? undefined : extractUTCTime(s.startAt);
      const endTimeStr = s.endAt && !s.isAllDay ? extractUTCTime(s.endAt) : undefined;
      const startDateStr = s.startAt.split('T')[0];
      const endDateStr = s.endAt ? s.endAt.split('T')[0] : undefined;
      return {
        id: s.id,
        title: s.title,
        date: startDateStr,
        endDate: endDateStr && endDateStr > startDateStr ? endDateStr : undefined,
        type: 'schedule' as const,
        color: s.color,
        time: timeStr,
        endTime: endTimeStr,
        reminderMinutes: s.reminderMinutes,
        description: s.description,
      };
    });

    setEvents([...taskEvents, ...examEvents, ...scheduleEvents]);
  }, [cachedTasks, exams, schedules]);

  useEffect(() => {
    fetchEvents();
    const handleFocus = () => fetchTaskUpdates();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchEvents, fetchTaskUpdates]);

  /**
   * Creates a new task with the given title and due date.
   *
   * @param title - Task title.
   * @param selectedDate - Due date as YYYY-MM-DD.
   * @returns True if creation succeeded.
   */
  const createTask = async (title: string, selectedDate: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          dueDate: `${selectedDate}T00:00:00.000Z`,
          status: 'todo',
        }),
      });
      if (res.ok) {
        showToast(t('taskCreated'), 'success');
        await fetchTaskUpdates();
        return true;
      } else {
        showToast(t('taskCreateFailed'), 'error');
        return false;
      }
    } catch (e) {
      logger.error('Failed to create task:', e);
      showToast(tc('errorOccurred'), 'error');
      return false;
    }
  };

  /**
   * Creates a schedule event.
   *
   * @param data - Schedule event input.
   * @returns True if creation succeeded.
   */
  const createScheduleEvent = async (data: ScheduleEventInput): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        showToast(t('scheduleAdded'), 'success');
        fetchEvents();
        return true;
      } else {
        showToast(t('scheduleAddFailed'), 'error');
        return false;
      }
    } catch (e) {
      logger.error('Failed to create schedule:', e);
      showToast(tc('errorOccurred'), 'error');
      return false;
    }
  };

  /**
   * Creates a paid leave schedule event.
   *
   * @param data - Schedule event input (type will be overridden to PAID_LEAVE).
   * @returns True if creation succeeded.
   */
  const createPaidLeave = async (data: ScheduleEventInput): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, type: 'PAID_LEAVE' }),
      });
      if (res.ok) {
        showToast(t('paidLeaveCreated'), 'success');
        // NOTE: fetchEvents also refreshes the paid leave balance.
        fetchEvents();
        return true;
      } else {
        showToast(t('paidLeaveCreateFailed'), 'error');
        return false;
      }
    } catch (e) {
      logger.error('Failed to create paid leave:', e);
      showToast(tc('errorOccurred'), 'error');
      return false;
    }
  };

  /**
   * Deletes a schedule event by id.
   *
   * @param eventId - Schedule event id to delete.
   */
  const deleteScheduleEvent = async (eventId: number) => {
    try {
      const res = await fetch(`${API_BASE}/schedules/${eventId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(t('scheduleDeleted'), 'success');
        fetchEvents();
      } else {
        showToast(t('scheduleDeleteFailed'), 'error');
      }
    } catch (e) {
      logger.error('Failed to delete schedule:', e);
      showToast(tc('errorOccurred'), 'error');
    }
  };

  return {
    events,
    loading,
    exams,
    schedules,
    paidLeaveBalance,
    fetchTaskUpdates,
    createTask,
    createScheduleEvent,
    createPaidLeave,
    deleteScheduleEvent,
  };
}
