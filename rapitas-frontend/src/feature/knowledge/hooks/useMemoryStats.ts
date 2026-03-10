'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { KnowledgeStats, QueueStatus, ConsolidationRun } from '../types';

export function useMemoryStats() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [consolidationRuns, setConsolidationRuns] = useState<
    ConsolidationRun[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsRes, queueRes, runsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/knowledge/stats`),
        fetch(`${API_BASE_URL}/memory/queue/status`),
        fetch(`${API_BASE_URL}/memory/consolidation/runs?limit=10`),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (queueRes.ok) setQueueStatus(await queueRes.json());
      if (runsRes.ok) setConsolidationRuns(await runsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const triggerConsolidation = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/memory/consolidation/trigger`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to trigger consolidation');
    const result = await res.json();
    await fetchAll();
    return result;
  }, [fetchAll]);

  const triggerForgettingSweep = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/memory/forgetting/sweep`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to trigger forgetting sweep');
    const result = await res.json();
    await fetchAll();
    return result;
  }, [fetchAll]);

  return {
    stats,
    queueStatus,
    consolidationRuns,
    isLoading,
    error,
    refetch: fetchAll,
    triggerConsolidation,
    triggerForgettingSweep,
  };
}
