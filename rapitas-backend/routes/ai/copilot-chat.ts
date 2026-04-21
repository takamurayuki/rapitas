'use strict';
// Copilot Chat API — cost-optimized AI routing:
// cache → local LLM (Ollama) → Haiku → Sonnet

import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  sendCopilotMessage,
  streamCopilotMessage,
  getCopilotHistory,
} from '../../services/ai/copilot-chat-service';
import { executeCopilotAction, type CopilotActionType } from '../../services/ai/copilot-action-service';

const log = createLogger('routes:copilot-chat');

export const copilotChatRoutes = new Elysia()

  /** Non-streaming copilot chat (returns full response). */
  .post(
    '/copilot/chat',
    async ({ body, set }) => {
      const { message, taskId, conversationHistory } = body;

      if (!message?.trim()) {
        set.status = 400;
        return { error: 'メッセージが必要です' };
      }

      try {
        const result = await sendCopilotMessage({
          message,
          taskId: taskId ?? undefined,
          conversationHistory: conversationHistory ?? [],
        });
        return { success: true, ...result };
      } catch (err) {
        log.error({ err }, 'Copilot chat error');
        set.status = 500;
        return {
          error: err instanceof Error ? err.message : 'Copilot chat failed',
        };
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
        taskId: t.Optional(t.Nullable(t.Number())),
        conversationHistory: t.Optional(
          t.Array(t.Object({ role: t.String(), content: t.String() })),
        ),
      }),
    },
  )

  /** Streaming copilot chat (SSE text/event-stream). */
  .post(
    '/copilot/chat/stream',
    async ({ body, set }) => {
      const { message, taskId, conversationHistory } = body;

      if (!message?.trim()) {
        set.status = 400;
        return { error: 'メッセージが必要です' };
      }

      try {
        const { stream, model, tier } = await streamCopilotMessage({
          message,
          taskId: taskId ?? undefined,
          conversationHistory: conversationHistory ?? [],
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Model': model,
            'X-Tier': tier,
          },
        });
      } catch (err) {
        log.error({ err }, 'Copilot stream error');
        set.status = 500;
        return {
          error: err instanceof Error ? err.message : 'Copilot stream failed',
        };
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
        taskId: t.Optional(t.Nullable(t.Number())),
        conversationHistory: t.Optional(
          t.Array(t.Object({ role: t.String(), content: t.String() })),
        ),
      }),
    },
  )

  /** Execute a copilot action (analyze, execute, create subtasks, etc.). */
  .post(
    '/copilot/action',
    async ({ body, set }) => {
      const { action, taskId, params } = body;

      if (!taskId) {
        set.status = 400;
        return { error: 'タスクIDが必要です' };
      }

      try {
        const result = await executeCopilotAction({
          action: action as CopilotActionType,
          taskId,
          params: params ?? undefined,
        });
        return result;
      } catch (err) {
        log.error({ err }, 'Copilot action error');
        set.status = 500;
        return {
          error: err instanceof Error ? err.message : 'Action failed',
        };
      }
    },
    {
      body: t.Object({
        action: t.String({ minLength: 1 }),
        taskId: t.Number(),
        params: t.Optional(t.Record(t.String(), t.Any())),
      }),
    },
  )

  /** Get copilot chat history for a task. */
  .get(
    '/copilot/chat/:taskId/history',
    async ({ params }) => {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) return { messages: [] };
      const messages = await getCopilotHistory(taskId);
      return { messages };
    },
    {
      params: t.Object({ taskId: t.String() }),
    },
  );
