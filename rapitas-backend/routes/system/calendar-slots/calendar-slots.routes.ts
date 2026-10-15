/**
 * calendar-slots routes
 *
 * HTTP API for the calendar-aware auto-run scheduler (task 1174): the
 * calendar-only OAuth flow (calendar.freebusy scope, separate from login),
 * next run schedule, execution log, sync state, manual re-sync and the
 * one-shot "今すぐ実行" override. Thin layer — logic lives in
 * calendar-slots-handlers.ts and services/scheduling/calendar-slot.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  buildCalendarAuthUrl,
  createCalendarOAuthClient,
} from '../../../services/scheduling/calendar-slot/freebusy-client';
import {
  ensureCalendarPollingStarted,
  getCalendarSyncService,
  getCalendarTokenStore,
} from '../../../services/scheduling/calendar-slot/calendar-sync-runtime';
import { requestCalendarGateOverride } from '../../../services/scheduling/calendar-slot/calendar-hold-state';
import {
  buildNextRuns,
  buildSyncState,
  completeCalendarOAuth,
  createOAuthState,
  listSlotLogs,
  type ActivityLogReader,
} from './calendar-slots-handlers';

const log = createLogger('routes:calendar-slots');

// Polling must run whenever the gate is enabled; this module is loaded once
// at server start via the system route barrel. No-op when the env flag is off.
void ensureCalendarPollingStarted();

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const calendarSlotsRoutes = new Elysia({ prefix: '/calendar-slots' })
  .get('/oauth/url', () => ({
    url: buildCalendarAuthUrl(createCalendarOAuthClient(), createOAuthState()),
  }))

  .get(
    '/oauth/callback',
    async ({ query, set }) => {
      let result = 'error';
      try {
        const client = createCalendarOAuthClient();
        result = await completeCalendarOAuth(
          { code: query.code, state: query.state },
          {
            exchange: async (code) => (await client.getToken(code)).tokens,
            tokenStore: getCalendarTokenStore(),
            triggerSync: async () => {
              await ensureCalendarPollingStarted();
              await (await getCalendarSyncService()).syncOnce();
            },
          },
        );
      } catch (err) {
        log.warn({ err }, '[calendar-slots] OAuth callback failed');
      }
      set.status = 302;
      set.headers.location = `${frontendUrl()}/agents/calendar-slots?calendar=${result}`;
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
        error: t.Optional(t.String()),
      }),
    },
  )

  .get('/next-runs', () => buildNextRuns(new Date()))

  .get('/sync-state', () => buildSyncState(new Date(), getCalendarTokenStore().get() !== null))

  .get(
    '/logs',
    ({ query }) =>
      listSlotLogs(
        prisma.activityLog as unknown as ActivityLogReader,
        Number(query.page ?? 1),
        Number(query.limit ?? 20),
      ),
    { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
  )

  .post('/sync', async () => (await getCalendarSyncService()).syncOnce())

  .post(
    '/override/:themeId',
    ({ params, set }) => {
      const themeId = Number(params.themeId);
      if (!Number.isInteger(themeId) || themeId <= 0) {
        set.status = 400;
        return { error: 'invalid themeId' };
      }
      requestCalendarGateOverride(themeId);
      set.status = 204;
    },
    { params: t.Object({ themeId: t.String() }) },
  );

export default calendarSlotsRoutes;
