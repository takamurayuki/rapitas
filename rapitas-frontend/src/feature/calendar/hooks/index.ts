/**
 * feature/calendar/hooks
 *
 * Calendar hooks used by more than one route: the share lists are read by the
 * calendar's person picker and written by the settings card, so they cannot
 * live in either page's private `_hooks` folder.
 */
export {
  useCalendarShares,
  type SharePerson,
  type GrantFailure,
  type CalendarSharesState,
} from './useCalendarShares';
