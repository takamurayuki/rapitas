import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTask } from '@/hooks/workflow/useThemeAutoRun';
import { useAutoRunTaskSelection } from '../useAutoRunTaskSelection';

const tasks: ActiveTask[] = [
  { id: 10, title: '先頭', role: 'head' },
  { id: 11, title: '並列1', role: 'companion' },
  { id: 12, title: '並列2', role: 'companion' },
];
const key = (id: number) => `rapitas:autoRun:selectedTask:${id}`;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('テーマ別のタスク選択', () => {
  it('初回描画では先頭を表示し、描画後だけ保存値を読む', () => {
    localStorage.setItem(key(5), '11');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const renders: { id: number | null; reads: number }[] = [];
    const { result } = renderHook(() => {
      const selection = useAutoRunTaskSelection(5, tasks);
      renders.push({ id: selection.selectedId, reads: read.mock.calls.length });
      return selection;
    });
    expect(renders[0]).toEqual({ id: 10, reads: 0 });
    expect(result.current.selectedId).toBe(11);
  });

  it('SSRでは保存領域を読まず先頭を表示する', () => {
    localStorage.setItem(key(5), '11');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    function Probe() {
      return String(useAutoRunTaskSelection(5, tasks).selectedId);
    }
    expect(renderToString(createElement(Probe))).toBe('10');
    expect(read).not.toHaveBeenCalled();
  });

  it('選択をテーマ別に保存し、切替先の値を描画後に復元する', () => {
    localStorage.setItem(key(6), '12');
    const { result, rerender, unmount } = renderHook(
      ({ themeId }) => useAutoRunTaskSelection(themeId, tasks),
      { initialProps: { themeId: 5 } },
    );
    act(() => result.current.select(11));
    expect(localStorage.getItem(key(5))).toBe('11');
    rerender({ themeId: 6 });
    expect(result.current.selectedId).toBe(12);
    act(() => result.current.select(10));
    expect(localStorage.getItem(key(6))).toBe('10');
    rerender({ themeId: 5 });
    expect(result.current.selectedId).toBe(11);
    unmount();
    expect(renderHook(() => useAutoRunTaskSelection(5, tasks)).result.current.selectedId).toBe(11);
  });

  it.each(['broken', '', '0', '-1', '11.5', '999'])('保存値 %j が無効なら先頭に戻る', (value) => {
    localStorage.setItem(key(5), value);
    expect(renderHook(() => useAutoRunTaskSelection(5, tasks)).result.current.selectedId).toBe(10);
  });

  it('読取り例外では先頭を表示する', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('読取り禁止');
    });
    expect(renderHook(() => useAutoRunTaskSelection(5, tasks)).result.current.selectedId).toBe(10);
  });

  it('書込み例外では選択を先頭に戻す', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('書込み禁止');
    });
    const { result } = renderHook(() => useAutoRunTaskSelection(5, tasks));
    act(() => result.current.select(11));
    expect(result.current.selectedId).toBe(10);
  });

  it('消失時は導出で先頭へ戻し、保存値は保持して再出現時に復元する', () => {
    const { result, rerender } = renderHook(
      ({ activeTasks }) => useAutoRunTaskSelection(5, activeTasks),
      { initialProps: { activeTasks: tasks } },
    );
    act(() => result.current.select(11));
    const write = vi.spyOn(Storage.prototype, 'setItem');
    rerender({ activeTasks: [tasks[0], tasks[2]] });
    expect(result.current.selectedId).toBe(10);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(key(5))).toBe('11');
    rerender({ activeTasks: tasks });
    expect(result.current.selectedId).toBe(11);
  });

  it.each([undefined, []])('一覧 %j には選択IDがない', (activeTasks) => {
    expect(
      renderHook(() => useAutoRunTaskSelection(5, activeTasks)).result.current.selectedId,
    ).toBeNull();
  });

  it('テーマ未指定では保存領域にアクセスせず画面内で選択する', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useAutoRunTaskSelection(undefined, tasks));
    act(() => result.current.select(11));
    expect(result.current.selectedId).toBe(11);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
