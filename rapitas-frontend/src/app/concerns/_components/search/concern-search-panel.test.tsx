/**
 * concern-search-panel.test.tsx
 *
 * Component tests for keyboard navigation, screen-reader labels, the live region
 * and the offline fallback of the PERF concern search panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import jaMessages from '../../../../../messages/ja.json';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const tpl =
      (jaMessages as { concerns: { search: Record<string, string> } }).concerns.search[
        key.replace('search.', '')
      ] ?? key;
    return tpl.replace(/\{(\w+)\}/g, (_, k) => String(values?.[k]));
  },
}));

vi.mock('@/hooks/common/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    isTranscribing: false,
    isSupported: true,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

import ConcernSearchPanel from './concern-search-panel';

const response = {
  items: [
    {
      id: 1,
      title: 'Slow query',
      impactScore: 8.5,
      relatedTasks: 3,
      priority: 'Critical',
      pattern: '⬛⬛⬛',
    },
    {
      id: 2,
      title: 'Big bundle',
      impactScore: 6.5,
      relatedTasks: 0,
      priority: 'High',
      pattern: '⬛⬛⬜',
    },
    {
      id: 3,
      title: 'Slow render',
      impactScore: 2,
      relatedTasks: 0,
      priority: 'Low',
      pattern: '⬜⬜⬜',
    },
  ],
  total: 3,
  parsed: { type: 'perf', severities: [], keywords: [] },
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  setOnline(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => response })),
  );
});

describe('ConcernSearchPanel', () => {
  it('announces the count in a polite status region and labels options for screen readers', async () => {
    render(<ConcernSearchPanel />);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0].getAttribute('aria-label')).toBe(
      '影響度 8.5、関連タスク 3件、優先度 Critical、Slow query',
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(status.textContent).toBe('3件の懸念が見つかりました'));
  });

  it('moves focus with arrow keys, Home and End (roving tabindex)', async () => {
    render(<ConcernSearchPanel />);
    const options = await screen.findAllByRole('option');
    expect(options[0].getAttribute('tabindex')).toBe('0');
    expect(options[1].getAttribute('tabindex')).toBe('-1');
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(options[1], { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
  });

  it('disables voice input offline and still searches the cached results by text', async () => {
    render(<ConcernSearchPanel />);
    await screen.findAllByRole('option');

    setOnline(false);
    fireEvent(window, new Event('offline'));

    const mic = await screen.findByRole('button', { name: '音声入力を開始' });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getAllByText(
        'オフラインでは音声入力を利用できません。テキスト検索を使用してください。',
      ).length,
    ).toBeGreaterThan(0);

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('懸念を検索'), { target: { value: 'render' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('surfaces API failure via role=alert and falls back to cached results', async () => {
    render(<ConcernSearchPanel />);
    await screen.findAllByRole('option');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'));
    fireEvent.change(screen.getByLabelText('懸念を検索'), { target: { value: 'slow' } });
    fireEvent.submit(screen.getByRole('search'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '検索に失敗しました。取得済みの結果を表示します。',
    );
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});
