/**
 * SetupStep
 *
 * One row of the dev-project setup pipeline (directory → repository →
 * branch): a state icon rail, a compact label + status chip header, and the
 * step's controls below. Communicates state visually instead of prose.
 */
import type { ReactNode } from 'react';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type StepState = 'done' | 'pending' | 'checking' | 'attention';

type Props = {
  state: StepState;
  label: string;
  labelIcon: ReactNode;
  badge?: ReactNode;
  isLast?: boolean;
  children: ReactNode;
};

/**
 * Renders a single setup step with its state icon, status chip, and controls.
 *
 * @param props.state - Visual state of the step / ステップの状態
 * @param props.label - Short step title / ステップ名
 * @param props.labelIcon - Small icon next to the label / ラベル横のアイコン
 * @param props.badge - Optional extra badge (e.g. Git detected) / 追加バッジ
 * @param props.isLast - Suppresses the connector line below / 最終ステップフラグ
 */
export function SetupStep({ state, label, labelIcon, badge, isLast = false, children }: Props) {
  const t = useTranslations('themes');

  const chip = {
    done: {
      text: t('stepStatusDone'),
      cls: 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30',
    },
    pending: {
      text: t('stepStatusPending'),
      cls: 'text-zinc-600 dark:text-zinc-400 bg-zinc-200/70 dark:bg-zinc-800',
    },
    checking: {
      text: t('stepStatusChecking'),
      cls: 'text-zinc-600 dark:text-zinc-400 bg-zinc-200/70 dark:bg-zinc-800',
    },
    attention: {
      text: t('stepStatusAttention'),
      cls: 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30',
    },
  }[state];

  return (
    <div className="flex gap-3">
      {/* State icon rail with connector line */}
      <div className="flex flex-col items-center">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {state === 'done' ? (
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : state === 'checking' ? (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          ) : state === 'attention' ? (
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          )}
        </span>
        {!isLast && <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />}
      </div>

      <div className={`flex-1 min-w-0 ${isLast ? '' : 'pb-4'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            {labelIcon}
            {label}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${chip.cls}`}>
            {chip.text}
          </span>
          {badge}
        </div>
        {children}
      </div>
    </div>
  );
}
