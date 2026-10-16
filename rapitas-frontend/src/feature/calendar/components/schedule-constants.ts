/**
 * schedule-constants
 *
 * Static configuration constants for the schedule event dialog.
 * Responsible for defining reminder options, color palette, and quick-time presets.
 * Not responsible for UI rendering or date calculations.
 */

/**
 * Available reminder offsets (in minutes before the event).
 *
 * NOTE: no static `label` field — consuming components derive the display
 * label from `value` via `calendar.reminderMinutesBefore` /
 * `reminderHoursBefore` / `reminderDaysBefore` (see getReminderOptionLabel
 * usages) so the text stays translated.
 */
export const REMINDER_OPTIONS = [
  { value: null },
  { value: 5 },
  { value: 10 },
  { value: 15 },
  { value: 30 },
  { value: 60 },
  { value: 1440 },
] as const;

// NOTE: `label` values below are English color names shown only as a hover
// `title` tooltip on swatch buttons — deliberately left untranslated (i18n
// migration, deferred: not Japanese sentence text, low-value to localize).
/** Available event accent colors. */
export const COLOR_OPTIONS = [
  { value: '#6366F1', label: 'Indigo' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#10B981', label: 'Green' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#EF4444', label: 'Red' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#06B6D4', label: 'Cyan' },
] as const;

/** Quick-select time presets shown as pill buttons in the time picker. */
export const QUICK_TIMES = [
  { start: '09:00', end: '10:00', labelKey: 'quickTimeMorning' as const },
  { start: '12:00', end: '13:00', labelKey: 'quickTimeNoon' as const },
  { start: '15:00', end: '16:00', labelKey: 'quickTimeAfternoon' as const },
  { start: '19:00', end: '20:00', labelKey: 'quickTimeEvening' as const },
] as const;

/** Default accent color for new events. */
export const DEFAULT_EVENT_COLOR = '#6366F1';

/** Default reminder offset in minutes. */
export const DEFAULT_REMINDER_MINUTES = 15;
