/**
 * useStallCheck
 *
 * Data-access hook for the stall-recovery API: on-demand stall scan and
 * user-approved recovery execution. No UI state — the panel's state machine
 * lives in use-stall-recovery.
 */
'use client';

import { useCallback } from 'react';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type {
  RecoverResult,
  StallCheckResponse,
  StallRecoveryAction,
} from '@/components/accessibility/stall-recovery-panel/stall-recovery.types';
import type { VoiceVerbosity } from '@/stores/voice-narration-store';

const logger = createLogger('useStallCheck');

export interface UseStallCheckReturn {
  /** Runs one on-demand stall scan; null on network/API failure. */
  check: (verbosity: VoiceVerbosity) => Promise<StallCheckResponse | null>;
  /** Executes ONE approved recovery action; null on network/API failure. */
  recover: (taskId: number, action: StallRecoveryAction) => Promise<RecoverResult | null>;
}

/**
 * Provides the stall-check / recover API calls for the stall-recovery panel.
 *
 * @returns Stable `check` / `recover` callbacks. / 安定参照のAPI呼出関数
 */
export function useStallCheck(): UseStallCheckReturn {
  const check = useCallback(async (verbosity: VoiceVerbosity) => {
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/workflow/stall-check?verbosity=${verbosity}`,
        undefined,
        2,
        500,
        15000,
        { silent: true },
      );
      if (!res.ok) {
        logger.warn(`stall-check failed: ${res.status}`);
        return null;
      }
      return (await res.json()) as StallCheckResponse;
    } catch (error) {
      logger.warn('stall-check request error:', error);
      return null;
    }
  }, []);

  const recover = useCallback(async (taskId: number, action: StallRecoveryAction) => {
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/workflow/tasks/${taskId}/recover`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
        // No retry on the mutation: a recovery must run at most once per approval.
        1,
        500,
        20000,
        { silent: true },
      );
      if (!res.ok) {
        logger.warn(`recover failed: ${res.status}`);
        return null;
      }
      return (await res.json()) as RecoverResult;
    } catch (error) {
      logger.warn('recover request error:', error);
      return null;
    }
  }, []);

  return { check, recover };
}
