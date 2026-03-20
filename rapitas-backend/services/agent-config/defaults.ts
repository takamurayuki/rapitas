/**
 * Agent Config Default Agent Resolver
 *
 * Resolves the default active agent, providing a built-in fallback when no
 * default is configured in the database.
 */

import { prisma } from '../../config/database';

/** Returns the default active agent, falling back to a built-in Claude Code config. */
export async function getDefaultAgent() {
  const defaultAgent = await prisma.aIAgentConfig.findFirst({
    where: { isDefault: true, isActive: true },
  });

  if (!defaultAgent) {
    // NOTE: Falls back to built-in Claude Code when no default agent is configured in DB.
    return {
      id: -1,
      agentType: 'claude-code',
      name: 'Claude Code (Built-in)',
      isDefault: true,
      isActive: true,
      apiKeyEncrypted: null,
      endpoint: null,
      modelId: null,
      capabilities: '{}',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return defaultAgent;
}
