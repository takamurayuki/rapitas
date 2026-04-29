/**
 * Agent Config Audit Log
 *
 * Utility for recording audit logs of AI agent configuration changes.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('agent-audit-log');

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'api_key_set'
  | 'api_key_delete'
  | 'test_connection'
  | 'update_version'
  | 'install'
  | 'uninstall';

export interface AuditLogEntry {
  agentConfigId: number;
  action: AuditAction;
  changeDetails?: Record<string, unknown>;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Records an audit log entry for an agent configuration change.
 *
 * @param entry - The audit log entry to record
 */
export async function logAgentConfigChange(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.agentConfigAuditLog.create({
      data: {
        agentConfigId: entry.agentConfigId,
        action: entry.action,
        changeDetails: entry.changeDetails ? JSON.stringify(entry.changeDetails) : null,
        previousValues: entry.previousValues ? JSON.stringify(entry.previousValues) : null,
        newValues: entry.newValues ? JSON.stringify(entry.newValues) : null,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
    log.info(`Agent ${entry.agentConfigId}: ${entry.action}`);
  } catch (error) {
    log.error({ err: error }, 'Failed to create audit log');
    // Audit log failure must not block the main operation
  }
}

/**
 * Retrieves audit logs for a specific agent configuration.
 *
 * @param agentConfigId - The agent config ID to query
 * @param limit - Maximum number of entries to return
 */
export async function getAgentConfigAuditLogs(agentConfigId: number, limit: number = 50) {
  return prisma.agentConfigAuditLog.findMany({
    where: { agentConfigId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Retrieves the most recent audit log entries across all agents.
 *
 * @param limit - Maximum number of entries to return
 */
export async function getRecentAuditLogs(limit: number = 100) {
  return prisma.agentConfigAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Computes the diff between previous and current configuration values.
 * Sensitive fields (apiKey, secret) are masked in the output.
 *
 * @param previous - Previous configuration values
 * @param current - Current configuration values
 * @returns A record of changed fields with their before/after values
 */
export function calculateChanges(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const key of allKeys) {
    // Mask sensitive fields
    if (key.toLowerCase().includes('apikey') || key.toLowerCase().includes('secret')) {
      if (previous[key] !== current[key]) {
        changes[key] = { from: '***', to: '***' };
      }
      continue;
    }

    const prevValue = previous[key];
    const currValue = current[key];

    if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
      changes[key] = { from: prevValue, to: currValue };
    }
  }

  return changes;
}
