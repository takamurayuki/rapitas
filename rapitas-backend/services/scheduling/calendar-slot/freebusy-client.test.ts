/**
 * freebusy-client.test
 *
 * Pins AC1 (task 1174): the only Google Calendar call is freebusy.query with
 * a payload of time range + primary calendar id, the OAuth scope is
 * calendar.freebusy only, and the login-flow scopes stay untouched.
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  FREEBUSY_SCOPE,
  buildFreeBusyRequest,
  buildCalendarAuthUrl,
  fetchBusyBlocks,
  type FreeBusyApi,
} from './freebusy-client';

const timeMin = new Date('2026-10-12T00:00:00.000Z');
const timeMax = new Date('2026-10-19T00:00:00.000Z');
const FORBIDDEN_KEYS = ['summary', 'attendees', 'description', 'location', 'organizer', 'fields'];

describe('buildFreeBusyRequest', () => {
  it('contains only timeMin / timeMax / items:[{id:"primary"}]', () => {
    const req = buildFreeBusyRequest(timeMin, timeMax);
    expect(req).toEqual({
      timeMin: '2026-10-12T00:00:00.000Z',
      timeMax: '2026-10-19T00:00:00.000Z',
      items: [{ id: 'primary' }],
    });
    const json = JSON.stringify(req);
    for (const key of FORBIDDEN_KEYS) expect(json).not.toContain(`"${key}"`);
  });
});

describe('fetchBusyBlocks', () => {
  it('sends exactly the fixed payload and maps busy intervals to dates', async () => {
    const query = mock(async () => ({
      data: {
        calendars: {
          primary: {
            busy: [
              { start: '2026-10-12T10:00:00Z', end: '2026-10-12T11:00:00Z' },
              { start: null, end: '2026-10-12T12:00:00Z' },
            ],
          },
        },
      },
    }));
    const api: FreeBusyApi = { query };
    const blocks = await fetchBusyBlocks(api, timeMin, timeMax);

    expect(query).toHaveBeenCalledTimes(1);
    const sent = (query.mock.calls[0] as unknown as [{ requestBody: unknown }])[0];
    expect(Object.keys(sent)).toEqual(['requestBody']);
    expect(sent.requestBody).toEqual(buildFreeBusyRequest(timeMin, timeMax));
    expect(blocks).toEqual([
      {
        startAt: new Date('2026-10-12T10:00:00Z'),
        endAt: new Date('2026-10-12T11:00:00Z'),
      },
    ]);
    // The mapped result must carry no field beyond start/end.
    expect(Object.keys(blocks[0]!)).toEqual(['startAt', 'endAt']);
  });

  it('throws when Google reports a per-calendar error instead of silently returning free', async () => {
    const api: FreeBusyApi = {
      query: async () => ({
        data: { calendars: { primary: { errors: [{ domain: 'global', reason: 'notFound' }] } } },
      }),
    };
    await expect(fetchBusyBlocks(api, timeMin, timeMax)).rejects.toThrow(/notFound/);
  });
});

describe('buildCalendarAuthUrl', () => {
  it('requests the calendar.freebusy scope only and carries the CSRF state', () => {
    const generateAuthUrl = mock((opts: { scope: string[]; state: string }) => {
      return `https://accounts.example/auth?scope=${opts.scope.join(' ')}&state=${opts.state}`;
    });
    const url = buildCalendarAuthUrl({ generateAuthUrl }, 'abc');
    const opts = (
      generateAuthUrl.mock.calls[0] as unknown as [{ scope: string[]; state: string }]
    )[0];
    expect(opts.scope).toEqual([FREEBUSY_SCOPE]);
    expect(FREEBUSY_SCOPE).toBe('https://www.googleapis.com/auth/calendar.freebusy');
    expect(url).toContain('state=abc');
    expect(url).not.toContain('calendar.readonly');
    expect(url).not.toContain('calendar.events');
  });

  it('leaves the login-flow scopes untouched (userinfo only)', async () => {
    const src = await Bun.file(
      new URL('../../../routes/system/auth/google-oauth.ts', import.meta.url),
    ).text();
    const scopes = src.match(/const GOOGLE_SCOPES = \[([\s\S]*?)\];/)?.[1] ?? '';
    expect(scopes).toContain('userinfo.email');
    expect(scopes).toContain('userinfo.profile');
    expect(scopes).not.toContain('calendar');
  });
});
