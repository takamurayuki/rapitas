/**
 * Agent Configuration Router
 * エージェント設定管理（CRUD操作、デフォルト設定、スキーマ取得）
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { fromJsonString } from '../../utils/db-helpers';
import { getAgentConfigSchema, getAllAgentConfigSchemas } from '../../utils/agent-config-schema';
import { logAgentConfigChange } from '../../utils/agent-audit-log';
import { NotFoundError, ValidationError, parseId } from '../../middleware/error-handler';

export const agentConfigRouter = new Elysia()
  // Agent configuration list (active only)
  .get('/agents', async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 開発用とレビュー用のエージェントのみを返す
    const filteredAgents = agents.filter((agent: (typeof agents)[0]) => {
      // 開発用エージェント設定を確認
      const isDevelopmentAgent = agent.name.includes('Development Agent');
      // レビュー用エージェント設定を確認
      const isReviewAgent = agent.name.includes('Review Agent');
      // デフォルトエージェント
      const isDefaultAgent = agent.isDefault;

      return isDevelopmentAgent || isReviewAgent || isDefaultAgent;
    });

    return filteredAgents.map((agent: (typeof filteredAgents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Agent configuration list (all, including inactive - for management page)
  .get('/agents/all', async () => {
    const agents = await prisma.aIAgentConfig.findMany({
      include: {
        _count: { select: { executions: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return agents.map((agent: (typeof agents)[0]) => ({
      ...agent,
      capabilities: fromJsonString(agent.capabilities) ?? {},
    }));
  })

  // Toggle agent active status
  .put(
    '/agents/:id/toggle-active',
    async (context) => {
      const { params } = context;
      const agentId = parseId(params.id, 'agent ID');

      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        throw new NotFoundError('Agent not found');
      }

      // デフォルトエージェントは無効化できない
      if (agent.isDefault && agent.isActive) {
        throw new ValidationError(
          'デフォルトエージェントは無効化できません。先に別のエージェントをデフォルトに設定してください。',
        );
      }

      const updated = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: { isActive: !agent.isActive },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'update',
        changeDetails: {
          isActive: { from: agent.isActive, to: updated.isActive },
        },
        previousValues: { isActive: agent.isActive },
        newValues: { isActive: updated.isActive },
      });

      return updated;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Get default agent configuration
  .get('/agents/default', async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!defaultAgent) {
      // DBにデフォルトエージェントが設定されていない場合、組み込みのClaude Codeをフォールバックとして返す
      return {
        id: null,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        modelId: null,
        isDefault: true,
        isActive: true,
        isBuiltinFallback: true,
      };
    }
    return {
      ...defaultAgent,
      capabilities: fromJsonString(defaultAgent.capabilities) ?? {},
      isBuiltinFallback: false,
    };
  })

  // Set default agent by ID
  .put(
    '/agents/:id/set-default',
    async (context) => {
      const { params } = context;
      const agentId = parseId(params.id, 'agent ID');

      // エージェントが存在し、アクティブであることを確認
      const agent = await prisma.aIAgentConfig.findUnique({
        where: { id: agentId },
      });
      if (!agent) {
        throw new NotFoundError('Agent not found');
      }
      if (!agent.isActive) {
        throw new ValidationError('Cannot set inactive agent as default');
      }

      // トランザクション内で実行して、同時に1つのエージェントだけがデフォルトであることを保証
      const result = await prisma.$transaction(async (tx) => {
        // 既存のデフォルトエージェントをクリア
        await tx.aIAgentConfig.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });

        // 新しいデフォルトエージェントを設定
        const newDefault = await tx.aIAgentConfig.update({
          where: { id: agentId },
          data: { isDefault: true },
        });

        return newDefault;
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'update',
        changeDetails: {
          isDefault: { from: false, to: true },
        },
        previousValues: { isDefault: false },
        newValues: { isDefault: true },
      });

      return result;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // Remove default agent (unset default)
  .delete('/agents/default', async () => {
    const defaultAgent = await prisma.aIAgentConfig.findFirst({
      where: { isDefault: true },
    });

    if (!defaultAgent) {
      throw new NotFoundError('No default agent is currently set');
    }

    const updated = await prisma.aIAgentConfig.update({
      where: { id: defaultAgent.id },
      data: { isDefault: false },
    });

    await logAgentConfigChange({
      agentConfigId: defaultAgent.id,
      action: 'update',
      changeDetails: {
        isDefault: { from: true, to: false },
      },
      previousValues: { isDefault: true },
      newValues: { isDefault: false },
    });

    return { success: true, message: 'Default agent unset successfully' };
  })

  // Get all agent configuration schemas
  .get('/agents/config-schemas', async () => {
    return {
      schemas: getAllAgentConfigSchemas(),
    };
  })

  // Get configuration schema for a specific agent type
  .get(
    '/agents/config-schema/:agentType',
    async ({ params }) => {
      const { agentType } = params;
      const schema = getAgentConfigSchema(agentType);

      if (!schema) {
        throw new NotFoundError(`Unknown agent type: ${agentType}`);
      }

      return { schema };
    },
    {
      params: t.Object({
        agentType: t.String(),
      }),
    },
  );
