/**
 * schedule-constants
 *
 * Static configuration constants for the schedule event dialog.
 * Responsible for defining reminder options, color palette, and quick-time presets.
 * Not responsible for UI rendering or date calculations.
 */

/** Available reminder offsets (in minutes before the event). */
export const REMINDER_OPTIONS = [
  { value: null, label: 'なし' },
  { value: 5, label: '5分前' },
  { value: 10, label: '10分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '1日前' },
] as const;

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
  { start: '09:00', end: '10:00', label: '午前' },
  { start: '12:00', end: '13:00', label: '昼' },
  { start: '15:00', end: '16:00', label: '午後' },
  { start: '19:00', end: '20:00', label: '夜' },
] as const;

/** Default accent color for new events. */
export const DEFAULT_EVENT_COLOR = '#6366F1';

/** Default reminder offset in minutes. */
export const DEFAULT_REMINDER_MINUTES = 15;
