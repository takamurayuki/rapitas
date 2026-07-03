/**
 * useMemoSection.test.ts
 *
 * notesの派生ロジック（返信除外・localStorageからのmemoType/isPinned反映・
 * 不正JSONの無視・フィルタ・ピン留め優先ソート）、typeStats/pinnedCount、
 * 編集・返信・投稿・テンプレート選択・一括分析の各ハンドラの状態遷移を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMemoSection } from '../useMemoSection';
import type { Comment } from '@/types';
import type { MemoTemplate } from '../types';

/** Key-echo translator stub: returns the key (with interpolated `count`, if any). */
const t = (key: string, values?: Record<string, number | string>) =>
  values?.count !== undefined ? `${key}:${values.count}` : key;

vi.mock('next-intl', () => ({
  useTranslations: () => t,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const createMockComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 1,
  taskId: 1,
  content: 'memo content',
  parentId: null,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  ...overrides,
});

describe('useMemoSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const baseOptions = () => ({
    comments: [] as Comment[],
    onAddComment: vi.fn(),
    onUpdateComment: vi.fn(),
    onNewCommentChange: vi.fn(),
    newComment: '',
  });

  it('初期状態は各種stateが未編集・フィルタなし・パネル非表示であること', () => {
    const { result } = renderHook(() => useMemoSection(baseOptions()));

    expect(result.current.editId).toBeNull();
    expect(result.current.editText).toBe('');
    expect(result.current.replyId).toBeNull();
    expect(result.current.selectedMemoType).toBe('general');
    expect(result.current.filterType).toBe('all');
    expect(result.current.showFilters).toBe(false);
    expect(result.current.showTemplates).toBe(false);
    expect(result.current.showTimeline).toBe(false);
    expect(result.current.notes).toEqual([]);
  });

  describe('notes', () => {
    it('返信（parentIdあり）はトップレベルのnotesから除外されること', () => {
      const comments = [
        createMockComment({ id: 1, parentId: null }),
        createMockComment({ id: 2, parentId: 1 }),
      ];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.notes.map((n) => n.id)).toEqual([1]);
    });

    it('localStorageのmemo-dataからmemoTypeとisPinnedを反映すること', () => {
      localStorage.setItem('memo-data-1', JSON.stringify({ memoType: 'idea', isPinned: true }));
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.notes[0].memoType).toBe('idea');
      expect(result.current.notes[0].isPinned).toBe(true);
    });

    it('localStorageにデータがない場合はgeneral/未ピンにフォールバックすること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.notes[0].memoType).toBe('general');
      expect(result.current.notes[0].isPinned).toBe(false);
    });

    it('localStorageの不正JSONは無視され、例外を投げないこと', () => {
      localStorage.setItem('memo-data-1', '{invalid json');
      const comments = [createMockComment({ id: 1 })];

      expect(() => {
        renderHook(() => useMemoSection({ ...baseOptions(), comments }));
      }).not.toThrow();
    });

    it('filterTypeで絞り込めること', () => {
      localStorage.setItem('memo-data-1', JSON.stringify({ memoType: 'idea' }));
      localStorage.setItem('memo-data-2', JSON.stringify({ memoType: 'issue' }));
      const comments = [createMockComment({ id: 1 }), createMockComment({ id: 2 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      act(() => result.current.setFilterType('idea'));

      expect(result.current.notes.map((n) => n.id)).toEqual([1]);
    });

    it('ピン留めされたメモが先頭にソートされること', () => {
      localStorage.setItem('memo-data-1', JSON.stringify({ isPinned: false }));
      localStorage.setItem('memo-data-2', JSON.stringify({ isPinned: true }));
      const comments = [
        createMockComment({ id: 1, createdAt: new Date('2026-01-02').toISOString() }),
        createMockComment({ id: 2, createdAt: new Date('2026-01-01').toISOString() }),
      ];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.notes.map((n) => n.id)).toEqual([2, 1]);
    });

    it('ピン留め状態が同じ場合は作成日時が新しい順にソートされること', () => {
      const comments = [
        createMockComment({ id: 1, createdAt: new Date('2026-01-01').toISOString() }),
        createMockComment({ id: 2, createdAt: new Date('2026-01-03').toISOString() }),
      ];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.notes.map((n) => n.id)).toEqual([2, 1]);
    });
  });

  describe('typeStats / pinnedCount', () => {
    it('各memoTypeの件数を集計すること', () => {
      localStorage.setItem('memo-data-1', JSON.stringify({ memoType: 'idea' }));
      localStorage.setItem('memo-data-2', JSON.stringify({ memoType: 'idea' }));
      localStorage.setItem('memo-data-3', JSON.stringify({ memoType: 'issue' }));
      const comments = [
        createMockComment({ id: 1 }),
        createMockComment({ id: 2 }),
        createMockComment({ id: 3 }),
      ];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.typeStats).toEqual({
        'work-log': 0,
        idea: 2,
        issue: 1,
        solution: 0,
        general: 0,
      });
    });

    it('isPinnedがtrueのメモ数を返すこと', () => {
      localStorage.setItem('memo-data-1', JSON.stringify({ isPinned: true }));
      const comments = [createMockComment({ id: 1 }), createMockComment({ id: 2 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      expect(result.current.pinnedCount).toBe(1);
    });
  });

  describe('編集フロー', () => {
    it('handleEditでeditId/editTextを設定すること', () => {
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      act(() => result.current.handleEdit(result.current.notes[0]));

      expect(result.current.editId).toBe(1);
      expect(result.current.editText).toBe('original');
    });

    it('handleSaveはonUpdateCommentを呼び、editIdをクリアすること', async () => {
      const onUpdateComment = vi.fn().mockResolvedValue(undefined);
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() =>
        useMemoSection({ ...baseOptions(), comments, onUpdateComment }),
      );

      act(() => result.current.handleEdit(result.current.notes[0]));
      act(() => result.current.setEditText('updated'));
      await act(async () => {
        await result.current.handleSave();
      });

      expect(onUpdateComment).toHaveBeenCalledWith(1, 'updated');
      expect(result.current.editId).toBeNull();
    });

    it('editIdが未設定の場合、handleSaveはonUpdateCommentを呼ばないこと', async () => {
      const onUpdateComment = vi.fn();
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), onUpdateComment }));

      await act(async () => {
        await result.current.handleSave();
      });

      expect(onUpdateComment).not.toHaveBeenCalled();
    });

    it('handleCancelでeditId/editTextをリセットすること', () => {
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      act(() => result.current.handleEdit(result.current.notes[0]));
      act(() => result.current.handleCancel());

      expect(result.current.editId).toBeNull();
      expect(result.current.editText).toBe('');
    });
  });

  describe('返信フロー', () => {
    it('handleReplyでreplyIdを設定すること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      act(() => result.current.handleReply(result.current.notes[0]));

      expect(result.current.replyId).toBe(1);
      expect(result.current.replyText).toBe('');
    });

    it('handleReplySubmitはonAddCommentを親IDつきで呼び、replyIdをクリアすること', () => {
      const onAddComment = vi.fn();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useMemoSection({ ...baseOptions(), comments, onAddComment }),
      );

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.setReplyText('reply body'));
      act(() => result.current.handleReplySubmit());

      expect(onAddComment).toHaveBeenCalledWith('reply body', 1);
      expect(result.current.replyId).toBeNull();
    });

    it('replyTextが空白のみの場合、handleReplySubmitはonAddCommentを呼ばないこと', () => {
      const onAddComment = vi.fn();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useMemoSection({ ...baseOptions(), comments, onAddComment }),
      );

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.setReplyText('   '));
      act(() => result.current.handleReplySubmit());

      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('handleReplyCancelでreplyId/replyTextをリセットすること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.handleReplyCancel());

      expect(result.current.replyId).toBeNull();
      expect(result.current.replyText).toBe('');
    });
  });

  describe('handleSubmit', () => {
    it('newCommentが空白のみの場合はonAddCommentを呼ばないこと', async () => {
      const onAddComment = vi.fn();
      const { result } = renderHook(() =>
        useMemoSection({ ...baseOptions(), newComment: '   ', onAddComment }),
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(onAddComment).not.toHaveBeenCalled();
    });

    it('selectedMemoTypeがgeneralの場合はlocalStorageへ書き込まないこと', async () => {
      const onAddComment = vi.fn().mockResolvedValue(10);
      const onNewCommentChange = vi.fn();
      const { result } = renderHook(() =>
        useMemoSection({
          ...baseOptions(),
          newComment: 'hello',
          onAddComment,
          onNewCommentChange,
        }),
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(onAddComment).toHaveBeenCalledWith('hello');
      expect(localStorage.getItem('memo-data-10')).toBeNull();
      expect(onNewCommentChange).toHaveBeenCalledWith('');
    });

    it('selectedMemoTypeがgeneral以外の場合はlocalStorageにmemoTypeを保存すること', async () => {
      const onAddComment = vi.fn().mockResolvedValue(20);
      const onNewCommentChange = vi.fn();
      const { result } = renderHook(() =>
        useMemoSection({
          ...baseOptions(),
          newComment: 'idea text',
          onAddComment,
          onNewCommentChange,
        }),
      );

      act(() => result.current.setSelectedMemoType('idea'));
      await act(async () => {
        await result.current.handleSubmit();
      });

      const saved = JSON.parse(localStorage.getItem('memo-data-20') ?? '{}');
      expect(saved).toEqual({ memoType: 'idea', isPinned: false });
      // Resets to 'general' after submit for the next entry.
      expect(result.current.selectedMemoType).toBe('general');
    });

    it('onAddCommentがIDを返さない場合はlocalStorageへ書き込まないこと', async () => {
      const onAddComment = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useMemoSection({ ...baseOptions(), newComment: 'idea text', onAddComment }),
      );

      act(() => result.current.setSelectedMemoType('idea'));
      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(localStorage.getItem('memo-data-undefined')).toBeNull();
    });
  });

  describe('handleTemplateSelect', () => {
    it('テンプレートのcontentKeyをonNewCommentChangeへ渡し、typeを設定し、テンプレパネルを閉じること', () => {
      const onNewCommentChange = vi.fn();
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), onNewCommentChange }));
      const template: MemoTemplate = {
        id: 'work-start',
        labelKey: 'memoTemplates.workStart.label',
        contentKey: 'memoTemplates.workStart.content',
        type: 'work-log',
        descriptionKey: 'memoTemplates.workStart.description',
      };

      act(() => result.current.setShowTemplates(true));
      act(() => result.current.handleTemplateSelect(template));

      expect(onNewCommentChange).toHaveBeenCalledWith('memoTemplates.workStart.content');
      expect(result.current.selectedMemoType).toBe('work-log');
      expect(result.current.showTemplates).toBe(false);
    });
  });

  describe('handleBulkAnalyze', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('未分析のメモそれぞれにanalyzeMemoの結果をlocalStorageへ保存すること', async () => {
      vi.useFakeTimers();
      const comments = [
        createMockComment({ id: 1, content: 'バグを修正する必要がある' }),
        createMockComment({ id: 2, content: 'ただのメモ' }),
      ];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      await act(async () => {
        const p = result.current.handleBulkAnalyze();
        await vi.advanceTimersByTimeAsync(3000);
        await p;
      });

      const saved1 = JSON.parse(localStorage.getItem('memo-data-1') ?? '{}');
      const saved2 = JSON.parse(localStorage.getItem('memo-data-2') ?? '{}');
      expect(saved1.analysis).toBeDefined();
      expect(saved1.showAnalysis).toBe(false);
      expect(saved2.analysis).toBeDefined();
    });

    it('既にanalysisを持つメモはスキップすること', async () => {
      vi.useFakeTimers();
      localStorage.setItem(
        'memo-data-1',
        JSON.stringify({ analysis: { summary: 'already analyzed' } }),
      );
      const comments = [createMockComment({ id: 1, content: '既に分析済み' })];
      const { result } = renderHook(() => useMemoSection({ ...baseOptions(), comments }));

      await act(async () => {
        const p = result.current.handleBulkAnalyze();
        await vi.advanceTimersByTimeAsync(2000);
        await p;
      });

      const saved = JSON.parse(localStorage.getItem('memo-data-1') ?? '{}');
      expect(saved.analysis.summary).toBe('already analyzed');
    });
  });

  describe('storageイベント', () => {
    it('windowのstorageイベントでstorageUpdateがインクリメントされること', () => {
      const { result } = renderHook(() => useMemoSection(baseOptions()));

      const before = result.current.storageUpdate;
      act(() => {
        window.dispatchEvent(new Event('storage'));
      });

      expect(result.current.storageUpdate).toBe(before + 1);
    });
  });

  describe('setHighlightedNoteId', () => {
    it('ハイライト対象のノートIDを設定・解除できること', () => {
      const { result } = renderHook(() => useMemoSection(baseOptions()));

      act(() => result.current.setHighlightedNoteId(5));
      expect(result.current.highlightedNoteId).toBe(5);

      act(() => result.current.setHighlightedNoteId(null));
      expect(result.current.highlightedNoteId).toBeNull();
    });
  });
});
