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
  getCalendarSyncService,
  getCalendarTokenStore,
  startCalendarPollingForConnectedWorkspaces,
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

import { frontendUrl } from '../../../config/frontend-url';
import { currentWorkspaceId } from '../../../services/tenancy/workspace-context';
import { ensureCalendarPollingStarted } from '../../../services/scheduling/calendar-slot/calendar-sync-runtime';

const log = createLogger('routes:calendar-slots');

// Polling must run whenever the gate is enabled; this module is loaded once
// at server start via the system route barrel. No-op when the env flag is off.
// Per workspace since 2026-10-29: the connection is personal, so there is no
// single timer to start — each connected account gets its own.
void startCalendarPollingForConnectedWorkspaces();

const calendarSlotsRoutes = new Elysia({ prefix: '/calendar-slots' })
  // The workspace is bound to the state HERE, where the session cookie still
  // arrives. It cannot be read in the callback: that is a top-level redirect
  // from accounts.google.com and the session cookie is SameSite=Strict.
  .get('/oauth/url', () => ({
    url: buildCalendarAuthUrl(createCalendarOAuthClient(), createOAuthState(currentWorkspaceId())),
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
            tokenStoreFor: getCalendarTokenStore,
            triggerSync: async (workspaceId) => {
              await ensureCalendarPollingStarted(workspaceId);
              await (await getCalendarSyncService(workspaceId)).syncOnce();
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

  .get('/sync-state', () =>
    buildSyncState(new Date(), getCalendarTokenStore(currentWorkspaceId()).get() !== null),
  )

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

  .post('/sync', async () => (await getCalendarSyncService(currentWorkspaceId())).syncOnce())

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
