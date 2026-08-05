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

/**
 * Resolve a preset to a concrete timestamp.
 *
 * @param preset - Chosen preset key / 選択されたプリセット
 * @param custom - datetime-local value used when preset is 'custom' / カスタム日時
 * @returns Reminder timestamp, or null for no reminder / リマインダー日時（なしは null）
 */
export const presetToDate = (preset: ReminderPreset, custom: string): Date | null => {
  switch (preset) {
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
    case 'custom':
      return custom ? new Date(custom) : null;
    default:
      return null;
  }
};
