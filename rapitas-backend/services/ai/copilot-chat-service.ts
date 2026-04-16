'use strict';
// copilot-chat-service
//
// AI copilot chat with cost-optimized model routing:
//   1. Response cache check (SQLite, 7-day TTL) → instant, free
//   2. Local LLM (Ollama) for simple queries → free
//   3. Claude API (Haiku) for medium complexity → low cost
//   4. Claude API (Sonnet) for high complexity → higher cost
//
// The complexity assessor + smart router decide which tier to use.
// Task context (description, comments, subtasks, dependencies) is
// automatically injected so the AI understands the current work.

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { assessComplexity } from '../local-llm/complexity-assessor';
import { getLocalLLMStatus } from '../local-llm';
import { getCachedResponse, setCachedResponse, generateCacheKey } from '../local-llm/response-cache';
import { sendAIMessage, sendAIMessageStream } from '../../utils/ai-client';
import type { AIMessage } from '../../utils/ai-client';

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
      incomingDependencies: {
        select: { fromTask: { select: { title: true, status: true } } },
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
    parts.push(
      `\nサブタスク: ${task.subtasks.map((s) => `[${s.status}] ${s.title}`).join(', ')}`,
    );
  }

  if (task.incomingDependencies.length > 0) {
    parts.push(
      `ブロッカー: ${task.incomingDependencies.map((d) => `[${d.fromTask.status}] ${d.fromTask.title}`).join(', ')}`,
    );
  }

  if (task.comments.length > 0) {
    parts.push(
      `\n最近のコメント:\n${task.comments.map((c) => `- ${c.content.slice(0, 150)}`).join('\n')}`,
    );
  }

  return parts.join('\n');
}

/** Determine which model tier to use based on message complexity. */
function selectModelTier(
  message: string,
  localAvailable: boolean,
): { provider: 'ollama' | 'claude'; model: string; tier: string } {
  const assessment = assessComplexity(
    { title: message.slice(0, 100), description: message },
    'researcher',
    message.length,
  );

  // Tier 1: Local LLM for simple queries
  if (localAvailable && assessment.canUseLocalLLM && message.length < 200) {
    return { provider: 'ollama', model: 'llama3.2', tier: 'free' };
  }

  // Tier 2: Haiku for most conversational queries
  if (assessment.level !== 'high') {
    return {
      provider: 'claude',
      model: 'claude-haiku-4-5-20251001',
      tier: 'economy',
    };
  }

  // Tier 3: Sonnet for complex analysis
  return {
    provider: 'claude',
    model: 'claude-sonnet-4-6-20250610',
    tier: 'standard',
  };
}

const SYSTEM_PROMPT = `あなたはrapitasタスク管理アプリのAIコパイロットです。
ユーザーのタスクに関する質問に、簡潔で実用的な回答をしてください。

ルール:
- 日本語で回答
- タスクの文脈が提供された場合、それを踏まえて回答
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
 * Send a copilot chat message with cost-optimized routing.
 * Checks cache → local LLM → API in order of cost.
 */
export async function sendCopilotMessage(
  options: CopilotChatOptions,
): Promise<CopilotChatResult> {
  const { message, taskId, conversationHistory = [] } = options;

  // Build context
  let contextPrompt = message;
  if (taskId) {
    const context = await buildTaskContext(taskId);
    if (context) {
      contextPrompt = `${context}\n\n---\nユーザー: ${message}`;
    }
  }

  // 1. Check cache
  const cacheKey = generateCacheKey(SYSTEM_PROMPT + '\n' + contextPrompt);
  const cachedEntry = getCachedResponse(cacheKey);
  if (cachedEntry) {
    log.debug('Cache hit for copilot message');
    await saveCopilotMessage('user', message, taskId);
    await saveCopilotMessage('assistant', cachedEntry.content, taskId);
    return { content: cachedEntry.content, model: 'cache', tier: 'free', cached: true };
  }

  // 2. Select model
  const localStatus = await getLocalLLMStatus().catch(() => ({
    available: false,
  }));
  const { provider, model, tier } = selectModelTier(
    message,
    (localStatus as { available: boolean }).available,
  );

  log.info(
    { provider, model, tier, messageLength: message.length },
    'Copilot routing',
  );

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
    provider: provider === 'ollama' ? 'ollama' : 'claude',
    model,
    messages,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: tier === 'free' ? 500 : tier === 'economy' ? 800 : 2000,
  });

  const content = response.content;

  // 5. Cache the response
  setCachedResponse(cacheKey, content, 0);

  // 6. Save to DB
  await saveCopilotMessage('user', message, taskId);
  await saveCopilotMessage('assistant', content, taskId);

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

  const localStatus = await getLocalLLMStatus().catch(() => ({
    available: false,
  }));
  const { provider, model, tier } = selectModelTier(
    message,
    (localStatus as { available: boolean }).available,
  );

  const messages: AIMessage[] = [
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: contextPrompt },
  ];

  await saveCopilotMessage('user', message, taskId);

  const stream = await sendAIMessageStream({
    provider: provider === 'ollama' ? 'ollama' : 'claude',
    model,
    messages,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: tier === 'free' ? 500 : tier === 'economy' ? 800 : 2000,
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
