/**
 * useSubtaskSelection.test.ts
 *
 * サブタスク選択モード・個別選択・全選択/全解除・一括削除確認フローの
 * 状態遷移を検証する。
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubtaskSelection } from '../useSubtaskSelection';
import type { Task } from '@/types';

const createMockTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 1,
    title: 'Subtask',
    status: 'todo',
    priority: 'medium',
    labels: '[]',
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  }) as Task;

describe('useSubtaskSelection', () => {
  const subtasks = [
    createMockTask({ id: 1 }),
    createMockTask({ id: 2 }),
    createMockTask({ id: 3 }),
  ];

  it('初期状態は選択モードOFF・選択なし・確認ダイアログなしであること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    expect(result.current.isSelectionMode).toBe(false);
    expect(result.current.selectedSubtaskIds.size).toBe(0);
    expect(result.current.showDeleteConfirm).toBeNull();
  });

  it('toggleSelectionModeで選択モードをON/OFFできること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.toggleSelectionMode());
    expect(result.current.isSelectionMode).toBe(true);

    act(() => result.current.toggleSelectionMode());
    expect(result.current.isSelectionMode).toBe(false);
  });

  it('選択モードをOFFにすると選択中のIDがクリアされること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.toggleSelectionMode());
    act(() => result.current.toggleSubtaskSelection(1));
    expect(result.current.selectedSubtaskIds.has(1)).toBe(true);

    act(() => result.current.toggleSelectionMode());
    expect(result.current.selectedSubtaskIds.size).toBe(0);
  });

  it('toggleSubtaskSelectionで個別のIDをトグルできること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.toggleSubtaskSelection(2));
    expect(result.current.selectedSubtaskIds.has(2)).toBe(true);

    act(() => result.current.toggleSubtaskSelection(2));
    expect(result.current.selectedSubtaskIds.has(2)).toBe(false);
  });

  it('selectAllSubtasksで全サブタスクのIDが選択されること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.selectAllSubtasks());

    expect(result.current.selectedSubtaskIds).toEqual(new Set([1, 2, 3]));
  });

  it('deselectAllSubtasksで選択が全解除されること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.selectAllSubtasks());
    act(() => result.current.deselectAllSubtasks());

    expect(result.current.selectedSubtaskIds.size).toBe(0);
  });

  it('setShowDeleteConfirmで確認ダイアログの種別を設定できること', () => {
    const { result } = renderHook(() => useSubtaskSelection(subtasks));

    act(() => result.current.setShowDeleteConfirm('all'));
    expect(result.current.showDeleteConfirm).toBe('all');

    act(() => result.current.setShowDeleteConfirm('selected'));
    expect(result.current.showDeleteConfirm).toBe('selected');
  });

  describe('handleDeleteSelected', () => {
    it('選択件数が0件の場合はコールバックを呼ばないこと', () => {
      const { result } = renderHook(() => useSubtaskSelection(subtasks));
      const onDelete = vi.fn();

      act(() => result.current.handleDeleteSelected(onDelete));

      expect(onDelete).not.toHaveBeenCalled();
    });

    it('選択済みIDでコールバックを呼び、状態をリセットすること', () => {
      const { result } = renderHook(() => useSubtaskSelection(subtasks));
      const onDelete = vi.fn();

      act(() => result.current.toggleSelectionMode());
      act(() => result.current.toggleSubtaskSelection(1));
      act(() => result.current.toggleSubtaskSelection(3));
      act(() => result.current.setShowDeleteConfirm('selected'));

      act(() => result.current.handleDeleteSelected(onDelete));

      expect(onDelete).toHaveBeenCalledWith([1, 3]);
      expect(result.current.selectedSubtaskIds.size).toBe(0);
      expect(result.current.isSelectionMode).toBe(false);
      expect(result.current.showDeleteConfirm).toBeNull();
    });

    it('コールバック未指定の場合は何もしないこと（例外なし）', () => {
      const { result } = renderHook(() => useSubtaskSelection(subtasks));

      act(() => result.current.toggleSubtaskSelection(1));

      expect(() => {
        act(() => result.current.handleDeleteSelected(undefined));
      }).not.toThrow();
      // No callback means the selection guard short-circuits; state is untouched.
      expect(result.current.selectedSubtaskIds.has(1)).toBe(true);
    });
  });

  describe('handleDeleteAll', () => {
    it('コールバックを呼び、確認ダイアログを閉じること', () => {
      const { result } = renderHook(() => useSubtaskSelection(subtasks));
      const onDeleteAll = vi.fn();

      act(() => result.current.setShowDeleteConfirm('all'));
      act(() => result.current.handleDeleteAll(onDeleteAll));

      expect(onDeleteAll).toHaveBeenCalledTimes(1);
      expect(result.current.showDeleteConfirm).toBeNull();
    });

    it('コールバック未指定の場合は何もしないこと（例外なし）', () => {
      const { result } = renderHook(() => useSubtaskSelection(subtasks));

      act(() => result.current.setShowDeleteConfirm('all'));

      expect(() => {
        act(() => result.current.handleDeleteAll(undefined));
      }).not.toThrow();
      // No callback means the dialog state is left as-is (guard short-circuits).
      expect(result.current.showDeleteConfirm).toBe('all');
    });
  });
});
