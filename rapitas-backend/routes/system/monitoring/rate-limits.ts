/**
 * Rate Limit & Usage API Routes
 *
 * Returns actual usage from AgentExecution + CopilotMessage records.
 * For CLI agents (Claude Code etc.) where tokensUsed is not recorded,
 * estimates tokens from execution time.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:rate-limits');

type UsageInfo = {
  provider: string;
  plan: string;
  tokensUsed: number;
  estimatedCost: number;
  executionCount: number;
  avgExecutionTimeSec: number;
  period: string;
  periodStart: string;
  periodEnd: string;
  dataSource: 'actual' | 'estimated';
  lastUpdated: string;
};

/** Cost per 1K tokens by model prefix (approximate). */
const COST_PER_1K: Record<string, number> = {
  'claude-opus': 0.025,
  'claude-sonnet': 0.006,
  'claude-haiku': 0.001,
  'gpt-4o-mini': 0.0002,
  'gpt-4o': 0.005,
  'gpt-4-turbo': 0.01,
  gemini: 0.0005,
  ollama: 0,
  llama: 0,
  qwen: 0,
};

/**
 * Estimate tokens from execution time when tokensUsed is not recorded.
 * CLI agents (Claude Code) don't report token counts, so we estimate
 * based on average throughput: ~30 tokens/sec for Sonnet-class models.
 */
function estimateTokensFromTime(executionTimeMs: number | null): number {
  if (!executionTimeMs || executionTimeMs < 1000) return 0;
  const seconds = executionTimeMs / 1000;
  return Math.round(seconds * 30);
}

function estimateCost(modelId: string | null, tokens: number): number {
  if (!modelId || tokens === 0) return 0;
  const lower = modelId.toLowerCase();
  for (const [prefix, rate] of Object.entries(COST_PER_1K)) {
    if (lower.includes(prefix)) return (tokens / 1000) * rate;
  }
  return (tokens / 1000) * 0.003;
}

function resolveProvider(agentType: string | null, command: string | null): string {
  if (agentType) {
    if (agentType.includes('claude') || agentType === 'claude-code') return 'claude';
    if (agentType.includes('codex') || agentType.includes('openai')) return 'chatgpt';
    if (agentType.includes('gemini')) return 'gemini';
    if (agentType.includes('ollama') || agentType.includes('local')) return 'local';
    return agentType;
  }
  // Fallback: infer from command/output when agentConfigId is null
  if (command) {
    const lower = command.toLowerCase();
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gpt') || lower.includes('openai')) return 'chatgpt';
    if (lower.includes('gemini')) return 'gemini';
  }
  return 'claude'; // Default: most executions without config are claude-code
}

export const rateLimitRoutes = new Elysia({ prefix: '/rate-limits' }).get('/', async () => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const executions = await prisma.agentExecution.findMany({
      where: {
        createdAt: { gte: monthStart },
        status: { in: ['completed', 'running', 'failed'] },
      },
      select: {
        tokensUsed: true,
        executionTimeMs: true,
        command: true,
        agentConfig: { select: { agentType: true, modelId: true } },
      },
    });

    const byProvider = new Map<
      string,
      {
        tokens: number;
        cost: number;
        count: number;
        totalTimeMs: number;
        plan: string;
        isEstimated: boolean;
        modelId: string | null;
      }
    >();

    for (const exec of executions) {
      const agentType = exec.agentConfig?.agentType ?? null;
      const modelId = exec.agentConfig?.modelId ?? 'claude-sonnet-4-6';
      const provider = resolveProvider(agentType, exec.command);

      // Use recorded tokens if available, otherwise estimate from execution time
      let tokens = exec.tokensUsed ?? 0;
      let isEstimated = false;
      if (tokens === 0 && exec.executionTimeMs) {
        tokens = estimateTokensFromTime(exec.executionTimeMs);
        isEstimated = true;
      }

      const existing = byProvider.get(provider) ?? {
        tokens: 0,
        cost: 0,
        count: 0,
        totalTimeMs: 0,
        plan: provider === 'local' ? 'Local (Free)' : 'API',
        isEstimated: false,
        modelId: null,
      };
      existing.tokens += tokens;
      existing.cost += estimateCost(modelId, tokens);
      existing.count += 1;
      existing.totalTimeMs += exec.executionTimeMs ?? 0;
      if (isEstimated) existing.isEstimated = true;
      if (!existing.modelId) existing.modelId = modelId;
      byProvider.set(provider, existing);
    }

    const copilotMessages = await prisma.copilotMessage.count({
      where: { createdAt: { gte: monthStart }, role: 'assistant' },
    });

    const usageData: UsageInfo[] = [];
    const periodStr = `${now.getFullYear()}/${now.getMonth() + 1}`;

    for (const [provider, data] of byProvider) {
      usageData.push({
        provider,
        plan: data.plan,
        tokensUsed: data.tokens,
        estimatedCost: Math.round(data.cost * 1000) / 1000,
        executionCount: data.count,
        avgExecutionTimeSec: data.count > 0 ? Math.round(data.totalTimeMs / data.count / 1000) : 0,
        period: periodStr,
        periodStart: monthStart.toISOString(),
        periodEnd: monthEnd.toISOString(),
        dataSource: data.isEstimated ? 'estimated' : 'actual',
        lastUpdated: now.toISOString(),
      });
    }

    if (copilotMessages > 0) {
      usageData.push({
        provider: 'copilot',
        plan: 'Copilot Chat',
        tokensUsed: 0,
        estimatedCost: 0,
        executionCount: copilotMessages,
        avgExecutionTimeSec: 0,
        period: periodStr,
        periodStart: monthStart.toISOString(),
        periodEnd: monthEnd.toISOString(),
        dataSource: 'actual',
        lastUpdated: now.toISOString(),
      });
    }

    // Sort: most used first
    usageData.sort((a, b) => b.tokensUsed - a.tokensUsed || b.executionCount - a.executionCount);

    return { usageData };
  } catch (error) {
    log.error({ err: error }, 'Error fetching usage data');
    return { usageData: [] };
  }
});
