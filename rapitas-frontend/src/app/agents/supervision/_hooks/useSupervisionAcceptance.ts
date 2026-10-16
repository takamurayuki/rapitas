'use client';
/**
 * useSupervisionAcceptance
 *
 * Fetches the persisted supervision acceptance verdict from
 * /agents/supervision/acceptance-status. A failed or malformed response is
 * surfaced as an error, never as an empty "met" status.
 */

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useSupervisionAcceptance');

/** Refresh cadence; the backend recomputes the snapshot every ~5 minutes. */
const POLL_INTERVAL_MS = 60_000;

export interface SupervisionAcceptanceStatus {
  met: boolean;
  streakCount: number;
  streakStartAt: string | null;
  hoursSinceLastIntervention: number | null;
  observedGapMinutes: number;
  reasonCodes: string[];
  blockingTaskIds: number[];
  evalSetVersion: string | null;
  denominators: Record<string, number | string | boolean | null>;
  snapshotAt: string | null;
  snapshotAgeMinutes: number | null;
  heartbeatCount: number;
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
}

export interface UseSupervisionAcceptanceReturn {
  status: SupervisionAcceptanceStatus | null;
  loading: boolean;
  error: boolean;
}

/**
 * Loads and periodically refreshes the supervision acceptance status.
 *
 * @returns Status plus loading/error flags / 受入状態と読み込み・エラー状態
 */
export function useSupervisionAcceptance(): UseSupervisionAcceptanceReturn {
  const [status, setStatus] = useState<SupervisionAcceptanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agents/supervision/acceptance-status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
      } & Partial<SupervisionAcceptanceStatus>;
      if (!body.success || typeof body.met !== 'boolean' || !Array.isArray(body.reasonCodes)) {
        throw new Error('malformed acceptance status');
      }
      setStatus(body as SupervisionAcceptanceStatus);
      setError(false);
    } catch (err) {
      logger.error('Failed to fetch supervision acceptance status:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  return { status, loading, error };
}
