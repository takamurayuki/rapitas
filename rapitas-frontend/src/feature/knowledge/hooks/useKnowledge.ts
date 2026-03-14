'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type {
  KnowledgeEntry,
  KnowledgeListResponse,
  KnowledgeSourceType,
  KnowledgeCategory,
  ForgettingStage,
  ValidationStatus,
} from '../types';

interface UseKnowledgeOptions {
  page?: number;
  limit?: number;
  sourceType?: KnowledgeSourceType;
  category?: KnowledgeCategory;
  forgettingStage?: ForgettingStage;
  validationStatus?: ValidationStatus;
  themeId?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useKnowledge(options: UseKnowledgeOptions = {}) {
  const [data, setData] = useState<KnowledgeListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (options.page) params.set('page', String(options.page));
      if (options.limit) params.set('limit', String(options.limit));
      if (options.sourceType) params.set('sourceType', options.sourceType);
      if (options.category) params.set('category', options.category);
      if (options.forgettingStage)
        params.set('forgettingStage', options.forgettingStage);
      if (options.validationStatus)
        params.set('validationStatus', options.validationStatus);
      if (options.themeId) params.set('themeId', String(options.themeId));
      if (options.search) params.set('search', options.search);
      if (options.sortBy) params.set('sortBy', options.sortBy);
      if (options.sortOrder) params.set('sortOrder', options.sortOrder);

      const res = await fetch(`${API_BASE_URL}/knowledge?${params}`);
      if (!res.ok) throw new Error('Failed to fetch knowledge entries');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [
    options.page,
    options.limit,
    options.sourceType,
    options.category,
    options.forgettingStage,
    options.validationStatus,
    options.themeId,
    options.search,
    options.sortBy,
    options.sortOrder,
  ]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const createEntry = useCallback(
    async (entry: {
      sourceType: KnowledgeSourceType;
      title: string;
      content: string;
      category?: KnowledgeCategory;
      tags?: string[];
      confidence?: number;
      themeId?: number;
      taskId?: number;
    }) => {
      const res = await fetch(`${API_BASE_URL}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error('Failed to create knowledge entry');
      const created = await res.json();
      await fetchEntries();
      return created;
    },
    [fetchEntries],
  );

  const updateEntry = useCallback(
    async (id: number, updates: Partial<KnowledgeEntry>) => {
      const res = await fetch(`${API_BASE_URL}/knowledge/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update knowledge entry');
      await fetchEntries();
    },
    [fetchEntries],
  );

  const archiveEntry = useCallback(
    async (id: number) => {
      const res = await fetch(`${API_BASE_URL}/knowledge/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to archive knowledge entry');
      await fetchEntries();
    },
    [fetchEntries],
  );

  const pinEntry = useCallback(
    async (id: number, until: string) => {
      const res = await fetch(`${API_BASE_URL}/knowledge/${id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until }),
      });
      if (!res.ok) throw new Error('Failed to pin knowledge entry');
      await fetchEntries();
    },
    [fetchEntries],
  );

  return {
    entries: data?.entries ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    totalPages: data?.totalPages ?? 1,
    isLoading,
    error,
    refetch: fetchEntries,
    createEntry,
    updateEntry,
    archiveEntry,
    pinEntry,
  };
}
