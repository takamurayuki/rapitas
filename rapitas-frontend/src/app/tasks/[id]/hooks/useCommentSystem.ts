import { useCallback } from 'react';
import type { Comment } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useCommentSystem');
const API_BASE = API_BASE_URL;

export interface UseCommentSystemParams {
  resolvedTaskId: string | null | undefined;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  newComment: string;
  setNewComment: (v: string) => void;
  setIsAddingComment: (v: boolean) => void;
}

export function useCommentSystem({
  resolvedTaskId,
  comments,
  setComments,
  newComment,
  setNewComment,
  setIsAddingComment,
}: UseCommentSystemParams) {
  /** Add a new comment (or reply). Returns the new comment ID or null. */
  const handleAddComment = useCallback(
    async (content?: string, parentId?: number): Promise<number | null> => {
      const commentContent = content || newComment;
      if (!commentContent.trim()) return null;

      try {
        setIsAddingComment(true);
        const res = await fetch(
          `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: commentContent, parentId }),
          },
        );

        if (res.ok) {
          const newCommentData = await res.json();

          // Re-fetch comments to update tree structure
          const commentsRes = await fetch(
            `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          );
          if (commentsRes.ok) {
            setComments(await commentsRes.json());
          }
          // Clear main comment input only when not a reply
          if (!content) {
            setNewComment('');
          }

          return newCommentData.id;
        }

        return null;
      } catch (err) {
        logger.error('Failed to add comment:', err);
        return null;
      } finally {
        setIsAddingComment(false);
      }
    },
    [newComment, resolvedTaskId, setComments, setNewComment, setIsAddingComment],
  );

  /** Update an existing comment's content */
  const handleUpdateComment = useCallback(
    async (commentId: number, content: string) => {
      try {
        const res = await fetch(`${API_BASE}/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (res.ok) {
          const updatedComment = await res.json();
          setComments((prev) =>
            prev.map((c) => (c.id === commentId ? updatedComment : c)),
          );
        }
      } catch (err) {
        logger.error('Failed to update comment:', err);
      }
    },
    [setComments],
  );

  /** Delete a comment by ID */
  const handleDeleteComment = useCallback(
    async (commentId: number) => {
      if (!confirm('このコメントを削除しますか?')) return;

      try {
        const res = await fetch(`${API_BASE}/comments/${commentId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setComments((prev) => prev.filter((c) => c.id !== commentId));
        }
      } catch (err) {
        logger.error('Failed to delete comment:', err);
      }
    },
    [setComments],
  );

  /** Create a link between two comments */
  const handleCreateCommentLink = useCallback(
    async (fromCommentId: number, toCommentId: number, label?: string) => {
      try {
        const res = await fetch(
          `${API_BASE}/comments/${fromCommentId}/links`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toCommentId, label }),
          },
        );
        if (res.ok) {
          const commentsRes = await fetch(
            `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          );
          if (commentsRes.ok) {
            setComments(await commentsRes.json());
          }
        }
      } catch (err) {
        logger.error('Failed to create comment link:', err);
      }
    },
    [resolvedTaskId, setComments],
  );

  /** Delete a comment link by link ID */
  const handleDeleteCommentLink = useCallback(
    async (linkId: number) => {
      try {
        const res = await fetch(`${API_BASE}/comment-links/${linkId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const commentsRes = await fetch(
            `${API_BASE}/tasks/${resolvedTaskId}/comments`,
          );
          if (commentsRes.ok) {
            setComments(await commentsRes.json());
          }
        }
      } catch (err) {
        logger.error('Failed to delete comment link:', err);
      }
    },
    [resolvedTaskId, setComments],
  );

  return {
    handleAddComment,
    handleUpdateComment,
    handleDeleteComment,
    handleCreateCommentLink,
    handleDeleteCommentLink,
  };
}
