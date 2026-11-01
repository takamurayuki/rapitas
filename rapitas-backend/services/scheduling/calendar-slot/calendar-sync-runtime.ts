/**
 * calendar-sync-runtime
 *
 * Per-workspace instances for the calendar slot feature (task 1174): the
 * keychain token store and the Google-backed sync service, plus the
 * idempotent poller start. googleapis is imported lazily so importing this
 * module stays cheap. Not responsible for any decision logic.
 */
import { createLogger } from '../../../config/logger';
import { CalendarSyncService } from './calendar-sync-service';
import { getCalendarSlotSettings } from './calendar-hold-state';
import { KeychainCalendarTokenStore, type CalendarTokenStore } from './token-store';

const log = createLogger('calendar-sync-runtime');

/**
 * One store and one service per workspace.
 *
 * They were single process-wide singletons until 2026-10-29, which is what
 * made the calendar connection install-wide: whichever account connected
 * first supplied the busy blocks for everyone. Keyed on the workspace id
 * (`null` = no workspace known) so one account's credential can never answer
 * for another's.
 */
const tokenStores = new Map<number | null, CalendarTokenStore>();
const services = new Map<number | null, CalendarSyncService>();

/**
 * One workspace's calendar token store.
 *
 * @param workspaceId - Whose calendar / どのワークスペースのカレンダーか
 * @returns The token store / トークンストア
 */
export function getCalendarTokenStore(workspaceId: number | null): CalendarTokenStore {
  const existing = tokenStores.get(workspaceId);
  if (existing) return existing;
  const store = new KeychainCalendarTokenStore(workspaceId);
  tokenStores.set(workspaceId, store);
  return store;
}

/**
 * One workspace's sync service, built on first use.
 *
 * @param workspaceId - Whose calendar / どのワークスペースのカレンダーか
 * @returns Sync service / 同期サービス
 */
export async function getCalendarSyncService(
  workspaceId: number | null,
): Promise<CalendarSyncService> {
  const existing = services.get(workspaceId);
  if (existing) return existing;
  const { createGoogleBusyFetcher } = await import('./freebusy-client');
  const { runInWorkspace } = await import('../../tenancy/workspace-context');
  const service = new CalendarSyncService({
    fetchBusy: createGoogleBusyFetcher(getCalendarTokenStore(workspaceId)),
    // A timer tick carries no request, so without this the store writes would
    // land unscoped and one account's busy blocks would become everyone's.
    runScoped: workspaceId === null ? undefined : (fn) => runInWorkspace(workspaceId, fn),
  });
  services.set(workspaceId, service);
  return service;
}

/** Drop the cached stores and services. Test-only — never call from production code. */
export function resetCalendarRuntime(): void {
  tokenStores.clear();
  services.clear();
}

/**
 * Start polling for one workspace when RAPITAS_CALENDAR_GATE_ENABLED=true.
 *
 * Safe to call repeatedly. A workspace with no stored credential is skipped:
 * polling it would spend a FreeBusy call per tick to be told it is not
 * connected.
 *
 * @param workspaceId - Whose calendar to poll / ポーリング対象のワークスペース
 * @returns Whether polling is (now) active for it / そのワークスペースでポーリングが有効か
 */
export async function ensureCalendarPollingStarted(workspaceId: number | null): Promise<boolean> {
  const settings = getCalendarSlotSettings();
  if (!settings.enabled) return false;
  if (getCalendarTokenStore(workspaceId).get() === null) return false;
  try {
    (await getCalendarSyncService(workspaceId)).start(settings.pollMinutes);
    return true;
  } catch (err) {
    log.warn({ err }, '[calendar-sync] failed to start polling — calendar gate fails open');
    return false;
  }
}

/**
 * Start polling for every workspace that has a calendar connected.
 *
 * Called once at startup. Polling used to be a single process-wide timer, so
 * after a restart there was nothing to resume per account; this walks the
 * workspaces instead of waiting for someone to hit an endpoint.
 *
 * Never throws: the calendar gate fails open, and a failure to list
 * workspaces must not take the server down with it.
 *
 * @returns Workspace ids now polling / ポーリングを開始したワークスペースID
 */
export async function startCalendarPollingForConnectedWorkspaces(): Promise<number[]> {
  if (!getCalendarSlotSettings().enabled) return [];
  const started: number[] = [];
  try {
    const { prisma } = await import('../../../config/database');
    const { runAcrossAllWorkspaces } = await import('../../tenancy/workspace-context');
    // Listing the workspaces is itself cross-tenant work, so it says so.
    const workspaces = await runAcrossAllWorkspaces(() =>
      prisma.workspace.findMany({ select: { id: true } }),
    );
    for (const workspace of workspaces) {
      if (await ensureCalendarPollingStarted(workspace.id)) started.push(workspace.id);
    }
  } catch (err) {
    log.warn({ err }, '[calendar-sync] could not start per-workspace polling');
  }
  return started;
}
