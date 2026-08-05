'use client';

/**
 * ReminderPicker
 *
 * Shared reminder selection row for memo forms: preset chips (30分後 etc.)
 * plus a custom picker that opens with today's date already filled — the
 * user normally only types the time. Controlled: the caller owns the
 * ReminderValue and resolves it on save via resolveReminder().
 */
import { useTranslations } from 'next-intl';
import { AlarmClock } from 'lucide-react';
import {
  localDateKey,
  REMINDER_PRESET_ORDER,
  resolveReminder,
  type ReminderValue,
} from '@/utils/reminder-presets';

interface ReminderPickerProps {
  value: ReminderValue;
  onChange: (value: ReminderValue) => void;
}

/**
 * Render the reminder row (presets + custom day/time chips).
 *
 * @param props - Controlled value and change handler. / 選択状態と変更ハンドラ。
 */
export function ReminderPicker({ value, onChange }: ReminderPickerProps) {
  const t = useTranslations('quickCapture.memo');

  const chipCls = (selected: boolean) =>
    `whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;
  const inputCls =
    'rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

  // Past or incomplete custom input — tint the time field as an error.
  const isInvalid = value.preset === 'custom' && resolveReminder(value) === 'invalid';

  const pickPreset = (preset: ReminderValue['preset']) => {
    // Entering custom mode pre-fills today's date and the next full hour so
    // the user normally only adjusts the time before saving.
    if (preset === 'custom' && (!value.time || !value.date)) {
      const next = new Date(Date.now() + 60 * 60_000);
      const hh = String(next.getHours()).padStart(2, '0');
      onChange({
        ...value,
        preset,
        date: value.date || localDateKey(),
        time: value.time || `${hh}:00`,
      });
    } else {
      onChange({ ...value, preset });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AlarmClock
        className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
        aria-label={t('reminderAria')}
      />
      {REMINDER_PRESET_ORDER.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => pickPreset(p)}
          className={chipCls(value.preset === p)}
        >
          {t(`presets.${p}`)}
        </button>
      ))}
      {value.preset === 'custom' && (
        <span className="flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800/80">
          <input
            type="date"
            value={value.date}
            min={localDateKey()}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            aria-label={t('custom.dateAria')}
            className={inputCls}
          />
          <input
            type="time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            aria-label={t('custom.timeAria')}
            className={`${inputCls} ${isInvalid ? 'border-red-400 dark:border-red-600' : ''}`}
          />
        </span>
      )}
    </div>
  );
}
