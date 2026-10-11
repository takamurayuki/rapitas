'use client';

/**
 * UsageBudgetPromptProvider
 *
 * App-wide poller for the AI usage budget: calls the evaluate endpoint on mount
 * and every minute, and shows the threshold confirmation dialog when the
 * backend returns a pendingPrompt. Never blocks or pauses any execution.
 */

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import {
  UsageBudgetPromptDialog,
  type PendingPrompt,
  type PromptResponseBody,
} from './UsageBudgetPromptDialog';

/** Poll interval for the evaluate endpoint. */
export const USAGE_BUDGET_POLL_MS = 60_000;

function tzQuery(): string {
  // getTimezoneOffset is minutes WEST of UTC; the API expects minutes east.
  return `tzOffsetMinutes=${-new Date().getTimezoneOffset()}`;
}

/**
 * Mount once in the root layout.
 *
 * @returns The confirmation dialog when a prompt is pending, otherwise nothing
 */
export default function UsageBudgetPromptProvider() {
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);

  const evaluate = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agent-metrics/usage-budget/evaluate?${tzQuery()}`, {
        method: 'POST',
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        success?: boolean;
        data?: { pendingPrompt?: PendingPrompt | null };
      };
      if (json.success) setPrompt(json.data?.pendingPrompt ?? null);
    } catch {
      // Backend unreachable — stay silent and retry on the next tick.
    }
  }, []);

  useEffect(() => {
    void evaluate();
    const timer = setInterval(() => void evaluate(), USAGE_BUDGET_POLL_MS);
    return () => clearInterval(timer);
  }, [evaluate]);

  const respond = useCallback(async (body: PromptResponseBody) => {
    const res = await fetch(
      `${API_BASE_URL}/agent-metrics/usage-budget/prompt-response?${tzQuery()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(`prompt-response failed: ${res.status}`);
  }, []);

  return (
    <UsageBudgetPromptDialog
      prompt={prompt}
      respond={respond}
      onClose={() => setPrompt(null)}
      onResolved={() => setPrompt(null)}
    />
  );
}
