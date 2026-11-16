/**
 * forward-to-app tests (#1421)
 *
 * The phone's token and any cookies must never reach the app, and when the
 * main API enforces RAPITAS_API_TOKEN the forwarded request must carry it.
 */
import { describe, test, expect } from 'bun:test';
import { createAppForwarder } from './forward-to-app';
import { currentWorkspaceId } from '../tenancy/workspace-context';
import type { PairedDevice } from './mobile-link-store';

const device = (workspaceId: number | null): PairedDevice => ({
  id: 'd',
  name: 'iPhone',
  tokenHash: 'h',
  workspaceId,
  createdAt: '',
  lastSeenAt: null,
});

function capture() {
  const seen: { headers?: Headers; workspace?: number | null; body?: string } = {};
  const app = {
    fetch: async (request: Request) => {
      seen.headers = request.headers;
      seen.workspace = currentWorkspaceId();
      seen.body = request.body ? await request.text() : undefined;
      return new Response('ok');
    },
  };
  return { app, seen };
}

const incoming = (method = 'GET', body?: string) =>
  new Request('http://192.168.1.5:3002/tasks', {
    method,
    headers: { Authorization: 'Bearer device-token', Cookie: 'session=desktop' },
    body,
  });

describe('createAppForwarder', () => {
  test('strips the device token and cookies when no API token is configured', async () => {
    const { app, seen } = capture();
    await createAppForwarder(app, undefined)(incoming(), device(null));
    expect(seen.headers!.get('authorization')).toBeNull();
    expect(seen.headers!.get('cookie')).toBeNull();
  });

  test('substitutes RAPITAS_API_TOKEN when the main API requires it', async () => {
    const { app, seen } = capture();
    await createAppForwarder(app, 'env-token')(incoming(), device(null));
    expect(seen.headers!.get('authorization')).toBe('Bearer env-token');
  });

  test('runs in the paired workspace, and passes the body through', async () => {
    const { app, seen } = capture();
    await createAppForwarder(app, undefined)(incoming('POST', '{"title":"x"}'), device(4));
    expect(seen.workspace).toBe(4);
    expect(seen.body).toBe('{"title":"x"}');
  });
});
