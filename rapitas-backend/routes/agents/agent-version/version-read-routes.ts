/**
 * Agent Version Read Routes
 *
 * Elysia GET route handlers for listing agent versions and querying version history.
 * Install / update / uninstall mutations live in version-write-routes.ts.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  AVAILABLE_AGENT_VERSIONS,
  getVersionChangeDescription,
  type VersionInfo,
} from './version-registry';

const log = createLogger('routes:agent-version-read');

export const agentVersionReadRoutes = new Elysia()

  // Get available versions for all agents
  .get('/agents/versions', async () => {
    try {
      const agents = await prisma.aIAgentConfig.findMany({
        where: { isActive: true },
        select: {
          id: true,
          agentType: true,
          name: true,
          version: true,
          latestVersion: true,
          isInstalled: true,
          installPath: true,
          updatedAt: true,
        },
      });

      const agentsWithVersions = agents.map((agent) => {
        const availableVersions =
          AVAILABLE_AGENT_VERSIONS[agent.agentType as keyof typeof AVAILABLE_AGENT_VERSIONS] || {};
        const versionList = (Object.values(availableVersions) as VersionInfo[]).sort(
          (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime(),
        );

        return {
          ...agent,
          availableVersions: versionList,
          hasUpdate:
            agent.version && agent.latestVersion ? agent.version !== agent.latestVersion : false,
          status: agent.isInstalled ? 'installed' : 'not_installed',
        };
      });

      return { success: true, data: agentsWithVersions };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Read] Error fetching agent versions');
      return {
        success: false,
        error: 'Failed to fetch agent versions',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Get version details for specific agent type
  .get('/agent-types/:agentType/versions', async ({ params }) => {
    try {
      const { agentType } = params;

      const agent = await prisma.aIAgentConfig.findFirst({
        where: { agentType, isActive: true },
      });

      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const availableVersions =
        AVAILABLE_AGENT_VERSIONS[agentType as keyof typeof AVAILABLE_AGENT_VERSIONS] || {};
      const versionList = Object.values(availableVersions).sort(
        (a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime(),
      );

      return {
        success: true,
        data: {
          agent: {
            id: agent.id,
            agentType: agent.agentType,
            name: agent.name,
            currentVersion: agent.version,
            latestVersion: agent.latestVersion,
            isInstalled: agent.isInstalled,
            installPath: agent.installPath,
          },
          availableVersions: versionList,
          hasUpdate:
            agent.version && agent.latestVersion ? agent.version !== agent.latestVersion : false,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Read] Error fetching agent version details');
      return {
        success: false,
        error: 'Failed to fetch agent version details',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  })

  // Get version history for agent
  .get('/agents/:id/version-history', async ({ params }) => {
    try {
      const agentId = parseInt(params.id);

      const agent = await prisma.aIAgentConfig.findUnique({ where: { id: agentId } });
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const auditLogs = await prisma.agentConfigAuditLog.findMany({
        where: {
          agentConfigId: agentId,
          action: { in: ['update_version', 'install', 'uninstall'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const versionHistory = auditLogs.map((entry) => {
        let changeDetails: Record<string, unknown> = {};
        let previousValues: Record<string, unknown> = {};
        let newValues: Record<string, unknown> = {};

        try {
          if (entry.changeDetails) changeDetails = JSON.parse(entry.changeDetails);
          if (entry.previousValues) previousValues = JSON.parse(entry.previousValues);
          if (entry.newValues) newValues = JSON.parse(entry.newValues);
        } catch {
          // NOTE: Malformed audit log JSON is non-fatal — skip gracefully.
        }

        return {
          id: entry.id,
          action: entry.action,
          timestamp: entry.createdAt,
          changeDetails,
          previousValues,
          newValues,
          description: getVersionChangeDescription(
            entry.action,
            changeDetails,
            previousValues,
            newValues,
          ),
        };
      });

      return {
        success: true,
        data: {
          agent: {
            id: agent.id,
            name: agent.name,
            agentType: agent.agentType,
            currentVersion: agent.version,
            isInstalled: agent.isInstalled,
          },
          versionHistory,
        },
      };
    } catch (error) {
      log.error({ err: error }, '[Agent Version Read] Error fetching version history');
      return {
        success: false,
        error: 'Failed to fetch version history',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });
