'use client';

/**
 * useTerminalSubmit
 *
 * Encapsulates the submit logic for the terminal input bar.
 * Handles both new-execution requests and waiting-for-input responses,
 * keeping TerminalPanel free of fetch call details.
 */

import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { LogLine } from './terminal-utils';
import { appendCapped } from './terminal-utils';

type PollingAPI = {
  clearQuestion: () => void;
  startPolling: () => void;
};

interface UseTerminalSubmitOptions {
  taskId: number;
  selectedAgentId: number | null;
  isWaiting: boolean;
  lineIdCounter: React.MutableRefObject<number>;
  onExecute: (options?: {
    instruction?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  polling: PollingAPI;
  setLines: React.Dispatch<React.SetStateAction<LogLine[]>>;
  setSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Returns a stable handleSubmit callback wired to the provided terminal state setters.
 *
 * @param options - Configuration for the submit handler / サブミットハンドラーの設定
 * @returns handleSubmit callback / サブミットコールバック
 */
export function useTerminalSubmit({
  taskId,
  selectedAgentId,
  isWaiting,
  lineIdCounter,
  onExecute,
  polling,
  setLines,
  setSubmitting,
  setInput,
}: UseTerminalSubmitOptions) {
  const t = useTranslations('devMode.useTerminalSubmit');
  // Keep a stable ref to isWaiting so the callback doesn't re-create on every poll tick.
  const isWaitingRef = useRef(isWaiting);
  isWaitingRef.current = isWaiting;

  const handleSubmit = useCallback(
    async (input: string) => {
      const text = input.trim();
      if (!text) return;

      setLines((prev) =>
        appendCapped(prev, [
          {
            id: `u-${lineIdCounter.current++}`,
            type: 'user' as const,
            text,
            ts: Date.now(),
          },
        ]),
      );
      setInput('');

      if (isWaitingRef.current) {
        setSubmitting(true);
        try {
          const { API_BASE_URL } = await import('@/utils/api');
          const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response: text }),
          });
          if (res.ok) {
            polling.clearQuestion();
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch {
          setLines((prev) =>
            appendCapped(prev, [
              {
                id: `e-${lineIdCounter.current++}`,
                type: 'error' as const,
                text: t('sendResponseFailed'),
                ts: Date.now(),
              },
            ]),
          );
        } finally {
          setSubmitting(false);
        }
      } else {
        setSubmitting(true);
        try {
          const result = await onExecute({
            instruction: text,
            agentConfigId: selectedAgentId ?? undefined,
          });
          const sessionId = result?.sessionId;
          if (sessionId) {
            setLines((prev) =>
              appendCapped(prev, [
                {
                  id: `s-${lineIdCounter.current++}`,
                  type: 'system' as const,
                  text: t('executionStarted', { sessionId }),
                  ts: Date.now(),
                },
              ]),
            );
            polling.startPolling();
          }
        } catch {
          setLines((prev) =>
            appendCapped(prev, [
              {
                id: `e-${lineIdCounter.current++}`,
                type: 'error' as const,
                text: t('executionStartFailed'),
                ts: Date.now(),
              },
            ]),
          );
        } finally {
          setSubmitting(false);
        }
      }
    },
    // NOTE: isWaiting intentionally excluded — read via ref to avoid stale-closure
    // re-creation on every polling tick.

    [
      taskId,
      selectedAgentId,
      onExecute,
      polling,
      setLines,
      setSubmitting,
      setInput,
      lineIdCounter,
      t,
    ],
  );

  return handleSubmit;
}
