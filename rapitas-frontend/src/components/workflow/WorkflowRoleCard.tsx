'use client';

/**
 * WorkflowRoleCard
 *
 * Expandable card for one workflow role: whether it runs, its system prompt,
 * and how its agent and model are chosen. The agent and model are not
 * configurable — they are built automatically from the providers this host
 * can run and the model tier table; the card only states the rule.
 */
import { ChevronDown, Loader2, Save, ArrowDown, ShieldCheck, Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WorkflowRole, WorkflowRoleConfig } from '@/types';
import { Toggle } from '@/components/ui/Toggle';
import type { SystemPrompt, RoleConfigItem } from './workflow-role-constants';

/** How the role's provider is chosen, from `GET /workflow/phase-routing`. */
export interface RoleRoutingRule {
  rule: 'follow_upstream' | 'different_from_upstream';
  crossProviderActive: boolean;
}

interface WorkflowRoleCardProps {
  roleKey: WorkflowRole;
  index: number;
  config: RoleConfigItem;
  roleData: WorkflowRoleConfig | undefined;
  systemPrompts: SystemPrompt[];
  /** The role's routing rule; undefined while it loads. */
  routing?: RoleRoutingRule;
  isSaving: boolean;
  isSaved: boolean;
  isExpanded: boolean;
  /** Last card in the current tier — suppresses the trailing baton arrow. */
  isLast?: boolean;
  /** Show the user-approval gate in the arrow AFTER this card (before 実装). */
  approvalAfter?: boolean;
  onToggleExpand: () => void;
  onPromptChange: (key: string | null) => void;
  onToggleEnabled: (enabled: boolean) => void;
}

/**
 * Single workflow role card with expandable configuration panel.
 */
export function WorkflowRoleCard({
  roleKey,
  index,
  config,
  roleData,
  systemPrompts,
  routing,
  isSaving,
  isSaved,
  isExpanded,
  isLast = false,
  approvalAfter = false,
  onToggleExpand,
  onPromptChange,
  onToggleEnabled,
}: WorkflowRoleCardProps) {
  const t = useTranslations('workflow');
  const Icon = config.icon;
  const isEnabled = roleData?.isEnabled !== false;
  const ruleText = !routing
    ? t('rolesConfig.autoRuleLoading')
    : routing.rule === 'follow_upstream'
      ? t('rolesConfig.autoRuleFollowUpstream')
      : routing.crossProviderActive
        ? t('rolesConfig.autoRuleDifferentProvider')
        : t('rolesConfig.autoRuleDifferentProviderUnavailable');

  return (
    <div key={roleKey}>
      {/* Role card */}
      <div
        className={`border ${config.borderColor} rounded-xl overflow-hidden transition-all ${
          !isEnabled ? 'opacity-50' : ''
        }`}
      >
        {/* Header (always visible) */}
        <div
          className={`${config.bgColor} px-4 py-3 cursor-pointer select-none`}
          onClick={onToggleExpand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleExpand();
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Step number */}
              <div
                className={`w-7 h-7 rounded-full ${config.accentColor} flex items-center justify-center text-white text-xs font-bold`}
              >
                {index + 1}
              </div>
              <Icon className={`h-5 w-5 ${config.color}`} />
              <div>
                <span className={`font-semibold ${config.color}`}>{config.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-2 hidden sm:inline">
                  {config.description}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!isExpanded && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs bg-white/60 dark:bg-zinc-700/60 px-2.5 py-1 rounded-lg">
                  <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
                    <Bot className="h-3 w-3" /> {t('rolesConfig.autoSelect')}
                  </span>
                </div>
              )}

              {/* Saving/saved indicator */}
              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
              {isSaved && <Save className="h-4 w-4 text-green-500" />}

              {/* Enable/disable toggle */}
              <Toggle
                checked={isEnabled}
                onChange={(checked) => onToggleEnabled(checked)}
                srLabel={t('rolesConfig.enableRoleLabel', { role: config.label })}
                stopPropagation
              />

              {/* Expand/collapse icon */}
              <ChevronDown
                className={`h-4 w-4 text-zinc-500 transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </div>
          </div>
        </div>

        {/* Settings panel (expanded) */}
        {isExpanded && (
          <div className="bg-white dark:bg-zinc-800 px-4 py-4 border-t border-zinc-100 dark:border-zinc-700/50">
            <div className="mb-4 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                  {t('rolesConfig.autoSelectMode')}
                </span>
              </div>
              <p className="mt-1 text-xs text-indigo-700/80 dark:text-indigo-300/80">{ruleText}</p>
            </div>

            <div className="sm:max-w-xs">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                {t('rolesConfig.systemPromptLabel')}
              </label>
              <div className="relative">
                <select
                  value={roleData?.systemPromptKey ?? ''}
                  onChange={(e) => onPromptChange(e.target.value || null)}
                  disabled={isSaving}
                  className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:border-indigo-400"
                >
                  <option value="">{t('rolesConfig.default')}</option>
                  {systemPrompts.map((sp) => (
                    <option key={sp.key} value={sp.key}>
                      {sp.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {/* Flow info */}
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                {t('rolesConfig.inputLabel')}{' '}
                <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                  {config.inputLabel}
                </code>
              </span>
              <span>
                {t('rolesConfig.outputLabel')}{' '}
                <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                  {config.outputFile}
                </code>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Baton arrow between phases. Suppressed after the last phase of the
          tier (no trailing arrow after 検証). When this card precedes 実装 and
          the tier has a plan, the gap is the user-approval gate (reviews
          plan.md) — otherwise it shows this phase's output artifact. */}
      {!isLast && (
        <div className="flex items-center justify-center py-1.5">
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
            <ArrowDown className="h-4 w-4" />
            {approvalAfter ? (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-indigo-500 dark:text-indigo-400 font-medium">
                  {t('rolesConfig.userApproval')}
                </span>
              </span>
            ) : (
              <span>{config.outputFile}</span>
            )}
            <ArrowDown className="h-4 w-4" />
          </div>
        </div>
      )}
    </div>
  );
}
