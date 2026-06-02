'use client';

/**
 * WorkflowRolesConfig
 *
 * Unified workflow configuration, organised by complexity tier (低/中/高) as
 * tabs. Each tab shows that tier's workflow-mode settings (which phases run +
 * the complexity range) and the agent/model configuration for ONLY the roles
 * that tier actually uses. Replaces the separate roles + modes panels.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { AIAgentConfig, WorkflowRole } from '@/types';
import { useWorkflowRoles } from '@/hooks/workflow/useWorkflowRoles';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { WorkflowRoleCard } from './WorkflowRoleCard';
import {
  ROLE_CONFIG,
  type ModelOption,
  type SystemPrompt,
  type RoleConfigItem,
} from './workflow-role-constants';

const logger = createLogger('WorkflowRolesConfig');

type ModeKey = 'lightweight' | 'standard' | 'comprehensive';

interface ModeSettings {
  mode: ModeKey;
  includePlan: boolean;
  includeReview: boolean;
  autoVerify: boolean;
  complexityMin: number;
  complexityMax: number;
  isEnabled: boolean;
}

const MODE_ORDER: ModeKey[] = ['lightweight', 'standard', 'comprehensive'];
const MODE_META: Record<ModeKey, { label: string; tier: string; desc: string }> = {
  lightweight: { label: '軽量', tier: '低', desc: 'バグ修正・UI調整・軽微な変更' },
  standard: { label: '標準', tier: '中', desc: '中規模の機能追加・リファクタリング' },
  comprehensive: { label: '詳細', tier: '高', desc: '大規模機能・アーキテクチャ変更' },
};

/** Roles a mode runs, in execution order, derived from its phase toggles. */
function rolesForMode(s: ModeSettings): WorkflowRole[] {
  const r: WorkflowRole[] = ['researcher'];
  if (s.includePlan) {
    r.push('planner');
    if (s.includeReview) r.push('reviewer');
  }
  r.push('implementer');
  r.push(s.autoVerify ? 'auto_verifier' : 'verifier');
  return r;
}

/**
 * Ordered execution flow for display, with the user-approval gate placed where
 * it actually fires: right AFTER the plan (and review) and BEFORE implementation
 * — the approval reviews plan.md. Tiers without a plan have no approval gate.
 *
 * @param s - The active tier's settings. / ティア設定
 * @returns Ordered flow steps. / 実行フロー
 */
function phaseFlow(s: ModeSettings): { label: string; kind: 'phase' | 'approval' }[] {
  const flow: { label: string; kind: 'phase' | 'approval' }[] = [{ label: '調査', kind: 'phase' }];
  if (s.includePlan) {
    flow.push({ label: '計画', kind: 'phase' });
    if (s.includeReview) flow.push({ label: 'レビュー', kind: 'phase' });
    flow.push({ label: 'ユーザー承認', kind: 'approval' });
  }
  flow.push({ label: '実装', kind: 'phase' });
  flow.push({ label: '検証', kind: 'phase' });
  flow.push({ label: '完了', kind: 'phase' });
  return flow;
}

/**
 * Adapt a role's input/description to the active tier. The implementer and the
 * verifier consume different artifacts depending on which phases the tier runs
 * (e.g. lightweight has no plan.md — the implementer works from research.md and
 * outputs code; the verifier checks the diff against research, not a plan).
 *
 * @param roleKey - The role being rendered. / 対象ロール
 * @param s - The active tier's settings. / ティア設定
 * @returns A (possibly overridden) role config for display. / 表示用ロール設定
 */
function roleConfigForMode(roleKey: WorkflowRole, s: ModeSettings): RoleConfigItem {
  const base = ROLE_CONFIG[roleKey];
  if (roleKey === 'implementer') {
    if (!s.includePlan) {
      return { ...base, inputLabel: 'research.md', description: '調査結果を基にコードを実装' };
    }
    if (!s.includeReview) {
      return { ...base, inputLabel: 'plan.md', description: '承認された計画に従いコードを実装' };
    }
    return base; // plan + review → default input 'plan.md + question.md'
  }
  if ((roleKey === 'verifier' || roleKey === 'auto_verifier') && !s.includePlan) {
    return { ...base, inputLabel: 'research.md + diff' };
  }
  return base;
}

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

  const [modes, setModes] = useState<ModeSettings[]>([]);
  const [activeTab, setActiveTab] = useState<ModeKey>('standard');
  const [savingMode, setSavingMode] = useState<ModeKey | null>(null);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/system-prompts?category=workflow`);
        if (res.ok) setSystemPrompts(await res.json());
      } catch (err) {
        logger.error('Failed to fetch system prompts:', err);
      }
    };
    fetchPrompts();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow-modes`);
        if (res.ok) {
          const data = await res.json();
          setModes(data.modes ?? []);
        }
      } catch (err) {
        logger.error('Failed to fetch workflow modes:', err);
      }
    })();
  }, []);

  const activeAgents = useMemo(() => agents.filter((a) => a.isActive), [agents]);
  const activeMode = modes.find((m) => m.mode === activeTab);

  const saveMode = useCallback(async (mode: ModeKey, patch: Partial<ModeSettings>) => {
    setSavingMode(mode);
    setModes((prev) => prev.map((m) => (m.mode === mode ? { ...m, ...patch } : m)));
    try {
      const res = await fetch(`${API_BASE_URL}/workflow-modes/${mode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mode) setModes((prev) => prev.map((m) => (m.mode === mode ? data.mode : m)));
      }
    } catch (err) {
      logger.error('Failed to save workflow mode:', err);
    } finally {
      setSavingMode(null);
    }
  }, []);

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

  const tabRoles = activeMode ? rolesForMode(activeMode) : [];

  return (
    <div>
      {/* Complexity-tier tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 mb-4">
        {MODE_ORDER.map((mode) => {
          const meta = MODE_META[mode];
          const isActive = activeTab === mode;
          return (
            <button
              key={mode}
              onClick={() => setActiveTab(mode)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {activeMode && (
        <>
          {/* Mode settings for the active tier — complexity range only.
              The phase composition per tier is fixed (shown by the role cards
              below); only the complexity range that selects this tier is set here. */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 mb-4">
            <div className="text-sm text-zinc-600 dark:text-zinc-300 mb-2">
              <span className="font-semibold">{MODE_META[activeTab].label}</span>
              <span className="ml-2 text-[11px] text-zinc-400">{MODE_META[activeTab].desc}</span>
              {savingMode === activeTab && (
                <span className="ml-2 text-[10px] text-zinc-400">保存中...</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>このワークフローを適用する複雑度範囲</span>
              <input
                type="number"
                min={0}
                max={100}
                value={activeMode.complexityMin}
                onChange={(e) => saveMode(activeTab, { complexityMin: Number(e.target.value) })}
                className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                aria-label="複雑度下限"
              />
              <span>〜</span>
              <input
                type="number"
                min={0}
                max={100}
                value={activeMode.complexityMax}
                onChange={(e) => saveMode(activeTab, { complexityMax: Number(e.target.value) })}
                className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                aria-label="複雑度上限"
              />
            </div>
          </div>

          {/* Execution flow — shows the order and where user approval occurs.
              Approval reviews plan.md, so it sits after 計画/レビュー and before
              実装 (tiers without a plan have no approval gate). */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 mb-4">
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2">実行フロー</div>
            <div className="flex flex-wrap items-center gap-1">
              {phaseFlow(activeMode).map((p, i) => (
                <span key={`${p.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-600 text-xs">→</span>}
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      p.kind === 'approval'
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {p.kind === 'approval' ? `👤 ${p.label}` : p.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Roles used by this tier (in execution order) */}
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2">
            このティアで実行するロール（{tabRoles.length}フェーズ）
          </p>
          <div className="space-y-0">
            {tabRoles.map((roleKey, index) => (
              <WorkflowRoleCard
                key={roleKey}
                roleKey={roleKey}
                index={index}
                config={roleConfigForMode(roleKey, activeMode)}
                roleData={roles.find((r) => r.role === roleKey)}
                models={getModelsForRole(roleKey)}
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
