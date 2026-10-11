/**
 * calendar-sync-runtime
 *
 * Process singletons for the calendar slot feature (task 1174): the keychain
 * token store and the Prisma/Google-backed sync service, plus the idempotent
 * poller start. DB and googleapis are imported lazily so merely importing the
 * gate or the hold state never opens a Prisma client. Not responsible for
 * any decision logic.
 */
import { createLogger } from '../../../config/logger';
import { CalendarSyncService } from './calendar-sync-service';
import { getCalendarSlotSettings } from './calendar-hold-state';
import { KeychainCalendarTokenStore, type CalendarTokenStore } from './token-store';

const log = createLogger('calendar-sync-runtime');

let tokenStore: CalendarTokenStore | null = null;
let service: CalendarSyncService | null = null;

/** @returns The process-wide calendar token store. / トークンストア */
export function getCalendarTokenStore(): CalendarTokenStore {
  if (!tokenStore) tokenStore = new KeychainCalendarTokenStore();
  return tokenStore;
}

/**
 * The process-wide sync service, built on first use.
 *
 * @returns Sync service / 同期サービス
 */
export async function getCalendarSyncService(): Promise<CalendarSyncService> {
  if (service) return service;
  const [{ prisma }, { createGoogleBusyFetcher }, { createPrismaCalendarSlotStore }] =
    await Promise.all([
      import('../../../config/database'),
      import('./freebusy-client'),
      import('./calendar-sync-service'),
    ]);
  service = new CalendarSyncService({
    store: createPrismaCalendarSlotStore(prisma),
    fetchBusy: createGoogleBusyFetcher(getCalendarTokenStore()),
  });
  return service;
}

/**
 * Start polling when RAPITAS_CALENDAR_GATE_ENABLED=true. Safe to call repeatedly.
 *
 * @returns Whether polling is (now) active / ポーリングが有効か
 */
export async function ensureCalendarPollingStarted(): Promise<boolean> {
  const settings = getCalendarSlotSettings();
  if (!settings.enabled) return false;
  try {
    (await getCalendarSyncService()).start(settings.pollMinutes);
    return true;
  } catch (err) {
    log.warn({ err }, '[calendar-sync] failed to start polling — calendar gate fails open');
    return false;
  }
}
