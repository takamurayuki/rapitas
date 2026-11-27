import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ openGoals: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock('./goal-reflection-api', () => ({ goalReflectionApi: api }));
import { useGoalReflection } from './useGoalReflection';

function pendingSave() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.openGoals.mockResolvedValue([
    { id: 1, name: '英語' },
    { id: 2, name: '資格' },
  ]);
  api.list.mockResolvedValue([]);
  api.save.mockResolvedValue({});
});

describe('保存応答と編集の整合性', () => {
  it.each(['rating', 'note'] as const)(
    '応答待ちに変更した %s を未保存として再送できる',
    async (field) => {
      const pending = pendingSave();
      api.save.mockReturnValueOnce(pending.promise);
      const { result } = renderHook(() => useGoalReflection(true));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.setRating(1, 2));
      let saving!: Promise<void>;
      act(() => {
        saving = result.current.save();
      });
      act(() => {
        if (field === 'rating') result.current.setRating(1, 5);
        else result.current.setNote(1, '送信後の一言');
      });
      await act(async () => {
        pending.resolve({});
        await saving;
      });
      expect(api.save).toHaveBeenNthCalledWith(1, 1, 2, '');
      expect(result.current.rows[0]).toMatchObject({ saved: true, dirty: true });
      expect(result.current.status).toBe('ready');
      expect(result.current.canSave).toBe(true);
      await act(async () => {
        await result.current.save();
      });
      expect(api.save).toHaveBeenNthCalledWith(
        2,
        1,
        field === 'rating' ? 5 : 2,
        field === 'note' ? '送信後の一言' : '',
      );
      expect(result.current.rows[0].dirty).toBe(false);
      expect(result.current.status).toBe('savedAll');
    },
  );

  it('送信対象外のゴールを応答待ちに編集しても保存完了とは表示しない', async () => {
    const pending = pendingSave();
    api.save.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useGoalReflection(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setRating(1, 2));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save();
    });
    act(() => result.current.setRating(2, 4));
    await act(async () => {
      pending.resolve({});
      await saving;
    });
    expect(result.current.rows[0]).toMatchObject({ saved: true, dirty: false });
    expect(result.current.rows[1]).toMatchObject({ saved: false, dirty: true });
    expect(result.current.status).toBe('ready');
    expect(result.current.canSave).toBe(true);
  });

  it.each(['成功', '失敗'])(
    '閉じて開き直した後に古い保存が%sしても新しい編集に影響しない',
    async (outcome) => {
      const pending = pendingSave();
      api.save.mockReturnValueOnce(pending.promise);
      const { result, rerender } = renderHook(({ open }) => useGoalReflection(open), {
        initialProps: { open: true },
      });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.setRating(1, 2));
      let saving!: Promise<void>;
      act(() => {
        saving = result.current.save();
      });
      rerender({ open: false });
      rerender({ open: true });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.setRating(1, 5));
      await act(async () => {
        if (outcome === '成功') pending.resolve({});
        else pending.reject(new Error('古い保存の失敗'));
        await saving;
      });
      expect(result.current.rows[0]).toMatchObject({ rating: 5, saved: false, dirty: true });
      expect(result.current.status).toBe('ready');
      expect(result.current.failed).toBeNull();
      expect(result.current.canSave).toBe(true);
    },
  );

  it('古い応答が再表示後の保存中状態を解除しない', async () => {
    const oldSave = pendingSave();
    const newSave = pendingSave();
    api.save.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise);
    const { result, rerender } = renderHook(({ open }) => useGoalReflection(open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setRating(1, 2));
    let first!: Promise<void>;
    act(() => {
      first = result.current.save();
    });
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setRating(1, 5));
    let second!: Promise<void>;
    act(() => {
      second = result.current.save();
    });
    await act(async () => {
      oldSave.resolve({});
      await first;
    });
    expect(result.current.status).toBe('saving');
    expect(result.current.rows[0].dirty).toBe(true);
    await act(async () => {
      newSave.resolve({});
      await second;
    });
    expect(result.current.rows[0]).toMatchObject({ rating: 5, saved: true, dirty: false });
    expect(result.current.status).toBe('savedAll');
  });

  it('保存を続けて呼んでも同じ表示中は二重送信しない', async () => {
    const pending = pendingSave();
    api.save.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useGoalReflection(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setRating(1, 2));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.save();
      second = result.current.save();
    });
    await act(async () => {
      pending.resolve({});
      await Promise.all([first, second]);
    });
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});
