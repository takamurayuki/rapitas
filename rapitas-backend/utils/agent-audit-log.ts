/**
 * AIエージェント設定変更の監査ログユーティリティ
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "api_key_set"
  | "api_key_delete"
  | "test_connection"
  | "update_version"
  | "install"
  | "uninstall";

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
 * 監査ログを記録する
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
    console.log(`[AuditLog] Agent ${entry.agentConfigId}: ${entry.action}`);
  } catch (error) {
    console.error("[AuditLog] Failed to create audit log:", error);
    // 監査ログの記録失敗は、メイン処理をブロックしない
  }
}

/**
 * 特定のエージェントの監査ログを取得
 */
export async function getAgentConfigAuditLogs(
  agentConfigId: number,
  limit: number = 50
) {
  return prisma.agentConfigAuditLog.findMany({
    where: { agentConfigId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * 最近の監査ログを取得
 */
export async function getRecentAuditLogs(limit: number = 100) {
  return prisma.agentConfigAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * 設定変更の差分を計算
 */
export function calculateChanges(
  previous: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const key of allKeys) {
    // 機密情報はマスク
    if (key.toLowerCase().includes("apikey") || key.toLowerCase().includes("secret")) {
      if (previous[key] !== current[key]) {
        changes[key] = { from: "***", to: "***" };
      }
      continue;
    }

    const prevValue = previous[key];
    const currValue = current[key];

    // 値が異なる場合のみ記録
    if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
      changes[key] = { from: prevValue, to: currValue };
    }
  }

  return changes;
}

