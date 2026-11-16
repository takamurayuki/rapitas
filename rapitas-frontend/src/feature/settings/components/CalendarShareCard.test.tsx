/**
 * CalendarShareCard.test
 *
 * Granting and revoking "who may see my calendar" (#1270).
 *
 * The list and the two buttons are the whole feature from the owner's side,
 * so what matters is that a grant actually reaches the endpoint with the
 * session attached, and that a refusal is reported as the specific thing it
 * was — "no such user" and "you cannot share with yourself" are the two
 * mistakes people will actually make, and a generic failure teaches neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CalendarShareCard from './CalendarShareCard';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://api.test',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const SHARED_BY_ME = [{ workspaceId: 5, username: 'ゆうき', email: 'y@example.com' }];

/**
 * Answer the list GET, and whatever the POST/DELETE under test should return.
 */
function stubFetch(mutation: { ok: boolean; status?: number; body?: unknown } = { ok: true }) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sharedByMe: SHARED_BY_ME, sharedWithMe: [] }),
      };
    }
    return {
      ok: mutation.ok,
      status: mutation.status ?? (mutation.ok ? 200 : 400),
      json: async () => mutation.body ?? {},
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('the list of people', () => {
  it('names everyone who can see my calendar', async () => {
    stubFetch();
    render(<CalendarShareCard />);
    expect(await screen.findByText('ゆうき')).toBeInTheDocument();
    expect(screen.getByText('y@example.com')).toBeInTheDocument();
  });

  it('sends the session cookie when loading', async () => {
    const fetchMock = stubFetch();
    render(<CalendarShareCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('says so when nothing is shared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ sharedByMe: [], sharedWithMe: [] }),
      })),
    );
    render(<CalendarShareCard />);
    expect(await screen.findByText('nobody')).toBeInTheDocument();
  });
});

describe('granting', () => {
  it('posts the identifier with the session attached', async () => {
    const fetchMock = stubFetch({ ok: true });
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');

    fireEvent.change(screen.getByLabelText('placeholder'), { target: { value: 'あやか' } });
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
      expect(post).toBeDefined();
      expect(post?.[0]).toBe('http://api.test/calendar-shares');
      expect(post?.[1]).toMatchObject({ credentials: 'include' });
      expect(JSON.parse((post?.[1] as { body: string }).body)).toEqual({ identifier: 'あやか' });
    });
  });

  it('will not post an empty name', async () => {
    const fetchMock = stubFetch();
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');
    expect(screen.getByText('add')).toBeDisabled();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);
  });

  it('says the person was not found', async () => {
    stubFetch({ ok: false, status: 404, body: { reason: 'unknown_person' } });
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');
    fireEvent.change(screen.getByLabelText('placeholder'), { target: { value: 'いない人' } });
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByText('unknownPerson')).toBeInTheDocument();
  });

  it('says you cannot share with yourself', async () => {
    stubFetch({ ok: false, status: 400, body: { reason: 'self' } });
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');
    fireEvent.change(screen.getByLabelText('placeholder'), { target: { value: 'じぶん' } });
    fireEvent.click(screen.getByText('add'));
    expect(await screen.findByText('self')).toBeInTheDocument();
  });

  it('clears the verdict as soon as the name is edited', async () => {
    stubFetch({ ok: false, status: 404, body: { reason: 'unknown_person' } });
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');
    const field = screen.getByLabelText('placeholder');
    fireEvent.change(field, { target: { value: 'いない人' } });
    fireEvent.click(screen.getByText('add'));
    await screen.findByText('unknownPerson');

    fireEvent.change(field, { target: { value: 'いない人さん' } });
    expect(screen.queryByText('unknownPerson')).not.toBeInTheDocument();
  });
});

describe('revoking', () => {
  it('deletes that workspace-s grant', async () => {
    const fetchMock = stubFetch({ ok: true });
    render(<CalendarShareCard />);
    await screen.findByText('ゆうき');

    fireEvent.click(screen.getByLabelText('revokeFor:ゆうき'));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find((call) => call[1]?.method === 'DELETE');
      expect(del?.[0]).toBe('http://api.test/calendar-shares/5');
      expect(del?.[1]).toMatchObject({ credentials: 'include' });
    });
  });
});
