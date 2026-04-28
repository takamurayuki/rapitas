'use client';

/**
 * WorkflowRolesConfig
 *
 * Configuration panel for workflow roles: researcher, planner, reviewer,
 * implementer, and verifier. Each role can be configured with an AI agent,
 * model, and system prompt, or set to auto-select mode.
 */
import { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { AIAgentConfig, WorkflowRole } from '@/types';
import { useWorkflowRoles } from '@/hooks/workflow/useWorkflowRoles';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { WorkflowRoleCard } from './WorkflowRoleCard';
import {
  ROLE_CONFIG,
  ROLE_ORDER,
  type ModelOption,
  type SystemPrompt,
} from './workflow-role-constants';

const logger = createLogger('WorkflowRolesConfig');

interface WorkflowRolesConfigProps {
  agents: AIAgentConfig[];
  availableModels: Record<string, ModelOption[]>;
}

export default function WorkflowRolesConfig({ agents, availableModels }: WorkflowRolesConfigProps) {
  const { roles, isLoading, error, updateRole } = useWorkflowRoles();
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [savingRole, setSavingRole] = useState<WorkflowRole | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<WorkflowRole | null>(null);
  const [expandedRole, setExpandedRole] = useState<WorkflowRole | null>(null);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/system-prompts?category=workflow`);
        if (res.ok) {
          const data = await res.json();
          setSystemPrompts(data);
        }
      } catch (err) {
        logger.error('Failed to fetch system prompts:', err);
      }
    };
    fetchPrompts();
  }, []);

  const activeAgents = useMemo(() => agents.filter((a) => a.isActive), [agents]);

  const handleAgentChange = async (role: WorkflowRole, agentConfigId: number | null) => {
    setSavingRole(role);
    const currentRole = roles.find((r) => r.role === role);
    const wasAutoMode = !currentRole?.modelId || currentRole.modelId === 'auto';
    let nextModelId: string | null = null;
    if (!wasAutoMode) {
      const newAgent = activeAgents.find((a) => a.id === agentConfigId);
      const newAgentModels = newAgent ? (availableModels[newAgent.agentType] ?? []) : [];
      nextModelId = newAgent?.modelId || newAgentModels[0]?.value || currentRole?.modelId || null;
    }
    const result = await updateRole(role, { agentConfigId, modelId: nextModelId });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handleManualSetup = async (role: WorkflowRole, agentConfigId: number, modelId: string) => {
    setSavingRole(role);
    const result = await updateRole(role, { agentConfigId, modelId });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handleModelChange = async (role: WorkflowRole, modelId: string | null) => {
    setSavingRole(role);
    const result = await updateRole(role, { modelId });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handlePreferredProviderChange = async (
    role: WorkflowRole,
    preferredProviderOverride: string | null,
  ) => {
    setSavingRole(role);
    const result = await updateRole(role, { preferredProviderOverride });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handlePromptChange = async (role: WorkflowRole, systemPromptKey: string | null) => {
    setSavingRole(role);
    await updateRole(role, { systemPromptKey });
    setSavingRole(null);
  };

  const handleToggleEnabled = async (role: WorkflowRole, isEnabled: boolean) => {
    setSavingRole(role);
    await updateRole(role, { isEnabled });
    setSavingRole(null);
  };

  const getModelsForRole = (roleKey: WorkflowRole): ModelOption[] => {
    const roleData = roles.find((r) => r.role === roleKey);
    if (!roleData?.agentConfig) return [];
    return availableModels[roleData.agentConfig.agentType] || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          ロール設定を読み込み中...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <div className="flex items-center">
          <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {ROLE_ORDER.map((roleKey, index) => {
        const config = ROLE_CONFIG[roleKey];
        const roleData = roles.find((r) => r.role === roleKey);
        const models = getModelsForRole(roleKey);

        return (
          <WorkflowRoleCard
            key={roleKey}
            roleKey={roleKey}
            index={index}
            config={config}
            roleData={roleData}
            models={models}
            systemPrompts={systemPrompts}
            activeAgents={activeAgents}
            availableModels={availableModels}
            isSaving={savingRole === roleKey}
            isSaved={saveSuccess === roleKey}
            isExpanded={expandedRole === roleKey}
            onToggleExpand={() => setExpandedRole(expandedRole === roleKey ? null : roleKey)}
            onAgentChange={(id) => handleAgentChange(roleKey, id)}
            onModelChange={(id) => handleModelChange(roleKey, id)}
            onPreferredProviderChange={(p) => handlePreferredProviderChange(roleKey, p)}
            onPromptChange={(k) => handlePromptChange(roleKey, k)}
            onToggleEnabled={(e) => handleToggleEnabled(roleKey, e)}
            onManualSetup={(aid, mid) => handleManualSetup(roleKey, aid, mid)}
          />
        );
      })}
    </div>
  );
}
