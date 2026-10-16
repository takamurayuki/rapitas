/**
 * useCommentsSection.test.ts
 *
 * notes（返信除外・リンク合成）・件数集計（count/replyCount/linkCount）と、
 * 編集・返信・リンク・スクロールハイライトの各ハンドラの状態遷移を検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommentsSection } from '../useCommentsSection';
import type { Comment } from '@/types';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});

const createMockComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 1,
  taskId: 1,
  content: 'comment body',
  parentId: null,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  ...overrides,
});

describe('useCommentsSection', () => {
  const onUpdateComment = vi.fn();
  const onAddComment = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notes', () => {
    it('返信（parentIdあり）はトップレベルから除外されること', () => {
      const comments = [
        createMockComment({ id: 1, parentId: null }),
        createMockComment({ id: 2, parentId: 1 }),
      ];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(result.current.notes.map((n) => n.id)).toEqual([1]);
    });

    it('linksFromはoutgoingとして合成されること', () => {
      const comments = [
        createMockComment({
          id: 1,
          linksFrom: [
            {
              id: 100,
              fromCommentId: 1,
              toCommentId: 2,
              label: '関連',
              toComment: { id: 2, content: 'linked', taskId: 1, createdAt: '2026-01-01' },
              createdAt: '2026-01-01',
            },
          ],
        }),
      ];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(result.current.notes[0].links).toEqual([
        {
          id: 100,
          direction: 'outgoing',
          label: '関連',
          linkedComment: { id: 2, content: 'linked', taskId: 1, createdAt: '2026-01-01' },
        },
      ]);
    });

    it('linksToはincomingとして合成されること', () => {
      const comments = [
        createMockComment({
          id: 2,
          linksTo: [
            {
              id: 101,
              fromCommentId: 1,
              toCommentId: 2,
              label: '発展',
              fromComment: { id: 1, content: 'source', taskId: 1, createdAt: '2026-01-01' },
              createdAt: '2026-01-01',
            },
          ],
        }),
      ];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(result.current.notes[0].links).toEqual([
        {
          id: 101,
          direction: 'incoming',
          label: '発展',
          linkedComment: { id: 1, content: 'source', taskId: 1, createdAt: '2026-01-01' },
        },
      ]);
    });

    it('linksFrom/linksToの対象コメントが欠落している場合は無視されること', () => {
      const comments = [
        createMockComment({
          id: 1,
          linksFrom: [{ id: 100, fromCommentId: 1, toCommentId: 2, createdAt: '2026-01-01' }],
        }),
      ];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(result.current.notes[0].links).toEqual([]);
    });
  });

  describe('件数集計', () => {
    it('count/replyCount/linkCountを正しく集計すること', () => {
      const comments = [
        createMockComment({
          id: 1,
          parentId: null,
          linksFrom: [{ id: 100, fromCommentId: 1, toCommentId: 2, createdAt: '2026-01-01' }],
        }),
        createMockComment({ id: 2, parentId: null }),
        createMockComment({ id: 3, parentId: 1 }),
      ];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(result.current.count).toBe(2);
      expect(result.current.replyCount).toBe(1);
      expect(result.current.linkCount).toBe(1);
    });
  });

  describe('編集フロー', () => {
    it('handleEditでeditId/editTextを設定すること', () => {
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleEdit(result.current.notes[0]));

      expect(result.current.editId).toBe(1);
      expect(result.current.editText).toBe('original');
    });

    it('handleSaveはeditTextでonUpdateCommentを呼び、editIdをクリアすること', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() => useCommentsSection(comments, update, onAddComment));

      act(() => result.current.handleEdit(result.current.notes[0]));
      act(() => result.current.setEditText('updated'));
      await act(async () => {
        await result.current.handleSave();
      });

      expect(update).toHaveBeenCalledWith(1, 'updated');
      expect(result.current.editId).toBeNull();
    });

    it('editTextが空白のみの場合、handleSaveは何もしないこと', async () => {
      const update = vi.fn();
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() => useCommentsSection(comments, update, onAddComment));

      act(() => result.current.handleEdit(result.current.notes[0]));
      act(() => result.current.setEditText('   '));
      await act(async () => {
        await result.current.handleSave();
      });

      expect(update).not.toHaveBeenCalled();
    });

    it('handleCancelでeditId/editTextをリセットすること', () => {
      const comments = [createMockComment({ id: 1, content: 'original' })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleEdit(result.current.notes[0]));
      act(() => result.current.handleCancel());

      expect(result.current.editId).toBeNull();
      expect(result.current.editText).toBe('');
    });
  });

  describe('返信フロー', () => {
    it('handleReplyでreplyIdを設定すること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleReply(result.current.notes[0]));

      expect(result.current.replyId).toBe(1);
      expect(result.current.replyText).toBe('');
    });

    it('handleReplySubmitはonAddCommentを親IDつきで呼び、replyIdをクリアすること', () => {
      const add = vi.fn();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useCommentsSection(comments, onUpdateComment, add));

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.setReplyText('reply body'));
      act(() => result.current.handleReplySubmit());

      expect(add).toHaveBeenCalledWith('reply body', 1);
      expect(result.current.replyId).toBeNull();
    });

    it('replyTextが空白のみの場合、handleReplySubmitは何もしないこと', () => {
      const add = vi.fn();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() => useCommentsSection(comments, onUpdateComment, add));

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.setReplyText('   '));
      act(() => result.current.handleReplySubmit());

      expect(add).not.toHaveBeenCalled();
    });

    it('handleReplyCancelでreplyId/replyTextをリセットすること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleReply(result.current.notes[0]));
      act(() => result.current.handleReplyCancel());

      expect(result.current.replyId).toBeNull();
      expect(result.current.replyText).toBe('');
    });
  });

  describe('リンクフロー', () => {
    it('handleLinkでlinkNoteを設定すること', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleLink(result.current.notes[0]));

      expect(result.current.linkNote?.id).toBe(1);
    });

    it('handleLinkSelectはonCreateLinkを呼び、linkNoteをクリアすること', async () => {
      const onCreateLink = vi.fn().mockResolvedValue(undefined);
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment, onCreateLink),
      );

      act(() => result.current.handleLink(result.current.notes[0]));
      await act(async () => {
        await result.current.handleLinkSelect(2, '関連');
      });

      expect(onCreateLink).toHaveBeenCalledWith(1, 2, '関連');
      expect(result.current.linkNote).toBeNull();
    });

    it('onCreateLinkが未指定の場合、handleLinkSelectは何もしないこと', async () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      act(() => result.current.handleLink(result.current.notes[0]));
      await act(async () => {
        await result.current.handleLinkSelect(2);
      });

      // No callback registered means the guard short-circuits; linkNote stays set.
      expect(result.current.linkNote?.id).toBe(1);
    });

    it('linkNoteが未設定の場合、handleLinkSelectはonCreateLinkを呼ばないこと', async () => {
      const onCreateLink = vi.fn();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment, onCreateLink),
      );

      await act(async () => {
        await result.current.handleLinkSelect(2);
      });

      expect(onCreateLink).not.toHaveBeenCalled();
    });
  });

  describe('handleUnlink', () => {
    it('onDeleteLinkが指定されている場合はそれを呼ぶこと', async () => {
      const onDeleteLink = vi.fn().mockResolvedValue(undefined);
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment, undefined, onDeleteLink),
      );

      await act(async () => {
        await result.current.handleUnlink(100);
      });

      expect(onDeleteLink).toHaveBeenCalledWith(100);
    });

    it('onDeleteLinkが未指定の場合は例外を投げないこと', async () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      await expect(
        act(async () => {
          await result.current.handleUnlink(100);
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('handleScrollToNote', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('containerRefが未接続の場合は何もせず例外を投げないこと', () => {
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      expect(() => act(() => result.current.handleScrollToNote(1))).not.toThrow();
    });

    it('対象要素が見つかった場合はハイライトのクラスを付与し、2秒後に除去すること', () => {
      vi.useFakeTimers();
      const comments = [createMockComment({ id: 1 })];
      const { result } = renderHook(() =>
        useCommentsSection(comments, onUpdateComment, onAddComment),
      );

      const container = document.createElement('div');
      const noteEl = document.createElement('div');
      noteEl.setAttribute('data-note-id', '1');
      const groupEl = document.createElement('div');
      groupEl.classList.add('group');
      noteEl.appendChild(groupEl);
      container.appendChild(noteEl);
      // scrollIntoView isn't implemented in jsdom.
      noteEl.scrollIntoView = vi.fn();
      result.current.containerRef.current = container;

      act(() => result.current.handleScrollToNote(1));

      expect(groupEl.classList.contains('ring-2')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(groupEl.classList.contains('ring-2')).toBe(false);
    });
  });
});
