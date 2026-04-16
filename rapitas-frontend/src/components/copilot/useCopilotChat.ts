'use client';
// useCopilotChat — hook for the AI copilot chat panel.
import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  tier?: string;
  cached?: boolean;
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

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, sendMessage, clearChat };
}
