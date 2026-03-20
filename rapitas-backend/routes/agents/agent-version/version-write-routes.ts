/**
 * Agent Version Write Routes
 *
 * Elysia POST route handlers for installing, updating, and uninstalling agents.
 * Read-only GET routes live in version-read-routes.ts.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { logAgentConfigChange } from '../../../utils/agent/agent-audit-log';
import { createLogger } from '../../../config/logger';
import { AVAILABLE_AGENT_VERSIONS, getLatestVersionKey } from './version-registry';

const log = createLogger('routes:agent-version-write');

export const agentVersionWriteRoutes = new Elysia()

  // Update agent to specific version
  .post('/agents/:id/update', async ({ params, body }) => {
    try {
      const agentId = parseInt(params.id);
      const { targetVersion } = body as { targetVersion: string };

      const agent = await prisma.aIAgentConfig.findUnique({ where: { id: agentId } });
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const availableVersions =
        AVAILABLE_AGENT_VERSIONS[agent.agentType as keyof typeof AVAILABLE_AGENT_VERSIONS];
      const targetVersionInfo =
        availableVersions?.[targetVersion as keyof typeof availableVersions];

      if (!targetVersionInfo) {
        return { success: false, error: 'Target version not available' };
      }

      const previousVersion = agent.version;

      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: targetVersion,
          latestVersion: getLatestVersionKey(agent.agentType),
          isInstalled: true,
          installPath: `/usr/local/agents/${agent.agentType}/${targetVersion}`,
          updatedAt: new Date(),
        },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'update_version',
        changeDetails: { from: previousVersion, to: targetVersion, versionInfo: targetVersionInfo },
        previousValues: { version: previousVersion },
        newValues: { version: targetVersion },
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          versionInfo: targetVersionInfo,
          message: `Successfully updated ${agent.name} from version ${previousVersion || 'none'} to ${targetVersion}`,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Write] Error updating agent version');
      return {
        success: false,
        error: 'Failed to update agent version',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Install agent
  .post('/agents/:id/install', async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({ where: { id: agentId } });
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      if (agent.isInstalled) {
        return { success: false, error: 'Agent is already installed' };
      }

      const latestVersion = getLatestVersionKey(agent.agentType);

      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: latestVersion,
          latestVersion,
          isInstalled: true,
          installPath: `/usr/local/agents/${agent.agentType}/${latestVersion}`,
          updatedAt: new Date(),
        },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'install',
        changeDetails: { version: latestVersion, installPath: updatedAgent.installPath },
        previousValues: { isInstalled: false },
        newValues: { isInstalled: true },
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          message: `Successfully installed ${agent.name} version ${latestVersion}`,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Write] Error installing agent');
      return {
        success: false,
        error: 'Failed to install agent',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Uninstall agent
  .post('/agents/:id/uninstall', async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({ where: { id: agentId } });
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      if (!agent.isInstalled) {
        return { success: false, error: 'Agent is not installed' };
      }

      const previousVersion = agent.version;
      const previousPath = agent.installPath;

      const updatedAgent = await prisma.aIAgentConfig.update({
        where: { id: agentId },
        data: {
          version: null,
          isInstalled: false,
          installPath: null,
          updatedAt: new Date(),
        },
      });

      await logAgentConfigChange({
        agentConfigId: agentId,
        action: 'uninstall',
        changeDetails: { previousVersion, previousPath },
        previousValues: { isInstalled: true, version: previousVersion, installPath: previousPath },
        newValues: { isInstalled: false, version: null, installPath: null },
      });

      return {
        success: true,
        data: {
          agent: updatedAgent,
          message: `Successfully uninstalled ${agent.name}`,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Write] Error uninstalling agent');
      return {
        success: false,
        error: 'Failed to uninstall agent',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });
