'use client';

/**
 * UsageBudgetPromptDialog
 *
 * Confirmation dialog shown when AI usage reaches 80% / 90% / exceeds the
 * monthly budget: shows the 7-day forecast and offers 続行 / 後回し / 上限変更.
 * Purely advisory — executions keep running whatever the user picks.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PiggyBank } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';

/** Budget unit (mirrors the backend UsageBudgetUnit). */
export type UsageBudgetUnit = 'tokens' | 'executions';

/** Threshold prompt payload returned by POST /agent-metrics/usage-budget/evaluate. */
export interface PendingPrompt {
  key: string;
  level: 'warn80' | 'warn90' | 'exceeded';
  unit: UsageBudgetUnit;
  used: number;
  limit: number;
  remaining: number;
  avg7: number;
  daysToExhaust: number | null;
  projectedMonthEnd: number | null;
}

/** Body of POST /agent-metrics/usage-budget/prompt-response. */
export type PromptResponseBody =
  | { action: 'continue' }
  | { action: 'defer' }
  | { action: 'change_limit'; monthlyLimit: number };

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Format an amount in the budget unit (e.g. "1,200 トークン" / "5 回").
 *
 * @param t - usageBudget translator / 翻訳関数
 * @param value - Amount / 値
 * @param unit - Budget unit / 予算単位
 * @returns Localized label / 表示文字列
 */
export function formatBudgetAmount(t: Translate, value: number, unit: UsageBudgetUnit): string {
  const v = Math.round(value).toLocaleString();
  return unit === 'tokens' ? t('tokensValue', { value: v }) : t('executionsValue', { value: v });
}

function isPositiveInteger(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0;
}

interface Props {
  prompt: PendingPrompt | null;
  /** Calls the prompt-response API; rejects on failure. */
  respond: (body: PromptResponseBody) => Promise<void>;
  /** Esc / backdrop: close without saving (the next poll shows it again). */
  onClose: () => void;
  /** A choice was saved successfully. */
  onResolved: () => void;
}

/**
 * Render the threshold confirmation dialog.
 *
 * @param prompt - Pending threshold prompt, or null to hide / 表示する確認内容
 * @param respond - Prompt-response API call / 応答API呼び出し
 * @param onClose - Close without saving / 保存せず閉じる
 * @param onResolved - Called after a choice was saved / 保存成功時
 */
export function UsageBudgetPromptDialog({ prompt, respond, onClose, onResolved }: Props) {
  const t = useTranslations('usageBudget');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState('');

  if (!prompt) return null;

  const submit = async (body: PromptResponseBody) => {
    setBusy(true);
    setError(false);
    try {
      await respond(body);
      setEditingLimit(false);
      setLimitInput('');
      onResolved();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const amount = (v: number) => formatBudgetAmount(t, v, prompt.unit);
  const buttonBase =
    'px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <Modal
      open
      onClose={onClose}
      title={t(`promptTitle_${prompt.level}`)}
      icon={<PiggyBank className="w-5 h-5 text-amber-500 dark:text-amber-400" />}
    >
      <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          {t('promptUsage', {
            used: amount(prompt.used),
            limit: amount(prompt.limit),
            remaining: amount(prompt.remaining),
          })}
        </p>
        <p>
          {prompt.daysToExhaust === null
            ? t('noForecast')
            : t('promptForecast', {
                avg: amount(prompt.avg7),
                days: String(Math.floor(prompt.daysToExhaust * 10) / 10),
              })}
        </p>
        <p className="text-zinc-500 dark:text-zinc-400">{t('promptNotRunning')}</p>

        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {t('actionFailed')}
          </p>
        )}

        {editingLimit ? (
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="block mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t('newLimit')}
              </span>
              <input
                type="number"
                aria-label={t('newLimit')}
                min={1}
                step={1}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
            <button
              type="button"
              disabled={busy || !isPositiveInteger(limitInput)}
              onClick={() => submit({ action: 'change_limit', monthlyLimit: Number(limitInput) })}
              className={`${buttonBase} bg-indigo-600 text-white hover:bg-indigo-700`}
            >
              {t('applyLimit')}
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditingLimit((v) => !v)}
            className={`${buttonBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800`}
          >
            {t('changeLimit')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ action: 'defer' })}
            className={`${buttonBase} border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800`}
          >
            {t('defer')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ action: 'continue' })}
            className={`${buttonBase} bg-indigo-600 text-white hover:bg-indigo-700`}
          >
            {t('continue')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
