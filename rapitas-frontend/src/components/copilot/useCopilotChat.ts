'use client';
// useCopilotChat — hook for the AI copilot chat panel.
import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  tier?: string;
  cached?: boolean;
  actions?: Array<{ type: string; label: string; params?: Record<string, unknown> }>;
  /** Structured data from action results (analysis, execution status, etc.). */
  actionData?: {
    type: string;
    data: unknown;
  };
  createdAt: string;
}

export function useCopilotChat(taskId?: number) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          throw new Error(
            (data as { error?: string }).error ?? `HTTP ${res.status}`,
          );
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
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, taskId],
  );

  /** Execute a copilot action (analyze, execute, create_subtasks, update_status). */
  const executeAction = useCallback(
    async (action: string, params?: Record<string, unknown>) => {
      if (!taskId || isLoading) return;

      setIsLoading(true);
      setError(null);

      // Add a system message showing the action in progress
      const actionLabels: Record<string, string> = {
        analyze: 'タスクを分析中...',
        execute: 'エージェント実行を開始中...',
        create_subtasks: 'サブタスクを作成中...',
        update_status: 'ステータスを更新中...',
        get_execution_status: '実行状態を確認中...',
      };

      const pendingMsg: CopilotMessage = {
        id: `action-${Date.now()}`,
        role: 'system',
        content: actionLabels[action] ?? `${action}を実行中...`,
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
          throw new Error(
            (errData as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        const result = await res.json() as {
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
          const analysisData = result.data as { suggestedSubtasks?: Array<{ title: string; description?: string }> };
          if (analysisData.suggestedSubtasks && analysisData.suggestedSubtasks.length > 0) {
            resultMsg.actions = [
              {
                type: 'create_subtasks',
                label: `サブタスクを作成 (${analysisData.suggestedSubtasks.length}件)`,
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

        setMessages((prev) =>
          prev.map((m) => (m.id === pendingMsg.id ? resultMsg : m)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'アクション実行に失敗しました');
        // Remove the pending message on error
        setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id));
      } finally {
        setIsLoading(false);
      }
    },
    [taskId, isLoading],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, sendMessage, executeAction, clearChat };
}
