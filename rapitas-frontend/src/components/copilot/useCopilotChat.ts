'use client';
// useCopilotChat — hook for the AI copilot chat panel.
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  tier?: string;
  cached?: boolean;
  actions?: Array<{
    type: string;
    label: string;
    params?: Record<string, unknown>;
  }>;
  /** Structured data from action results (analysis, execution status, etc.). */
  actionData?: {
    type: string;
    data: unknown;
  };
  createdAt: string;
}

export function useCopilotChat(taskId?: number) {
  const t = useTranslations('copilot.useCopilotChat');
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks an in-flight retrospective so it can be cancelled mid-generation.
  const [isRetrospecting, setIsRetrospecting] = useState(false);
  const retroAbortRef = useRef<AbortController | null>(null);

  // Seed the panel with persisted copilot history (past chats + retrospectives)
  // so previously generated content re-appears when the task is reopened.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/copilot/chat/${taskId}/history`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages?: Array<{ id: number; role: string; content: string; createdAt: string }>;
        };
        if (cancelled || !Array.isArray(data.messages) || data.messages.length === 0) return;
        setMessages((prev) =>
          prev.length === 0
            ? data.messages!.map((m) => ({
                id: `hist-${m.id}`,
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.content,
                createdAt: m.createdAt,
              }))
            : prev,
        );
      } catch {
        /* non-fatal — start with an empty panel */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isLoading) return;

      const userMsg: CopilotMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        const history = messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch(`${API_BASE_URL}/copilot/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            taskId: taskId ?? null,
            conversationHistory: history,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          success: boolean;
          content: string;
          model: string;
          tier: string;
          cached: boolean;
        };

        const assistantMsg: CopilotMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.content,
          model: data.model,
          tier: data.tier,
          cached: data.cached,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('sendMessageError'));
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, taskId, t],
  );

  /** Execute a copilot action (analyze, execute, create_subtasks, update_status). */
  const executeAction = useCallback(
    async (action: string, params?: Record<string, unknown>) => {
      if (!taskId || isLoading) return;

      setIsLoading(true);
      setError(null);

      // Add a system message showing the action in progress
      const actionLabels: Record<string, string> = {
        analyze: t('actionAnalyzing'),
        execute: t('actionExecuting'),
        create_subtasks: t('actionCreatingSubtasks'),
        update_status: t('actionUpdatingStatus'),
        update_estimate: t('actionApplyingEstimate'),
        get_execution_status: t('actionCheckingExecutionStatus'),
      };

      const pendingMsg: CopilotMessage = {
        id: `action-${Date.now()}`,
        role: 'system',
        content: actionLabels[action] ?? t('actionRunningGeneric', { action }),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, pendingMsg]);

      try {
        const res = await fetch(`${API_BASE_URL}/copilot/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, taskId, params }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error((errData as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const result = (await res.json()) as {
          success: boolean;
          action: string;
          data: unknown;
          message: string;
        };

        // Replace the pending message with the result
        const resultMsg: CopilotMessage = {
          id: `action-result-${Date.now()}`,
          role: 'assistant',
          content: result.message,
          actionData: { type: result.action, data: result.data },
          createdAt: new Date().toISOString(),
        };

        // Add action buttons based on the result
        if (result.action === 'analyze' && result.success && result.data) {
          const analysisData = result.data as {
            suggestedSubtasks?: Array<{ title: string; description?: string }>;
          };
          if (analysisData.suggestedSubtasks && analysisData.suggestedSubtasks.length > 0) {
            resultMsg.actions = [
              {
                type: 'create_subtasks',
                label: t('createSubtasksLabel', { count: analysisData.suggestedSubtasks.length }),
                params: {
                  subtasks: analysisData.suggestedSubtasks.map((s) => ({
                    title: s.title,
                    description: s.description,
                  })),
                },
              },
            ];
          }
        }

        setMessages((prev) => prev.map((m) => (m.id === pendingMsg.id ? resultMsg : m)));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('actionError'));
        // Remove the pending message on error
        setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id));
      } finally {
        setIsLoading(false);
      }
    },
    [taskId, isLoading, t],
  );

  /**
   * Runs a grounded retrospective: the backend reads the task's workflow
   * artifacts (research/plan/verify.md), deep-dives the learnings, and saves
   * carry-forward lessons to the knowledge OS. The result is shown as a message.
   */
  const runRetrospective = useCallback(async () => {
    if (!taskId || isLoading) return;

    const controller = new AbortController();
    retroAbortRef.current = controller;
    setIsLoading(true);
    setIsRetrospecting(true);
    setError(null);

    const pendingMsg: CopilotMessage = {
      id: `retro-${Date.now()}`,
      role: 'system',
      content: t('retrospectiveGenerating'),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, pendingMsg]);

    try {
      const res = await fetch(`${API_BASE_URL}/copilot/tasks/${taskId}/retrospective`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        markdown: string;
        savedLessons: number;
        usedArtifacts: string[];
      };

      const resultMsg: CopilotMessage = {
        id: `retro-result-${Date.now()}`,
        role: 'assistant',
        content: data.markdown,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => prev.map((m) => (m.id === pendingMsg.id ? resultMsg : m)));
    } catch (err) {
      // Cancellation is not an error — just drop the pending message.
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : t('retrospectiveError'));
      }
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id));
    } finally {
      setIsLoading(false);
      setIsRetrospecting(false);
      retroAbortRef.current = null;
    }
  }, [taskId, isLoading, t]);

  /** Aborts an in-flight retrospective generation. */
  const cancelRetrospective = useCallback(() => {
    retroAbortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    isRetrospecting,
    sendMessage,
    executeAction,
    runRetrospective,
    cancelRetrospective,
    clearChat,
  };
}
