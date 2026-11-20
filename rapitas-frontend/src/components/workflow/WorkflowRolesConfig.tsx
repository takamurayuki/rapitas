'use client';

/**
 * WorkflowRolesConfig
 *
 * Unified workflow configuration, organised by complexity tier (低/中/高) as
 * tabs. Each tab shows that tier's workflow-mode settings (which phases run +
 * the complexity range) and the roles that tier actually uses. The agent and
 * model of each role are not configured here: they are built automatically
 * from the providers this host can run (`GET /workflow/phase-routing`).
 */
import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useTranslations } from 'next-intl';
import type { WorkflowRole } from '@/types';
import { useWorkflowRoles } from '@/hooks/workflow/useWorkflowRoles';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { WorkflowRoleCard, type RoleRoutingRule } from './WorkflowRoleCard';
import { getRoleConfig, type SystemPrompt, type RoleConfigItem } from './workflow-role-constants';

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

/** Role rules from `GET /workflow/phase-routing`. */
interface PhaseRoutingResponse {
  roles: Array<{ role: WorkflowRole } & RoleRoutingRule>;
}

export default function WorkflowRolesConfig() {
  const t = useTranslations('workflow');
  const ROLE_CONFIG = useMemo(() => getRoleConfig(t), [t]);
  const MODE_META = useMemo(() => getModeMeta(t), [t]);
  const { roles, isLoading, error, updateRole } = useWorkflowRoles();
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [savingRole, setSavingRole] = useState<WorkflowRole | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<WorkflowRole | null>(null);
  const [expandedRole, setExpandedRole] = useState<WorkflowRole | null>(null);

  const [modes, setModes] = useState<ModeSettings[]>([]);
  const [activeTab, setActiveTab] = useState<ModeKey>('standard');

  const [routing, setRouting] = useState<Partial<Record<WorkflowRole, RoleRoutingRule>>>({});
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/phase-routing`);
        if (!res.ok) return;
        const data = (await res.json()) as PhaseRoutingResponse;
        setRouting(Object.fromEntries(data.roles.map(({ role, ...rule }) => [role, rule])));
      } catch (err) {
        logger.error('Failed to fetch phase routing:', err);
      }
    })();
  }, []);

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

  const activeMode = modes.find((m) => m.mode === activeTab);

  const handlePromptChange = async (role: WorkflowRole, systemPromptKey: string | null) => {
    setSavingRole(role);
    const result = await updateRole(role, { systemPromptKey });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handleToggleEnabled = async (role: WorkflowRole, isEnabled: boolean) => {
    setSavingRole(role);
    await updateRole(role, { isEnabled });
    setSavingRole(null);
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

  // NOTE: The complexity bands are fixed in the backend (workflow-mode-config.ts)
  // and are shown, not edited: hand-set ranges drifted until a band matched
  // no score (2026-11-20).

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
            </div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>{t('rolesConfig.complexityRangeLabel')}</span>
              {readonlyBox(activeMode.complexityMin)}
              <span>〜</span>
              {readonlyBox(activeMode.complexityMax)}
              <span className="text-zinc-500 dark:text-zinc-500">
                {t('rolesConfig.complexityRangeFixed')}
              </span>
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
                systemPrompts={systemPrompts}
                routing={routing[roleKey]}
                isSaving={savingRole === roleKey}
                isSaved={saveSuccess === roleKey}
                isExpanded={expandedRole === roleKey}
                isLast={index === tabRoles.length - 1}
                // Approval gate (reviews plan.md) sits right before 実装 — only
                // when this tier has a plan.
                approvalAfter={activeMode.includePlan && tabRoles[index + 1] === 'implementer'}
                onToggleExpand={() => setExpandedRole(expandedRole === roleKey ? null : roleKey)}
                onPromptChange={(k) => handlePromptChange(roleKey, k)}
                onToggleEnabled={(e) => handleToggleEnabled(roleKey, e)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
