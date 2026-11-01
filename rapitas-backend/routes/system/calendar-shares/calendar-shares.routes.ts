/**
 * Calendar share routes
 *
 * Letting one account view another's month calendar, and nothing else.
 *
 * Thin layer: the deciding lives in `services/tenancy/calendar-share` and the
 * orchestration in calendar-shares-handlers. What is here is the translation
 * from a refusal to a status, which matters because a `not_shared` served as
 * an empty 200 is indistinguishable from a month with no events — the shape
 * a broken permission check hides in.
 *
 * Read-only by construction: no route here writes a schedule event, and the
 * only table it writes is the grant table itself.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { runInWorkspace } from '../../../services/tenancy/workspace-context';
import {
  describePeople,
  defaultPeopleDb,
  resolvePersonWorkspace,
} from '../../../services/tenancy/calendar-share/calendar-share-people';
import type { CalendarShareDelegate } from '../../../services/tenancy/calendar-share/calendar-share-store';
import { currentWorkspaceId as currentWorkspaceIdFn } from '../../../services/tenancy/workspace-context';
import { listScheduleEvents } from '../../../services/scheduling/schedule-listing';
import {
  addCalendarShare,
  listCalendarShares,
  readSharedSchedules,
  removeCalendarShare,
  type CalendarShareDeps,
  type ShareRefusal,
} from './calendar-shares-handlers';
import { isValidEntityId } from '../../../utils/common/id-validation';

/** How each refusal reaches the browser. */
const REFUSAL_STATUS: Record<ShareRefusal, number> = {
  no_session: 401,
  not_shared: 403,
  invalid_owner: 400,
  unknown_person: 404,
  self: 400,
};

/** Default window when the caller names none: the month either side of today. */
const DEFAULT_WINDOW_DAYS = 31;

/**
 * The live collaborators.
 *
 * NOTE: one cast, for the grant delegate. The generated client does not carry
 * `calendarShare` until it is regenerated on the next backend restart — dev.js
 * owns that — and the narrow `CalendarShareDelegate` is what the store was
 * written against so the cast stays here rather than spreading.
 */
function liveDeps(): CalendarShareDeps {
  return {
    shares: (prisma as unknown as { calendarShare: CalendarShareDelegate }).calendarShare,
    resolvePerson: (identifier) => resolvePersonWorkspace(defaultPeopleDb(), identifier),
    describePeople: (workspaceIds) => describePeople(defaultPeopleDb(), workspaceIds),
    runInWorkspace,
    // Schedule events only, through the same listing the owner's own calendar
    // uses — so a shared month shows the occurrences of repeating events
    // rather than silently dropping them. Tasks are not read here at all.
    listSchedules: async (range) =>
      (await listScheduleEvents(prisma.scheduleEvent, range)).map((event) => ({
        id: event.id,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        isAllDay: event.isAllDay,
        color: event.color,
        type: event.type,
      })),
  };
}

/** Stand-ins for the database and the session, for the tests. */
export interface CalendarShareRouteDeps {
  deps?: CalendarShareDeps;
  currentWorkspaceId?: () => number | null;
}

/**
 * Build the calendar-share router.
 *
 * @param overrides - Stand-ins for the handlers' deps and the session / 差し替え用の依存
 * @returns The router / ルーター
 */
export function createCalendarShareRoutes(overrides: CalendarShareRouteDeps = {}) {
  const deps = overrides.deps ?? liveDeps();
  const currentWorkspaceId = overrides.currentWorkspaceId ?? currentWorkspaceIdFn;

  return (
    new Elysia({ prefix: '/calendar-shares' })
      // Who I show my calendar to, and whose I may see.
      .get('/', async ({ set }) => {
        const result = await listCalendarShares(deps, currentWorkspaceId());
        if (!result.ok) {
          set.status = REFUSAL_STATUS[result.reason];
          return { reason: result.reason };
        }
        return { sharedByMe: result.sharedByMe, sharedWithMe: result.sharedWithMe };
      })

      // Share my calendar with the person named by username or email.
      .post(
        '/',
        async ({ body, set }) => {
          const result = await addCalendarShare(deps, currentWorkspaceId(), body.identifier);
          if (!result.ok) {
            set.status = REFUSAL_STATUS[result.reason];
            return { reason: result.reason };
          }
          return { outcome: result.outcome, person: result.person };
        },
        {
          body: t.Object(
            { identifier: t.String({ minLength: 1, maxLength: 200 }) },
            { additionalProperties: false },
          ),
        },
      )

      // Stop showing my calendar to that workspace. Idempotent: revoking a
      // grant that is already gone is a 200 with removed: 0, because the
      // settings card may be a tab behind and a 404 would make a revoke that
      // already happened look broken.
      .delete('/:viewerWorkspaceId', async ({ params, set }) => {
        if (!isValidEntityId(params.viewerWorkspaceId)) {
          set.status = 400;
          return { reason: 'invalid_viewer' };
        }
        const viewerWorkspaceId = Number(params.viewerWorkspaceId);
        const result = await removeCalendarShare(deps, currentWorkspaceId(), viewerWorkspaceId);
        if (!result.ok) {
          set.status = REFUSAL_STATUS[result.reason];
          return { reason: result.reason };
        }
        return { removed: result.removed };
      })

      // The one read that crosses a workspace boundary.
      .get('/:ownerWorkspaceId/schedules', async ({ params, query, set }) => {
        const { from, to } = query as { from?: string; to?: string };
        const now = Date.now();
        const result = await readSharedSchedules(deps, {
          viewerWorkspaceId: currentWorkspaceId(),
          // Not validated here: decideCalendarShareAccess already refuses
          // anything that is not a positive integer, and it refuses a missing
          // session FIRST — so a sessionless caller learns nothing from the
          // shape of the id they guessed.
          ownerWorkspaceId: Number(params.ownerWorkspaceId),
          from: from ? new Date(from) : new Date(now - DEFAULT_WINDOW_DAYS * 86400000),
          to: to ? new Date(to) : new Date(now + DEFAULT_WINDOW_DAYS * 86400000),
        });
        if (!result.ok) {
          set.status = REFUSAL_STATUS[result.reason];
          return { reason: result.reason };
        }
        return { events: result.events };
      })
  );
}

export const calendarSharesRoutes = createCalendarShareRoutes();

export default calendarSharesRoutes;
