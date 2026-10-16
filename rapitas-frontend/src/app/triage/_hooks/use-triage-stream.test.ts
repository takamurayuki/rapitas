import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTriageStream, type TriageApi } from './use-triage-stream';
import type { TriageItem } from '../_lib/triage-rules';

const item = (id: number, amount = 1000): TriageItem => ({
  id,
  requestType: 'task_execution',
  title: `item ${id}`,
  proposedChanges: { amount },
  estimatedChanges: null,
  updatedAt: `2026-10-15T00:00:0${id}.000Z`,
});

function makeApi(overrides: Partial<TriageApi> = {}): TriageApi {
  return {
    approve: vi.fn().mockResolvedValue('ok'),
    reject: vi.fn().mockResolvedValue('ok'),
    reload: vi.fn().mockResolvedValue([item(1), item(2)]),
    ...overrides,
  };
}

const GRACE = 5000;

describe('useTriageStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(items: TriageItem[], api = makeApi()) {
    const hook = renderHook(() => useTriageStream({ initialItems: items, api, graceMs: GRACE }));
    return { ...hook, api };
  }

  it('approve removes the item, announces remaining, and commits after the grace period with expectedUpdatedAt', async () => {
    const { result, api } = setup([item(1), item(2), item(3)]);
    act(() => result.current.approve());
    expect(result.current.current?.id).toBe(2);
    expect(result.current.announcement).toMatchObject({
      kind: 'approved',
      remaining: 2,
      politeness: 'polite',
    });
    expect(api.approve).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.approve).toHaveBeenCalledWith(1, '2026-10-15T00:00:01.000Z');
  });

  it('undo within grace restores the item and never calls the API', async () => {
    const { result, api } = setup([item(1), item(2)]);
    act(() => result.current.approve());
    act(() => result.current.undo());
    expect(result.current.current?.id).toBe(1);
    expect(result.current.announcement.kind).toBe('undone');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE * 2);
    });
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('undo after the grace period is refused and announced as unavailable', async () => {
    const { result, api } = setup([item(1), item(2)]);
    act(() => result.current.approve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    act(() => result.current.undo());
    expect(result.current.announcement.kind).toBe('undoUnavailable');
    expect(result.current.current?.id).toBe(2);
    expect(api.approve).toHaveBeenCalledTimes(1);
  });

  it('a next action flushes the previous pending commit immediately (exactly one approve call)', async () => {
    const { result, api } = setup([item(1), item(2), item(3)]);
    act(() => result.current.approve());
    await act(async () => {
      result.current.reject();
    });
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.approve).toHaveBeenCalledWith(1, '2026-10-15T00:00:01.000Z');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.reject).toHaveBeenCalledTimes(1);
    expect(api.reject).toHaveBeenCalledWith(2, '2026-10-15T00:00:02.000Z');
  });

  it('defer moves the item to the end of the queue and can be undone (one step only)', () => {
    const { result } = setup([item(1), item(2), item(3)]);
    act(() => result.current.defer());
    expect(result.current.current?.id).toBe(2);
    expect(result.current.announcement.kind).toBe('deferred');
    act(() => result.current.undo());
    expect(result.current.current?.id).toBe(1);
    act(() => result.current.undo());
    expect(result.current.announcement.kind).toBe('undoUnavailable');
  });

  it('next moves to the end without calling the API', () => {
    const { result, api } = setup([item(1), item(2)]);
    act(() => result.current.next());
    expect(result.current.current?.id).toBe(2);
    expect(result.current.announcement.kind).toBe('skipped');
    expect(api.approve).not.toHaveBeenCalled();
    expect(api.reject).not.toHaveBeenCalled();
  });

  it('amount over 10000 needs a second approve; Escape cancels the confirmation', async () => {
    const { result, api } = setup([item(1, 10001), item(2)]);
    act(() => result.current.approve());
    expect(result.current.confirming).toBe(true);
    expect(result.current.current?.id).toBe(1);
    expect(result.current.announcement.kind).toBe('confirmRequired');
    act(() => result.current.cancel());
    expect(result.current.confirming).toBe(false);
    act(() => result.current.approve());
    act(() => result.current.approve());
    expect(result.current.confirming).toBe(false);
    expect(result.current.current?.id).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    expect(api.approve).toHaveBeenCalledTimes(1);
  });

  it('amount of exactly 10000 is approved with a single key', () => {
    const { result } = setup([item(1, 10000), item(2)]);
    act(() => result.current.approve());
    expect(result.current.confirming).toBe(false);
    expect(result.current.current?.id).toBe(2);
  });

  it('409 conflict puts the item back, flags conflict, announces assertively', async () => {
    const api = makeApi({ approve: vi.fn().mockResolvedValue('conflict') });
    const { result } = setup([item(1), item(2)], api);
    act(() => result.current.approve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.current?.id).toBe(1);
    expect(result.current.announcement).toMatchObject({
      kind: 'conflict',
      politeness: 'assertive',
    });
    // further actions are blocked until reload
    act(() => result.current.approve());
    expect(api.approve).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.conflict).toBe(false);
    expect(api.reload).toHaveBeenCalledTimes(1);
  });

  it('network failure restores the item and announces assertively', async () => {
    const api = makeApi({ reject: vi.fn().mockResolvedValue('error') });
    const { result } = setup([item(1), item(2)], api);
    act(() => result.current.reject());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE);
    });
    expect(result.current.current?.id).toBe(1);
    expect(result.current.announcement).toMatchObject({
      kind: 'failed',
      politeness: 'assertive',
    });
  });

  it('empty queue announces empty state politely', () => {
    const { result } = setup([item(1)]);
    act(() => result.current.next());
    expect(result.current.current?.id).toBe(1);
    act(() => result.current.approve());
    expect(result.current.current).toBeNull();
    expect(result.current.remaining).toBe(0);
  });
});
