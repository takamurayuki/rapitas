'use client';
/**
 * useUsdJpyRate
 *
 * Shared USD→JPY display conversion for the agent usage widgets. Costs are
 * recorded in USD (the CLI reports total_cost_usd); every widget converts to
 * yen at display time using the backend-configured rate so all views agree.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** Fallback rate when the backend config is unreachable. */
export const DEFAULT_USD_JPY_RATE = 150;

/**
 * Format a USD amount as yen.
 *
 * @param usd - Amount in US dollars / 米ドル金額
 * @param rate - USD→JPY conversion rate / 換算レート
 * @returns Formatted yen string (e.g. "¥12,038") / 円表記
 */
export function formatJpy(usd: number, rate: number): string {
  return `¥${Math.round(usd * rate).toLocaleString('ja-JP')}`;
}

/**
 * Fetch the backend-configured USD→JPY rate (RAPITAS_USD_JPY_RATE).
 *
 * @returns The rate, defaulting to 150 until loaded / 換算レート
 */
export function useUsdJpyRate(): number {
  const [rate, setRate] = useState<number>(DEFAULT_USD_JPY_RATE);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/agent-metrics/usage-config`)
      .then(async (r) => (r.ok ? ((await r.json()) as { usdJpyRate?: number }) : null))
      .then((v) => {
        if (!cancelled && v && typeof v.usdJpyRate === 'number' && v.usdJpyRate > 0) {
          setRate(v.usdJpyRate);
        }
      })
      .catch(() => {
        // Non-critical — keep the default rate.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return rate;
}
