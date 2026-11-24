/**
 * ConfirmLinkIssuer.test
 *
 * The issuer panel loads links and resources only when opened, issues a link
 * with the request text (POST), shows the URL, and toggles a resource's
 * 「外部公開可」 flag (PUT) — every call tagged X-Rapitas-Source: ui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmLinkIssuer } from './ConfirmLinkIssuer';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      return jsonResponse({
        enabled: true,
        links: [],
        resources: [{ id: 5, title: '仕様書', externalPublic: false }],
      });
    }
    if (method === 'POST') {
      return jsonResponse({
        linkId: 'L1',
        url: '/public/confirm-links/v1.L1.1.sig',
        expiresAt: Date.now() + 86_400_000,
        relative: true,
      });
    }
    return jsonResponse({ resourceId: 5, externalPublic: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function sourceHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('x-rapitas-source');
}

describe('ConfirmLinkIssuer', () => {
  it('does not call the API until the panel is opened', () => {
    render(<ConfirmLinkIssuer taskId={9} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issues a link with the request text and shows the URL and the relative-path warning', async () => {
    render(<ConfirmLinkIssuer taskId={9} />);
    fireEvent.click(screen.getByRole('button', { name: /openButton/ }));
    await screen.findByText('仕様書');

    fireEvent.change(screen.getByLabelText('messageLabel'), {
      target: { value: '確認お願いします' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'issueButton' }));

    await screen.findByDisplayValue('/public/confirm-links/v1.L1.1.sig');
    expect(screen.getByText('relativeWarning')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toContain('/workflow/tasks/9/confirm-links');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ message: '確認お願いします' });
    expect(sourceHeader(post?.[1])).toBe('ui');
  });

  it('toggling a resource sends a PUT with the new flag', async () => {
    render(<ConfirmLinkIssuer taskId={9} />);
    fireEvent.click(screen.getByRole('button', { name: /openButton/ }));
    const toggle = await screen.findByRole('checkbox', { name: /仕様書/ });

    fireEvent.click(toggle);

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put?.[0]).toContain('/workflow/confirm-links/resources/5/visibility');
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ externalPublic: true });
      expect(sourceHeader(put?.[1])).toBe('ui');
    });
  });
  it('shows copyFailed, not copied, when the clipboard write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ConfirmLinkIssuer taskId={9} />);
    fireEvent.click(screen.getByRole('button', { name: /openButton/ }));
    await screen.findByText('仕様書');
    fireEvent.click(screen.getByRole('button', { name: 'issueButton' }));
    await screen.findByDisplayValue('/public/confirm-links/v1.L1.1.sig');

    fireEvent.click(screen.getByRole('button', { name: /copy/ }));

    await screen.findByText('copyFailed');
    expect(writeText).toHaveBeenCalledWith('/public/confirm-links/v1.L1.1.sig');
    expect(screen.queryByText('copied')).toBeNull();
  });
});
