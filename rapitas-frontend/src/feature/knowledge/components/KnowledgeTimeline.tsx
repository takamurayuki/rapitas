'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import type { TimelineEvent } from '../types';

interface KnowledgeTimelineProps {
  limit?: number;
}

export function KnowledgeTimeline({ limit = 20 }: KnowledgeTimelineProps) {
  const t = useTranslations('knowledge.timeline');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/memory/timeline?limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events);
      }
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  if (isLoading) {
    return <div className="animate-pulse h-20 rounded-lg bg-gray-200 dark:bg-gray-700" />;
  }

  if (events.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('noEvents')}</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="mt-0.5 h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {event.eventType.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{event.actorType}</span>
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {new Date(event.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
