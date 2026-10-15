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
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useTranslations } from 'next-intl';
import type { AIAgentConfig, WorkflowRole } from '@/types';
import { useWorkflowRoles } from '@/hooks/workflow/useWorkflowRoles';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { WorkflowRoleCard } from './WorkflowRoleCard';
import {
  getRoleConfig,
  type ModelOption,
  type SystemPrompt,
  type RoleConfigItem,
} from './workflow-role-constants';

const logger = createLogger('WorkflowRolesConfig');

type ModeKey = 'lightweight' | 'standard' | 'comprehensive';

interface ModeSettings {
  mode: ModeKey;
  includePlan: boolean;
  autoVerify: boolean;
  complexityMin: number;
  complexityMax: number;
  isEnabled: boolean;
}

const MODE_ORDER: ModeKey[] = ['lightweight', 'standard', 'comprehensive'];

/**
 * Builds the complexity-tier tab metadata (label/tier/short description).
 * A function (not a module constant) because the text is translated.
 *
 * @param t - Translator scoped to the `workflow` namespace / workflow名前空間のt
 * @returns Mode → tab metadata map / モードごとのタブ情報
 */
function getModeMeta(
  t: ReturnType<typeof useTranslations<'workflow'>>,
): Record<ModeKey, { label: string; tier: string; desc: string }> {
  return {
    lightweight: {
      label: t('modeLightweight'),
      tier: t('rolesConfig.tierLow'),
      desc: t('rolesConfig.tierLightweightDesc'),
    },
    standard: {
      label: t('modeStandard'),
      tier: t('rolesConfig.tierMedium'),
      desc: t('rolesConfig.tierStandardDesc'),
    },
    comprehensive: {
      label: t('modeComprehensive'),
      tier: t('rolesConfig.tierHigh'),
      desc: t('rolesConfig.tierComprehensiveDesc'),
    },
  };
}

/** Roles a mode runs, in execution order, derived from its phase toggles. */
function rolesForMode(s: ModeSettings): WorkflowRole[] {
  const r: WorkflowRole[] = ['researcher'];
  if (s.includePlan) {
    r.push('planner');
  }
  r.push('implementer');
  r.push(s.autoVerify ? 'auto_verifier' : 'verifier');
  return r;
}

/**
 * Adapt a role's input/description to the active tier. The implementer and the
 * verifier consume different artifacts depending on which phases the tier runs
 * (e.g. lightweight has no plan.md — the implementer works from research.md and
 * outputs code; the verifier checks the diff against research, not a plan).
 *
 * @param roleKey - The role being rendered. / 対象ロール
 * @param s - The active tier's settings. / ティア設定
 * @param roleConfig - The translated role config map for the current render. / 翻訳済みロール設定
 * @param t - Translator scoped to the `workflow` namespace / workflow名前空間のt
 * @returns A (possibly overridden) role config for display. / 表示用ロール設定
 */
function roleConfigForMode(
  roleKey: WorkflowRole,
  s: ModeSettings,
  roleConfig: Record<WorkflowRole, RoleConfigItem>,
  t: ReturnType<typeof useTranslations<'workflow'>>,
): RoleConfigItem {
  const base = roleConfig[roleKey];
  if (roleKey === 'implementer') {
    if (!s.includePlan) {
      return {
        ...base,
        inputLabel: 'research.md',
        description: t('rolesConfig.implementerNoPlanDescription'),
      };
    }
    return { ...base, inputLabel: 'plan.md', description: t('roles.implementer.description') };
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
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const ROLE_CONFIG = useMemo(() => getRoleConfig(t), [t]);
  const MODE_META = useMemo(() => getModeMeta(t), [t]);
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
    // Models are scoped to the role's configured agent. No agent → no models
    // (the model dropdown stays empty until an agent is selected).
    if (!roleData?.agentConfig) return [];
    return availableModels[roleData.agentConfig.agentType] || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t('rolesConfig.loading')}
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

  // Complexity partition is contiguous and derived from two editable
  // boundaries: lightweight's END and comprehensive's START. Lightweight always
  // starts at 0; comprehensive always ends at 100; standard fills the middle and
  // is computed (display-only).
  const lightMax = modes.find((m) => m.mode === 'lightweight')?.complexityMax ?? 35;
  const compMin = modes.find((m) => m.mode === 'comprehensive')?.complexityMin ?? 71;
  const stdMin = lightMax + 1;
  const stdMax = compMin - 1;

  /** Set lightweight's end (and standard's derived start). */
  const setLightMax = (v: number) => {
    const max = Math.max(0, Math.min(98, v));
    saveMode('lightweight', { complexityMin: 0, complexityMax: max });
    saveMode('standard', { complexityMin: max + 1 });
  };
  /** Set comprehensive's start (and standard's derived end). */
  const setCompMin = (v: number) => {
    const min = Math.max(1, Math.min(100, v));
    saveMode('comprehensive', { complexityMin: min, complexityMax: 100 });
    saveMode('standard', { complexityMax: min - 1 });
  };

  const readonlyBox = (val: number | string) => (
    <span className="w-16 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center text-zinc-500 dark:text-zinc-400">
      {val}
    </span>
  );

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
              <span className="ml-2 text-[11px] text-zinc-500">{MODE_META[activeTab].desc}</span>
              {savingMode === activeTab && (
                <span className="ml-2 text-[10px] text-zinc-500">{tc('saving')}</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>{t('rolesConfig.complexityRangeLabel')}</span>
              {activeTab === 'lightweight' && (
                <>
                  {readonlyBox(0)}
                  <span>〜</span>
                  <input
                    type="number"
                    min={1}
                    max={98}
                    value={activeMode.complexityMax}
                    onChange={(e) => setLightMax(Number(e.target.value))}
                    className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                    aria-label={t('rolesConfig.lightweightMaxLabel')}
                  />
                </>
              )}
              {activeTab === 'standard' && (
                <>
                  {readonlyBox(stdMin)}
                  <span>〜</span>
                  {readonlyBox(stdMax)}
                  <span className="text-zinc-500 dark:text-zinc-500">
                    {t('rolesConfig.standardRangeAutoComputed')}
                  </span>
                </>
              )}
              {activeTab === 'comprehensive' && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={activeMode.complexityMin}
                    onChange={(e) => setCompMin(Number(e.target.value))}
                    className="w-16 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-center"
                    aria-label={t('rolesConfig.comprehensiveMinLabel')}
                  />
                  <span>〜</span>
                  {readonlyBox(100)}
                </>
              )}
            </div>
          </div>

          {/* Roles used by this tier (in execution order) */}
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-2">
            {t('rolesConfig.tierRolesCount', { count: tabRoles.length })}
          </p>
          <div className="space-y-0">
            {tabRoles.map((roleKey, index) => (
              <WorkflowRoleCard
                key={roleKey}
                roleKey={roleKey}
                index={index}
                config={roleConfigForMode(roleKey, activeMode, ROLE_CONFIG, t)}
                roleData={roles.find((r) => r.role === roleKey)}
                models={getModelsForRole(roleKey)}
                systemPrompts={systemPrompts}
                activeAgents={activeAgents}
                availableModels={availableModels}
                isSaving={savingRole === roleKey}
                isSaved={saveSuccess === roleKey}
                isExpanded={expandedRole === roleKey}
                isLast={index === tabRoles.length - 1}
                // Approval gate (reviews plan.md) sits right before 実装 — only
                // when this tier has a plan.
                approvalAfter={activeMode.includePlan && tabRoles[index + 1] === 'implementer'}
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
