/**
 * useCommentsSection
 *
 * Custom hook encapsulating all interaction state and handlers for
 * CommentsSection. Separates UI logic from the component render tree.
 */

'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import type { Comment } from '@/types';
import { timeAgo } from './comment-types';
import type { NoteData, CommentLink } from './comment-types';

/**
 * Manages edit, reply, link, and scroll state for a comment thread.
 *
 * @param comments - Flat comment list from the parent / 親から受け取るフラットなコメント一覧
 * @param onUpdateComment - Callback to persist an edited comment / 編集内容を保存するコールバック
 * @param onAddComment - Callback to create a new comment or reply / コメント・返信を作成するコールバック
 * @param onCreateLink - Optional callback to link two comments / コメントをリンクするコールバック
 * @param onDeleteLink - Optional callback to remove a link / リンクを削除するコールバック
 * @returns State values, derived data, and handler callbacks
 */
export function useCommentsSection(
  comments: Comment[],
  onUpdateComment: (id: number, content: string) => Promise<void>,
  onAddComment: (content?: string, parentId?: number) => void,
  onCreateLink?: (from: number, to: number, label?: string) => Promise<void>,
  onDeleteLink?: (id: number) => Promise<void>,
) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [linkNote, setLinkNote] = useState<NoteData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const notes = useMemo(() => {
    const process = (c: Comment): NoteData => {
      const links: CommentLink[] = [];
      c.linksFrom?.forEach(
        (l) =>
          l.toComment &&
          links.push({
            id: l.id,
            direction: 'outgoing',
            label: l.label,
            linkedComment: l.toComment,
          }),
      );
      c.linksTo?.forEach(
        (l) =>
          l.fromComment &&
          links.push({
            id: l.id,
            direction: 'incoming',
            label: l.label,
            linkedComment: l.fromComment,
          }),
      );
      return {
        ...c,
        time: timeAgo(new Date(c.createdAt)),
        replies: c.replies?.map(process),
        links,
      };
    };
    return comments.filter((c) => !c.parentId).map(process);
  }, [comments]);

  const count = comments.filter((c) => !c.parentId).length;
  const replyCount = comments.filter((c) => c.parentId).length;
  const linkCount = comments.reduce(
    (sum, c) => sum + (c.linksFrom?.length || 0),
    0,
  );

  const handleEdit = useCallback((n: NoteData) => {
    setEditId(n.id);
    setEditText(n.content);
  }, []);

  const handleSave = useCallback(async () => {
    if (editId && editText.trim()) {
      await onUpdateComment(editId, editText);
      setEditId(null);
    }
  }, [editId, editText, onUpdateComment]);

  const handleCancel = useCallback(() => {
    setEditId(null);
    setEditText('');
  }, []);

  const handleReply = useCallback((n: NoteData) => {
    setReplyId(n.id);
    setReplyText('');
  }, []);

  const handleReplySubmit = useCallback(() => {
    if (replyId && replyText.trim()) {
      onAddComment(replyText, replyId);
      setReplyId(null);
    }
  }, [replyId, replyText, onAddComment]);

  const handleReplyCancel = useCallback(() => {
    setReplyId(null);
    setReplyText('');
  }, []);

  const handleLink = useCallback((n: NoteData) => setLinkNote(n), []);

  const handleLinkSelect = useCallback(
    async (to: number, label?: string) => {
      if (linkNote && onCreateLink) {
        await onCreateLink(linkNote.id, to, label);
        setLinkNote(null);
      }
    },
    [linkNote, onCreateLink],
  );

  const handleUnlink = useCallback(
    async (id: number) => {
      if (onDeleteLink) await onDeleteLink(id);
    },
    [onDeleteLink],
  );

  const handleScrollToNote = useCallback((id: number) => {
    if (!containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-note-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.querySelector<HTMLDivElement>('.group')?.classList.add(
        'ring-2',
        'ring-blue-400',
        'ring-offset-1',
      );
      // NOTE: Ring highlight auto-removes after 2s to avoid permanent styling.
      setTimeout(() => {
        el.querySelector<HTMLDivElement>('.group')?.classList.remove(
          'ring-2',
          'ring-blue-400',
          'ring-offset-1',
        );
      }, 2000);
    }
  }, []);

  return {
    notes,
    count,
    replyCount,
    linkCount,
    editId,
    editText,
    setEditText,
    replyId,
    replyText,
    setReplyText,
    linkNote,
    setLinkNote,
    containerRef,
    handleEdit,
    handleSave,
    handleCancel,
    handleReply,
    handleReplySubmit,
    handleReplyCancel,
    handleLink,
    handleLinkSelect,
    handleUnlink,
    handleScrollToNote,
  };
}
