'use client';
/**
 * useIdeaBox — hook for managing IdeaBox state and operations.
 */
import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface IdeaBoxEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
  source: string;
  usedInTaskId: number | null;
  createdAt: string;
}

interface IdeaStats {
  total: number;
  unused: number;
  byCategory: Array<{ category: string; count: number }>;
}

/**
 * Hook for IdeaBox CRUD operations, scoped by category.
 *
 * @param categoryId - Filter ideas by category / カテゴリフィルタ
 */
export function useIdeaBox(categoryId: number | null) {
  const [ideas, setIdeas] = useState<IdeaBoxEntry[]>([]);
  const [stats, setStats] = useState<IdeaStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIdeas = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', unusedOnly: 'false' });
      if (categoryId) params.set('categoryId', String(categoryId));

      const res = await fetch(`${API_BASE_URL}/idea-box?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ideas: IdeaBoxEntry[]; total: number };
      setIdeas(data.ideas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アイデアの取得に失敗');
    } finally {
      setIsLoading(false);
    }
  }, [categoryId]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('categoryId', String(categoryId));

      const res = await fetch(`${API_BASE_URL}/idea-box/stats?${params}`);
      if (res.ok) setStats((await res.json()) as IdeaStats);
    } catch {
      /* non-critical */
    }
  }, [categoryId]);

  const submitIdea = useCallback(async (title: string, content: string, category?: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/idea-box`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category: category ?? 'improvement' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchIdeas();
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アイデアの投稿に失敗');
    } finally {
      setIsSubmitting(false);
    }
  }, [fetchIdeas, fetchStats]);

  useEffect(() => {
    fetchIdeas();
    fetchStats();
  }, [fetchIdeas, fetchStats]);

  return { ideas, stats, isLoading, isSubmitting, error, submitIdea, refresh: fetchIdeas };
}
