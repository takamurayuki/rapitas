/**
 * RelatedKnowledgePanel ちらつき回帰テスト
 *
 * 入力停止 1200ms 後にのみ fetch が走り、結果 0 件では DOM を生成せず、
 * 再検索中は前回の結果が維持されることを fake timers で検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { RelatedKnowledgePanel, RELATED_PANEL_DEBOUNCE_MS } from './RelatedKnowledgePanel';

const entry = (id: number) => ({
  id,
  title: `K${id}`,
  content: 'content',
  category: 'general',
  confidence: 0.5,
  relevanceScore: 40,
});

const okJson = (entries: unknown) => ({ ok: true, json: async () => ({ entries }) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RelatedKnowledgePanel', () => {
  it('マウント直後を含め 1200ms 未満では fetch しない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<RelatedKnowledgePanel title="タスク作成画面のちらつき" />);
    await advance(RELATED_PANEL_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('連続入力中は fetch せず、停止 1200ms 後に最新値で 1 回だけ fetch する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([]));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<RelatedKnowledgePanel title="タスク作" />);
    await advance(400);
    rerender(<RelatedKnowledgePanel title="タスク作成画" />);
    await advance(400);
    rerender(<RelatedKnowledgePanel title="タスク作成画面のちらつき" />);
    // 1199ms after the LAST keystroke: still quiet — no fetch anywhere so far.
    await advance(RELATED_PANEL_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      encodeURIComponent('タスク作成画面のちらつき'),
    );
  });

  it('loading 中および 0 件応答時に DOM を生成しない', async () => {
    const pending = deferred<ReturnType<typeof okJson>>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<RelatedKnowledgePanel title="タスク作成画面のちらつき" />);
    await advance(RELATED_PANEL_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // In flight: no empty box may appear (the old flicker).
    expect(container.firstChild).toBeNull();
    await act(async () => {
      pending.resolve(okJson([]));
    });
    // Settled with zero results: still no DOM.
    expect(container.firstChild).toBeNull();
  });

  it('再検索中は前回の entries を表示し続け、0 件確定で非表示になる', async () => {
    const pending = deferred<ReturnType<typeof okJson>>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson([entry(1)]))
      .mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender, container } = render(<RelatedKnowledgePanel title="タスク作成画面" />);
    await advance(RELATED_PANEL_DEBOUNCE_MS);
    expect(screen.getByText('K1')).toBeInTheDocument();

    rerender(<RelatedKnowledgePanel title="タスク作成画面のちらつき" />);
    await advance(RELATED_PANEL_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Refresh in flight: the previous panel content must not vanish.
    expect(screen.getByText('K1')).toBeInTheDocument();

    await act(async () => {
      pending.resolve(okJson([]));
    });
    // Zero results settled for the new query: panel hides.
    expect(container.firstChild).toBeNull();
  });
});
