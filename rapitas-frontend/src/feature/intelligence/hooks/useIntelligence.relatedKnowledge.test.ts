/**
 * useRelatedKnowledge 状態遷移テスト
 *
 * 3文字未満での即時クリアと、順不同で返る応答のうち最新リクエストのみが
 * 状態を書き込むこと（stale response ガード）、更新中の前回結果保持を検証する。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test' }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { useRelatedKnowledge } from './useIntelligence';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRelatedKnowledge', () => {
  it('3文字未満のクエリで entries が即座に空になり fetch しない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson([entry(1)]));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRelatedKnowledge());

    await act(async () => {
      await result.current.search('タスク作成画面');
    });
    expect(result.current.entries).toHaveLength(1);

    await act(async () => {
      await result.current.search('ab');
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // short query never hits the API
  });

  it('再検索の開始時に前回の entries を保持する（loading 中もクリアしない）', async () => {
    const pending = deferred<ReturnType<typeof okJson>>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson([entry(1)]))
      .mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRelatedKnowledge());

    await act(async () => {
      await result.current.search('タスク作成画面');
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([1]);

    let second: Promise<void> | undefined;
    act(() => {
      second = result.current.search('タスク作成画面のちらつき');
    });
    // Refresh in flight: previous results must survive.
    expect(result.current.loading).toBe(true);
    expect(result.current.entries.map((e) => e.id)).toEqual([1]);

    pending.resolve(okJson([entry(2)]));
    await act(async () => {
      await second;
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([2]);
    expect(result.current.loading).toBe(false);
  });

  it('遅延した古い応答が新しい結果を上書きしない', async () => {
    const d1 = deferred<ReturnType<typeof okJson>>();
    const d2 = deferred<ReturnType<typeof okJson>>();
    const fetchMock = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRelatedKnowledge());

    let p1: Promise<void> | undefined;
    let p2: Promise<void> | undefined;
    act(() => {
      p1 = result.current.search('クエリ一号のタイトル');
    });
    act(() => {
      p2 = result.current.search('クエリ二号のタイトル');
    });

    d2.resolve(okJson([entry(2)]));
    await act(async () => {
      await p2;
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([2]);

    // The FIRST (stale) response arrives last — it must be discarded.
    d1.resolve(okJson([entry(1)]));
    await act(async () => {
      await p1;
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([2]);
    expect(result.current.loading).toBe(false);
  });
});
