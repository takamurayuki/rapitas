'use client';
/**
 * UsageBudgetClient
 *
 * Composes the usage-budget page: progress/forecast, daily × theme usage,
 * budget settings, theme shares and classification rules. Data and saving
 * live in useUsageBudget; this component only wires them together.
 */
import { useTranslations } from 'next-intl';
import { AlertCircle, PiggyBank } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useUsageBudget, type ThemeShare, type UsageBudgetUnit } from '../_hooks/useUsageBudget';
import { BudgetProjectionCard } from './BudgetProjectionCard';
import { ThemeDailyUsageTable } from './ThemeDailyUsageTable';
import { BudgetSettingsForm } from './BudgetSettingsForm';
import { ThemeShareEditor } from './ThemeShareEditor';
import { ClassificationRulesEditor } from './ClassificationRulesEditor';

/** Usage-budget page body. */
export function UsageBudgetClient() {
  const t = useTranslations('usageBudget');
  const { days, setDays, usage, status, rules, themes, loading, error, saveBudget, saveRules } =
    useUsageBudget();

  if (loading) return <LoadingSpinner />;

  const configured = status?.configured ? status : null;
  const saveSettings = (unit: UsageBudgetUnit, monthlyLimit: number) =>
    saveBudget({ unit, monthlyLimit, shares: configured?.shares ?? [] });
  const saveShares = (shares: ThemeShare[]) =>
    configured
      ? saveBudget({ unit: configured.unit, monthlyLimit: configured.monthlyLimit, shares })
      : Promise.resolve(false);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            <PiggyBank className="h-7 w-7 text-amber-500 dark:text-amber-400" />
            {t('title')}
          </h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">{t('description')}</p>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-600 dark:text-red-400">{t('loadFailed')}</p>
          </div>
        )}

        {status && <BudgetProjectionCard status={status} />}
        {usage && <ThemeDailyUsageTable usage={usage} days={days} onDaysChange={setDays} />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BudgetSettingsForm
            unit={configured?.unit ?? null}
            monthlyLimit={configured?.monthlyLimit ?? null}
            onSave={saveSettings}
          />
          <ThemeShareEditor
            unit={configured?.unit ?? null}
            shares={configured?.shares ?? []}
            usage={configured?.themes ?? []}
            suggestions={status?.suggestedShares ?? []}
            themes={themes}
            onSave={saveShares}
          />
        </div>

        <ClassificationRulesEditor rules={rules} themes={themes} onSave={saveRules} />
      </div>
    </div>
  );
}
