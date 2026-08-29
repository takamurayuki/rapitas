'use client';
/**
 * use-resource-gate
 *
 * Polls GET /agents/resource-gate/status and GET /agents/resource-gate/deferrals
 * (task 725) and exposes an override() action for the dashboard's "今すぐ実行"
 * button. Not responsible for rendering — see ResourceContentionPanel.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

const POLL_INTERVAL_MS = 10000;

/** Response shape of GET /agents/resource-gate/status. */
export interface ResourceGateStatus {
  enabled: boolean;
  thresholdPercent: number;
  hostCpuBusyPercent: number | null;
  effectiveMaxConcurrency: number;
}

/** One row from GET /agents/resource-gate/deferrals. */
export interface ResourceGateDeferral {
  themeId: number | null;
  cpuBusyPercent: number | null;
  thresholdPercent: number | null;
  createdAt: string;
}

/**
 * Loads and re-polls resource-gate status + recent deferrals.
 *
 * @returns Status/deferrals state and an override() action / 状態と手動オーバーライド操作
 */
export function useResourceGate(): {
  status: ResourceGateStatus | null;
  deferrals: ResourceGateDeferral[];
  loaded: boolean;
  error: boolean;
  override: (themeId: number) => Promise<void>;
} {
  const [status, setStatus] = useState<ResourceGateStatus | null>(null);
  const [deferrals, setDeferrals] = useState<ResourceGateDeferral[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const poll = useCallback(async () => {
    try {
      const [statusRes, deferralsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/agents/resource-gate/status`),
        fetch(`${API_BASE_URL}/agents/resource-gate/deferrals?limit=20`),
      ]);
      if (!statusRes.ok || !deferralsRes.ok) throw new Error('resource-gate fetch failed');
      setStatus((await statusRes.json()) as ResourceGateStatus);
      setDeferrals((await deferralsRes.json()) as ResourceGateDeferral[]);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const override = useCallback(
    async (themeId: number) => {
      await fetch(`${API_BASE_URL}/agents/resource-gate/override/${themeId}`, { method: 'POST' });
      await poll();
    },
    [poll],
  );

  return { status, deferrals, loaded, error, override };
}
