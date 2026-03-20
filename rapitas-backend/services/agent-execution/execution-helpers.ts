/**
 * Execution Helpers
 *
 * Shared utilities for agent execution: session management, config validation,
 * precondition checks, DB record creation, and instruction assembly.
 * Used by execution-core.ts and execution-continue.ts.
 */
import { PrismaClient, AgentExecution, AgentSession } from '@prisma/client';

/**
 * Returns an existing session or creates a new one.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param sessionId - Optional existing session ID / 既存セッションID（省略可）
 * @param configId - Required when creating a new session / 新規セッション作成時に必須
 * @returns Resolved AgentSession / AgentSessionオブジェクト
 * @throws {Error} When sessionId is given but not found, or configId is missing for new session
 */
export async function getOrCreateSession(
  prisma: PrismaClient,
  sessionId?: number,
  configId?: number,
): Promise<AgentSession> {
  if (sessionId) {
    const existingSession = await prisma.agentSession.findUnique({
      where: { id: sessionId },
    });

    if (!existingSession) {
      throw new Error('指定されたセッションが見つかりません');
    }

    return existingSession;
  }

  // NOTE: configId is mandatory for new session creation; callers must validate upstream.
  if (!configId) {
    throw new Error('新規セッション作成にはconfigIdが必要です');
  }

  return await prisma.agentSession.create({
    data: {
      configId,
      startedAt: new Date(),
    },
  });
}

/**
 * Retrieves an active agent configuration by ID.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param agentConfigId - Agent config ID to look up / 検索するエージェント設定ID
 * @returns Active AIAgentConfig record / 有効なAIAgentConfigレコード
 * @throws {Error} When config does not exist or is inactive
 */
export async function getAgentConfig(prisma: PrismaClient, agentConfigId: number) {
  const agentConfig = await prisma.aIAgentConfig.findUnique({
    where: { id: agentConfigId },
  });

  if (!agentConfig || !agentConfig.isActive) {
    throw new Error('有効なエージェント設定が見つかりません');
  }

  return agentConfig;
}

/**
 * Ensures no execution is already running in the given session.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param sessionId - Session to check / チェック対象のセッションID
 * @throws {Error} When a running/pending/waiting execution is found
 */
export async function checkExecutionPreconditions(
  prisma: PrismaClient,
  sessionId: number,
): Promise<void> {
  const runningExecution = await prisma.agentExecution.findFirst({
    where: {
      sessionId,
      status: { in: ['running', 'pending', 'waiting_for_input'] },
    },
  });

  if (runningExecution) {
    throw new Error('この実行セッションは既に実行中です');
  }
}

/**
 * Creates a new execution database entry in pending state.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param sessionId - Session this execution belongs to / 紐付けるセッションID
 * @param agentConfigId - Agent config to use / 使用するエージェント設定ID
 * @returns Newly created AgentExecution record / 作成されたAgentExecutionレコード
 */
export async function createExecution(
  prisma: PrismaClient,
  sessionId: number,
  agentConfigId: number,
): Promise<AgentExecution> {
  return await prisma.agentExecution.create({
    data: {
      sessionId,
      agentConfigId,
      command: `Agent execution`,
      status: 'pending',
      startedAt: new Date(),
    },
  });
}

/**
 * Builds the execution instruction string from task and analysis data.
 *
 * @param task - Task record with optional workflowFiles / タスクレコード
 * @param optimizedPrompt - Optional AI-optimized prompt / 最適化済みプロンプト（省略可）
 * @param useTaskAnalysis - Whether to prepend research notice / 調査済み通知を先頭に付加するか
 * @returns Composed instruction string / 構築された指示文字列
 */
export function buildExecutionInstruction(
  task: { description: string | null; workflowFiles?: Array<{ fileType: string }> },
  optimizedPrompt?: string,
  useTaskAnalysis?: boolean,
): string {
  let instruction = task.description || '';

  if (optimizedPrompt) {
    instruction = `${optimizedPrompt}\n\n元のタスク内容:\n${instruction}`;
  }

  if (useTaskAnalysis && task.workflowFiles?.some((f) => f.fileType === 'research')) {
    instruction = `## 事前調査済み\n\nこのタスクは事前調査が完了しています。ワークフローファイルを確認してください。\n\n${instruction}`;
  }

  return instruction;
}
