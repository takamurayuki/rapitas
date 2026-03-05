'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { WorkflowRoleConfig, WorkflowRole } from '@/types';
import { createLogger } from "@/lib/logger";

const logger = createLogger("useWorkflowRoles");

export function useWorkflowRoles() {
  const [roles, setRoles] = useState<WorkflowRoleConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/workflow-roles`);
      if (!res.ok) {
        throw new Error(`Failed to fetch workflow roles: ${res.status}`);
      }
      const data = await res.json();
      setRoles(data);
    } catch (err) {
      logger.error('Failed to fetch workflow roles:', err);
      setError(err instanceof Error ? err.message : 'ロール設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const updateRole = useCallback(
    async (
      role: WorkflowRole,
      data: {
        agentConfigId?: number | null;
        modelId?: string | null;
        systemPromptKey?: string | null;
        isEnabled?: boolean;
      },
    ) => {
      try {
        setError(null);
        const res = await fetch(`${API_BASE_URL}/workflow-roles/${role}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Failed to update role: ${res.status}`);
        }
        const updated = await res.json();
        setRoles((prev) =>
          prev.map((r) => (r.role === role ? updated : r)),
        );
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'ロール設定の更新に失敗しました';
        setError(message);
        return { success: false, error: message };
      }
    },
    [],
  );

  return {
    roles,
    isLoading,
    error,
    updateRole,
    refetch: fetchRoles,
  };
}
