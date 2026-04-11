/**
 * CommentsSection
 *
 * Collapsible panel displaying threaded comments (メモ) for a task.
 * Delegates state management to useCommentsSection, rendering to Note and LinkModal.
 */

'use client';

import {
  Plus,
  Link2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import type { Comment } from '@/types';
import { Note } from './comments/Note';
import { LinkModal } from './comments/LinkModal';
import { useCommentsSection } from './comments/useCommentsSection';

type Props = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  isExpanded: boolean;
  taskId: number;
  onToggleExpand: () => void;
  onNewCommentChange: (v: string) => void;
  onAddComment: (content?: string, parentId?: number) => void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => void;
  onCreateLink?: (from: number, to: number, label?: string) => Promise<void>;
  onDeleteLink?: (id: number) => Promise<void>;
};

export default function CommentsSection({
  comments,
  newComment,
  isAddingComment,
  isExpanded,
  taskId,
  onToggleExpand,
  onNewCommentChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onCreateLink,
  onDeleteLink,
}: Props) {
  const {
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
  } = useCommentsSection(
    comments,
    onUpdateComment,
    onAddComment,
    onCreateLink,
    onDeleteLink,
  );

  const handleSubmit = () => {
    if (newComment.trim()) onAddComment(newComment);
  };

  return (
    <div
      ref={containerRef}
      className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full px-4 py-2.5 bg-linear-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-zinc-200 dark:border-zinc-700 hover:from-blue-100 hover:via-indigo-100 hover:to-purple-100 dark:hover:from-blue-950/50 dark:hover:via-indigo-950/50 dark:hover:to-purple-950/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
            <MessageSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <h2 className="font-bold text-xs text-zinc-900 dark:text-zinc-50">
              メモ
            </h2>
            <p className="text-[9px] text-zinc-500 dark:text-zinc-400">
              アイデア・気づき
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-[9px] font-medium">
              {count}
            </span>
            {replyCount > 0 && (
              <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-indigo-dark-800 text-zinc-500 rounded-full text-[9px]">
                +{replyCount}
              </span>
            )}
            {linkCount > 0 && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-[9px]">
                <Link2 className="w-2 h-2" />
                {linkCount}
              </span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          {/* Input */}
          <div className="flex gap-1.5 py-2.5">
            <textarea
              value={newComment}
              onChange={(e) => onNewCommentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="メモを追加（Shift+Enterで改行）"
              className="flex-1 px-2.5 py-2 text-xs bg-zinc-50 dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 placeholder:text-zinc-400 resize-none transition-colors"
              disabled={isAddingComment}
              rows={2}
            />
            <button
              onClick={handleSubmit}
              disabled={!newComment.trim() || isAddingComment}
              className="self-end px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 transition-colors"
            >
              {isAddingComment ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Notes */}
          {notes.length > 0 ? (
            <div className="space-y-1 max-h-[400px] overflow-y-auto pr-0.5 scrollbar-thin">
              {notes.map((n) => (
                <Note
                  key={n.id}
                  note={n}
                  editId={editId}
                  editText={editText}
                  replyId={replyId}
                  replyText={replyText}
                  onEdit={handleEdit}
                  onEditText={setEditText}
                  onSave={handleSave}
                  onCancel={handleCancel}
                  onDelete={onDeleteComment}
                  onReply={handleReply}
                  onReplyText={setReplyText}
                  onReplySubmit={handleReplySubmit}
                  onReplyCancel={handleReplyCancel}
                  onLink={handleLink}
                  onUnlink={handleUnlink}
                  onScrollToNote={handleScrollToNote}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-2">
                <MessageSquare className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="text-xs text-zinc-400">
                メモを追加してアイデアを記録
              </p>
              <p className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-0.5">
                メモ同士をリンクで結び付けられます
              </p>
            </div>
          )}
        </div>
      )}

      {linkNote && (
        <LinkModal
          source={linkNote}
          taskId={taskId}
          onSelect={handleLinkSelect}
          onClose={() => setLinkNote(null)}
        />
      )}
    </div>
  );
}
