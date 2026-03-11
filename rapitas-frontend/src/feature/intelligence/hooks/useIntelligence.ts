'use client';

import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useIntelligence');

export type TaskSuggestion = {
  taskId: number;
  title: string;
  priority: string;
  themeId: number | null;
  themeName: string | null;
  score: number;
  reasons: string[];
  estimatedFocusLevel: 'high' | 'medium' | 'low';
};

export type ProductivityPattern = {
  hourOfDay: number;
  dayOfWeek: number;
  completionRate: number;
  avgTasksCompleted: number;
  preferredPriority: string | null;
  preferredThemeId: number | null;
};

export type SuggestedTasksResponse = {
  success: boolean;
  suggestions: TaskSuggestion[];
  currentPattern: ProductivityPattern;
  focusLevel: 'high' | 'medium' | 'low';
  message: string;
};

export type HeatmapCell = {
  hour: number;
  day: number;
  completions: number;
  avgDuration: number;
};

export type HeatmapResponse = {
  success: boolean;
  heatmap: HeatmapCell[];
  peakHours: number[];
  lowHours: number[];
};

export type ReminderSummary = {
  success: boolean;
  atRiskCount: number;
  dormantCount: number;
  recentlyReviewed: number;
  topAtRisk: Array<{
    id: number;
    title: string;
    decayScore: number;
    category: string;
    lastAccessedAt: string | null;
  }>;
};

export type RelatedKnowledge = {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  relevanceScore: number;
};

export function useSuggestedTasks() {
  const [data, setData] = useState<SuggestedTasksResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async (limit: number = 5) => {
    setLoading(true);
    try {
      const res = await globalThis.fetch(
        `${API_BASE_URL}/intelligence/suggested-tasks?limit=${limit}`,
      );
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      logger.warn('Failed to fetch suggested tasks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}

export function useProductivityHeatmap() {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await globalThis.fetch(
        `${API_BASE_URL}/intelligence/productivity-heatmap`,
      );
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      logger.warn('Failed to fetch heatmap:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, fetch };
}

export function useKnowledgeReminders() {
  const [summary, setSummary] = useState<ReminderSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await globalThis.fetch(
        `${API_BASE_URL}/intelligence/knowledge-reminders/summary`,
      );
      if (res.ok) {
        setSummary(await res.json());
      }
    } catch (e) {
      logger.warn('Failed to fetch reminder summary:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const markAsReviewed = useCallback(async (entryId: number) => {
    try {
      const res = await globalThis.fetch(
        `${API_BASE_URL}/intelligence/knowledge-reminders/${entryId}/review`,
        { method: 'POST' },
      );
      if (res.ok) {
        setSummary((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            atRiskCount: Math.max(0, prev.atRiskCount - 1),
            recentlyReviewed: prev.recentlyReviewed + 1,
            topAtRisk: prev.topAtRisk.filter((e) => e.id !== entryId),
          };
        });
        return true;
      }
    } catch (e) {
      logger.warn('Failed to mark as reviewed:', e);
    }
    return false;
  }, []);

  return { summary, loading, fetchSummary, markAsReviewed };
}

export function useRelatedKnowledge() {
  const [entries, setEntries] = useState<RelatedKnowledge[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(
    async (
      title: string,
      description?: string | null,
      themeId?: number | null,
    ) => {
      if (!title || title.length < 3) {
        setEntries([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ title });
        if (description) params.set('description', description);
        if (themeId) params.set('themeId', String(themeId));

        const res = await globalThis.fetch(
          `${API_BASE_URL}/intelligence/tasks/related-knowledge?${params}`,
        );
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries || []);
        }
      } catch (e) {
        logger.warn('Failed to fetch related knowledge:', e);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { entries, loading, search };
}
