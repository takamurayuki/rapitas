/**
 * freebusy-client
 *
 * The only Google Calendar access path of the calendar-aware auto-run gate
 * (task 1174): the dedicated OAuth client (calendar.freebusy scope only) and
 * freebusy.query. Events are never listed, so titles and attendees are never
 * requested, received, or stored (AC1). Not responsible for polling or
 * persistence (calendar-sync-service.ts) or for the login OAuth flow
 * (routes/system/auth/google-oauth.ts, intentionally untouched).
 */
import { google } from 'googleapis';
import type { BusyBlock } from './free-slot';
import type { CalendarTokenStore } from './token-store';

/** The single OAuth scope requested: busy/free times, no event details. */
export const FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

/** Request body of freebusy.query — fixed to these three keys on purpose. */
export interface FreeBusyRequest {
  timeMin: string;
  timeMax: string;
  items: Array<{ id: 'primary' }>;
}

/** The subset of the FreeBusy response this module reads. */
export interface FreeBusyResponseLike {
  calendars?: Record<
    string,
    {
      busy?: Array<{ start?: string | null; end?: string | null }> | null;
      errors?: Array<{ domain?: string | null; reason?: string | null }> | null;
    }
  > | null;
}

/** Minimal freebusy API surface; the googleapis client is adapted to it. */
export interface FreeBusyApi {
  query(params: { requestBody: FreeBusyRequest }): Promise<{ data: FreeBusyResponseLike }>;
}

/** Minimal OAuth client surface used to build the consent URL. */
export interface CalendarAuthUrlClient {
  generateAuthUrl(opts: {
    access_type: string;
    scope: string[];
    prompt: string;
    state: string;
  }): string;
}

/** Raised when no refresh token has been stored yet. */
export class CalendarNotConnectedError extends Error {
  constructor() {
    super('Google Calendar is not connected');
    this.name = 'CalendarNotConnectedError';
  }
}

/**
 * Build the freebusy.query body. Only the time range and the primary
 * calendar id are sent — no `fields`, no event-level keys.
 *
 * @param timeMin - Range start / 取得範囲の開始
 * @param timeMax - Range end / 取得範囲の終了
 * @returns The fixed request body / 固定項目のリクエストボディ
 */
export function buildFreeBusyRequest(timeMin: Date, timeMax: Date): FreeBusyRequest {
  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    items: [{ id: 'primary' }],
  };
}

/**
 * Query FreeBusy for the primary calendar and map the busy intervals.
 *
 * @param api - FreeBusy API (googleapis adapter or a test double) / FreeBusy API
 * @param timeMin - Range start / 取得範囲の開始
 * @param timeMax - Range end / 取得範囲の終了
 * @returns Busy blocks with start/end only / 開始・終了のみの予定区間
 * @throws {Error} When Google reports a per-calendar error / カレンダー単位のエラー時
 */
export async function fetchBusyBlocks(
  api: FreeBusyApi,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyBlock[]> {
  const res = await api.query({ requestBody: buildFreeBusyRequest(timeMin, timeMax) });
  const primary = res.data.calendars?.primary;
  const errors = primary?.errors ?? [];
  if (errors.length > 0) {
    // NOTE: A calendar error must not read as "fully free" — that would open
    // the gate during real meetings. Surface it so the sync records an error.
    throw new Error(
      `FreeBusy error: ${errors.map((e) => `${e.domain ?? '?'}/${e.reason ?? '?'}`).join(', ')}`,
    );
  }
  const blocks: BusyBlock[] = [];
  for (const b of primary?.busy ?? []) {
    if (!b.start || !b.end) continue;
    const startAt = new Date(b.start);
    const endAt = new Date(b.end);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;
    blocks.push({ startAt, endAt });
  }
  return blocks;
}

/**
 * Build the consent URL for the calendar-only OAuth flow.
 *
 * @param client - OAuth client / OAuth クライアント
 * @param state - CSRF state echoed back to the callback / CSRF 対策の state
 * @returns Consent URL / 同意画面 URL
 */
export function buildCalendarAuthUrl(client: CalendarAuthUrlClient, state: string): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [FREEBUSY_SCOPE],
    // consent forces Google to return a refresh token even on re-connect.
    prompt: 'consent',
    state,
  });
}

/**
 * OAuth client dedicated to the calendar flow (separate redirect URI from login).
 *
 * @returns A googleapis OAuth2 client / OAuth2 クライアント
 */
export function createCalendarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_CALLBACK_URL ||
      'http://127.0.0.1:3001/calendar-slots/oauth/callback',
  );
}

/**
 * Build a busy-block fetcher backed by Google using the stored refresh token.
 *
 * @param tokenStore - Where the refresh token lives / リフレッシュトークンの保管先
 * @returns Fetcher for a time range / 時間範囲を受け取る取得関数
 */
export function createGoogleBusyFetcher(
  tokenStore: CalendarTokenStore,
): (timeMin: Date, timeMax: Date) => Promise<BusyBlock[]> {
  return async (timeMin, timeMax) => {
    const refreshToken = tokenStore.get();
    if (!refreshToken) throw new CalendarNotConnectedError();
    const auth = createCalendarOAuthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth });
    const api: FreeBusyApi = {
      query: async (params) => {
        const res = await calendar.freebusy.query(params);
        return { data: res.data as FreeBusyResponseLike };
      },
    };
    return fetchBusyBlocks(api, timeMin, timeMax);
  };
}
