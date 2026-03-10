/**
 * カレンダーイベント管理用カスタムフック
 * APIからのイベント取得、追加、削除操作を提供する
 */

import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useCalendarEvents');

export interface CalendarEvent {
  id: number;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  taskId?: number;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  taskId?: number;
}

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/calendar/events`);
      if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? data);
    } catch (error) {
      logger.transientError('Failed to fetch calendar events:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addEvent = useCallback(async (input: CreateEventInput) => {
    try {
      const res = await fetch(`${API_BASE_URL}/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to create event: ${res.status}`);
      const created = await res.json();
      setEvents((prev) => [...prev, created]);
      return created as CalendarEvent;
    } catch (error) {
      logger.error('Failed to add calendar event:', error);
      throw error;
    }
  }, []);

  const removeEvent = useCallback(async (eventId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to delete event: ${res.status}`);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (error) {
      logger.error('Failed to remove calendar event:', error);
      throw error;
    }
  }, []);

  const refreshEvents = useCallback(() => fetchEvents(), [fetchEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, isLoading, addEvent, removeEvent, refreshEvents };
}
