'use strict';
// copilot-chat-service
//
// AI copilot chat, routed to make the most of the subscription:
//   1. Deterministic template answer for common factual questions → instant, free
//   2. Response cache check (SQLite, 7-day TTL) → instant, free
//   3. Claude via the Claude Code CLI subscription (RAPITAS_AUX_AI=cli,
//      utils/ai-client's default) — Haiku for ordinary questions, Sonnet for
//      complex ones. No local LLM: Ollama's summarization quality was found
//      too unreliable for this feature and was dropped in favor of leaning
//      on the subscription, which already avoids per-token API billing.
//
// The complexity assessor decides Haiku vs Sonnet. Task context (description,
// comments, subtasks) PLUS knowledge-OS context (past success/failure
// patterns and related knowledge — the same context agents receive) is
// automatically injected so the copilot grounds answers in what the project
// has already learned, not just the current task in isolation.

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { assessComplexity } from '../local-llm/complexity-assessor';
import {
  getCachedResponse,
  setCachedResponse,
  generateCacheKey,
} from '../local-llm/response-cache';
import { sendAIMessage, sendAIMessageStream } from '../../utils/ai-client';
import type { AIMessage } from '../../utils/ai-client';
import { gatherSharedKnowledge, formatKnowledgeContext } from '../agents/agent-knowledge-sharing';
import { matchCopilotIntent, respondToIntent } from './copilot-intent-responder';

const log = createLogger('copilot-chat');

/** Build context string from task and related data. */
async function buildTaskContext(taskId: number): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      theme: { select: { name: true, workingDirectory: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { content: true },
      },
      subtasks: {
        select: { id: true, title: true, status: true },
        take: 10,
      },
    },
  });

  if (!task) return '';

  const parts: string[] = [
    `## タスク: ${task.title}`,
    `ステータス: ${task.status} / 優先度: ${task.priority}`,
  ];

  if (task.description) parts.push(`説明: ${task.description.slice(0, 500)}`);
  if (task.theme) parts.push(`テーマ: ${task.theme.name}`);

  if (task.subtasks.length > 0) {
    parts.push(`\nサブタスク: ${task.subtasks.map((s) => `[${s.status}] ${s.title}`).join(', ')}`);
  }

  if (task.comments.length > 0) {
    parts.push(
      `\n最近のコメント:\n${task.comments.map((c) => `- ${c.content.slice(0, 150)}`).join('\n')}`,
    );
  }

  // Ground the copilot in the knowledge OS: past success/failure patterns and
  // related knowledge for this task (the same context agents receive before
  // execution). Non-fatal — falls back to task-local context on error.
  try {
    const knowledgeContext = formatKnowledgeContext(await gatherSharedKnowledge(taskId));
    if (knowledgeContext) parts.push(`\n${knowledgeContext}`);
  } catch {
    // ignore — keep task-local context only
  }

  return parts.join('\n');
}

/**
 * Determine which Claude model to use based on message complexity. Always
 * routes to Claude (via the CLI subscription, see utils/ai-client) — no
 * local-LLM tier. Ollama was tried here previously but its summarization
 * quality wasn't reliable enough for a task-support feature, and since the
 * subscription already avoids per-token billing there's no cost reason to
 * fall back to a weaker model.
 */
export function selectModelTier(message: string): { model: string; tier: string } {
  const assessment = assessComplexity(
    { title: message.slice(0, 100), description: message },
    'researcher',
    message.length,
  );

  // Haiku for most conversational queries — faster, and plenty capable for
  // everyday questions.
  if (assessment.level !== 'high') {
    return { model: 'claude-haiku-4-5-20251001', tier: 'economy' };
  }

  // Sonnet for complex analysis.
  return { model: 'claude-sonnet-4-6', tier: 'standard' };
}

const SYSTEM_PROMPT = `あなたはrapitasタスク管理アプリのAIコパイロットです。
ユーザーのタスクに関する質問に、簡潔で実用的な回答をしてください。

ルール:
- 日本語で回答
- タスクの文脈が提供された場合、それを踏まえて回答
- 「過去の失敗パターンに基づく警告」「関連する成功パターン」「関連する既存ナレッジ」が提供された場合は、必ずそれを根拠として具体的に助言する
- 実装の提案は具体的なステップで
- 不明な点は確認を求める
- 200-400文字程度を目安に簡潔に`;

export interface CopilotChatOptions {
  message: string;
  taskId?: number;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface CopilotChatResult {
  content: string;
  model: string;
  tier: string;
  cached: boolean;
  tokensUsed?: number;
}

/**
 * Send a copilot chat message. Checks the template-intent shortcut, then the
 * response cache, before calling Claude via the CLI subscription.
 */
export async function sendCopilotMessage(options: CopilotChatOptions): Promise<CopilotChatResult> {
  const { message, taskId, conversationHistory = [] } = options;

  // 0. Deterministic template answer for common factual questions (subtask
  // progress, blocked reason, due/estimate, status/priority) — skips the
  // LLM entirely, so it costs neither local-model inference nor Claude Code
  // CLI subscription usage. Falls through to the normal cascade below when
  // the message isn't a recognized intent, or the DB has nothing to say.
  if (taskId) {
    const intent = matchCopilotIntent(message);
    if (intent) {
      const templated = await respondToIntent(intent, taskId);
      if (templated) {
        await saveCopilotMessage('user', message, taskId);
        await saveCopilotMessage('assistant', templated, taskId);
        return { content: templated, model: 'template', tier: 'free', cached: false };
      }
    }
  }

  // Build context
  let contextPrompt = message;
  if (taskId) {
    const context = await buildTaskContext(taskId);
    if (context) {
      contextPrompt = `${context}\n\n---\nユーザー: ${message}`;
    }
  }

  // 1. Check cache
  const cacheMessages = [{ role: 'user', content: contextPrompt }];
  const cacheKey = generateCacheKey('copilot', 'auto', SYSTEM_PROMPT, cacheMessages);
  const cachedEntry = getCachedResponse(cacheKey);
  if (cachedEntry) {
    log.debug('Cache hit for copilot message');
    await saveCopilotMessage('user', message, taskId);
    await saveCopilotMessage('assistant', cachedEntry.content, taskId);
    return { content: cachedEntry.content, model: 'cache', tier: 'free', cached: true };
  }

  // 2. Select model
  const { model, tier } = selectModelTier(message);

  log.info({ model, tier, messageLength: message.length }, 'Copilot routing');

  // 3. Build messages
  const messages: AIMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: contextPrompt },
  ];

  // 4. Call LLM
  const response = await sendAIMessage({
    provider: 'claude',
    model,
    messages,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: tier === 'economy' ? 800 : 2000,
  });

  const content = response.content;

  // 5. Cache the response
  setCachedResponse(cacheKey, content, response.tokensUsed || 0, 'claude', model);

  // 6. Save to DB
  await saveCopilotMessage('user', message, taskId);
  await saveCopilotMessage('assistant', content, taskId);

  // 7. Extract ideas periodically from longer conversations (fire-and-forget)
  if (conversationHistory.length >= 5 && conversationHistory.length % 5 === 0) {
    import('../memory/idea-extractor')
      .then(({ extractIdeasFromCopilotChat }) => {
        extractIdeasFromCopilotChat(conversationHistory, taskId).catch(() => {});
      })
      .catch(() => {});
  }

  return {
    content,
    model,
    tier,
    cached: false,
    tokensUsed: response.tokensUsed,
  };
}

/**
 * Stream a copilot chat response.
 */
export async function streamCopilotMessage(
  options: CopilotChatOptions,
): Promise<{ stream: ReadableStream; model: string; tier: string }> {
  const { message, taskId, conversationHistory = [] } = options;

  let contextPrompt = message;
  if (taskId) {
    const context = await buildTaskContext(taskId);
    if (context) {
      contextPrompt = `${context}\n\n---\nユーザー: ${message}`;
    }
  }

  const { model, tier } = selectModelTier(message);

  const messages: AIMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: contextPrompt },
  ];

  await saveCopilotMessage('user', message, taskId);

  const stream = await sendAIMessageStream({
    provider: 'claude',
    model,
    messages,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: tier === 'economy' ? 800 : 2000,
  });

  return { stream, model, tier };
}

/** Save a copilot message to DB. */
async function saveCopilotMessage(
  role: 'user' | 'assistant',
  content: string,
  taskId?: number,
): Promise<void> {
  try {
    await prisma.copilotMessage.create({
      data: { taskId: taskId ?? null, role, content },
    });
  } catch (err) {
    log.warn({ err }, 'Failed to save copilot message');
  }
}

/** Get chat history for a task. */
export async function getCopilotHistory(taskId: number, limit = 50) {
  return prisma.copilotMessage.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}
