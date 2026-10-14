/**
 * calendar-slot
 *
 * Barrel for the calendar-aware auto-run slot feature (task 1174).
 */
export * from './free-slot';
export * from './calendar-hold-state';
export * from './calendar-hold-decision';
export * from './calendar-store';
export * from './calendar-sync-service';
export * from './token-store';
export {
  FREEBUSY_SCOPE,
  buildFreeBusyRequest,
  buildCalendarAuthUrl,
  fetchBusyBlocks,
  createCalendarOAuthClient,
  createGoogleBusyFetcher,
  CalendarNotConnectedError,
} from './freebusy-client';
export type { FreeBusyApi, FreeBusyRequest } from './freebusy-client';
export {
  getCalendarTokenStore,
  getCalendarSyncService,
  ensureCalendarPollingStarted,
} from './calendar-sync-runtime';
