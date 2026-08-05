/**
 * reminder-presets
 *
 * Shared quick-pick reminder presets for memo capture (quick-capture popup and
 * the /memos page add form). Resolves a preset key to a concrete timestamp.
 */

export type ReminderPreset = 'none' | '30m' | '1h' | '3h' | 'tomorrow' | 'custom';

/** Display / iteration order of the presets. */
export const REMINDER_PRESET_ORDER: ReminderPreset[] = [
  'none',
  '30m',
  '1h',
  '3h',
  'tomorrow',
  'custom',
];

/** Day choice inside the custom (日時指定) picker. */
export type ReminderDay = 'today' | 'tomorrow' | 'date';

/** Full reminder selection state (presets + the custom day/time picker). */
export interface ReminderValue {
  preset: ReminderPreset;
  /** Custom picker: which day. */
  day: ReminderDay;
  /** Custom picker: yyyy-mm-dd, used when day === 'date'. */
  date: string;
  /** Custom picker: HH:MM. */
  time: string;
}

/** Fresh default selection (no reminder). */
export const emptyReminder = (): ReminderValue => ({
  preset: 'none',
  day: 'today',
  date: '',
  time: '',
});

/**
 * Resolve the selection to a concrete timestamp.
 *
 * @param value - Current picker state / ピッカーの選択状態
 * @returns Timestamp, null for no reminder, or 'invalid' when the custom
 *   fields are incomplete or in the past / 日時・なし(null)・不正('invalid')
 */
export const resolveReminder = (value: ReminderValue): Date | null | 'invalid' => {
  switch (value.preset) {
    case '30m':
      return new Date(Date.now() + 30 * 60_000);
    case '1h':
      return new Date(Date.now() + 60 * 60_000);
    case '3h':
      return new Date(Date.now() + 3 * 60 * 60_000);
    case 'tomorrow': {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case 'custom': {
      if (!value.time) return 'invalid';
      const [h, m] = value.time.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return 'invalid';
      const d = new Date();
      if (value.day === 'tomorrow') d.setDate(d.getDate() + 1);
      else if (value.day === 'date') {
        if (!value.date) return 'invalid';
        const [y, mo, da] = value.date.split('-').map(Number);
        if (!y || !mo || !da) return 'invalid';
        d.setFullYear(y, mo - 1, da);
      }
      d.setHours(h!, m!, 0, 0);
      // A reminder in the past would fire instantly — treat as input error.
      if (d.getTime() <= Date.now()) return 'invalid';
      return d;
    }
    default:
      return null;
  }
};
