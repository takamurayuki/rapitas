/**
 * 学習進捗を追跡するカスタムフック
 * 目標に対する進捗率、合計学習時間、マイルストーンを提供
 */

import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useStudyProgress');

interface Milestone {
  label: string;
  targetHours: number;
  achieved: boolean;
}

interface StudyProgressData {
  progress: number;
  totalHours: number;
  isOnTrack: boolean;
  milestones: Milestone[];
}

interface StudyProgressReturn extends StudyProgressData {
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useStudyProgress(goalId: number | null): StudyProgressReturn {
  const [data, setData] = useState<StudyProgressData>({
    progress: 0,
    totalHours: 0,
    isOnTrack: false,
    milestones: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!goalId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/learning-goals/${goalId}/progress`)
      .then((res) => {
        if (!res.ok) throw new Error('進捗データの取得に失敗しました');
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const totalHours = json.totalHours ?? 0;
        const targetHours = json.targetHours ?? 1;
        const progress = Math.min(100, Math.round((totalHours / targetHours) * 100));

        const milestoneTargets = [10, 25, 50, 75, 100];
        const milestones: Milestone[] = milestoneTargets.map((pct) => ({
          label: `${pct}%`,
          targetHours: (targetHours * pct) / 100,
          achieved: totalHours >= (targetHours * pct) / 100,
        }));

        const daysElapsed = json.daysElapsed ?? 1;
        const totalDays = json.totalDays ?? 30;
        const expectedProgress = (daysElapsed / totalDays) * 100;
        const isOnTrack = progress >= expectedProgress * 0.9;

        setData({ progress, totalHours, isOnTrack, milestones });
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to fetch study progress:', err);
        setError(err instanceof Error ? err.message : '不明なエラー');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [goalId, refreshKey]);

  return { ...data, loading, error, refresh };
}
