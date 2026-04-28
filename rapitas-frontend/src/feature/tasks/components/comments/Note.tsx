'use client';
// Note

import { useState, memo } from 'react';
import {
  Trash2,
  Pencil,
  X,
  Link2,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { NoteData } from './comment-types';
import { LABEL_COLORS, DEFAULT_LINK_STYLE } from './comment-types';

type NoteProps = {
  note: NoteData;
  depth?: number;
  editId: number | null;
  editText: string;
  replyId: number | null;
  replyText: string;
  onEdit: (n: NoteData) => void;
  onEditText: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (id: number) => void;
  onReply: (n: NoteData) => void;
  onReplyText: (s: string) => void;
  onReplySubmit: () => void;
  onReplyCancel: () => void;
  onLink: (n: NoteData) => void;
  onUnlink: (id: number) => void;
  onScrollToNote: (id: number) => void;
};

/**
 * Displays a single comment with actions and optional nested replies.
 *
 * @param props - NoteProps
 */
export const Note = memo(function Note({
  note,
  depth = 0,
  editId,
  editText,
  replyId,
  replyText,
  onEdit,
  onEditText,
  onSave,
  onCancel,
  onDelete,
  onReply,
  onReplyText,
  onReplySubmit,
  onReplyCancel,
  onLink,
  onUnlink,
  onScrollToNote,
}: NoteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isEdit = editId === note.id;
  const isReply = replyId === note.id;
  const hasReplies = note.replies && note.replies.length > 0;
  const indent = Math.min(depth, 4);

  return (
    <div
      data-note-id={note.id}
      style={{ marginLeft: indent > 0 ? `${indent * 12}px` : 0 }}
      className={indent > 0 ? 'border-l-2 border-zinc-200 dark:border-zinc-700 pl-2.5 mt-1' : ''}
    >
      <div className="group rounded-lg bg-zinc-50/50 dark:bg-zinc-800/30 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 px-2.5 py-2 transition-colors">
        <div className="flex items-start gap-2">
          {/* Collapse toggle */}
          {hasReplies ? (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="shrink-0 p-0.5 mt-0.5 text-zinc-400 hover:text-blue-500 transition-colors rounded"
            >
              {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            {isEdit ? (
              <div className="space-y-1.5">
                <textarea
                  value={editText}
                  onChange={(e) => onEditText(e.target.value)}
                  className="w-full p-2 text-xs bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg resize-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
                  rows={3}
                  autoFocus
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={onCancel}
                    className="px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={onSave}
                    disabled={!editText.trim()}
                    className="px-2.5 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Content */}
                <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed [&>p]:m-0 [&_ul]:ml-3 [&_ol]:ml-3 [&_code]:bg-zinc-100 dark:[&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{ p: ({ children }) => <p>{children}</p> }}
                  >
                    {note.content}
                  </ReactMarkdown>
                </div>

                {/* Links */}
                {note.links && note.links.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {note.links.map((l) => {
                      const style = l.label
                        ? LABEL_COLORS[l.label] || DEFAULT_LINK_STYLE
                        : DEFAULT_LINK_STYLE;
                      return (
                        <button
                          key={l.id}
                          onClick={() => onScrollToNote(l.linkedComment.id)}
                          className={`group/l inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 ${style.bg} border ${style.border} rounded-md text-[10px] ${style.text} hover:opacity-80 transition-opacity cursor-pointer`}
                        >
                          {l.direction === 'outgoing' ? (
                            <ArrowRight className="w-2.5 h-2.5 shrink-0" />
                          ) : (
                            <ArrowLeft className="w-2.5 h-2.5 shrink-0" />
                          )}
                          {l.label && <span className="font-medium">{l.label}</span>}
                          <span className="max-w-[120px] truncate">{l.linkedComment.content}</span>
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnlink(l.id);
                            }}
                            className="opacity-0 group-hover/l:opacity-100 hover:text-red-500 ml-0.5 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Meta & Actions */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-zinc-400">{note.time}</span>
                  {hasReplies && (
                    <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                      <CornerDownRight className="w-2.5 h-2.5" />
                      {note.replies!.length}
                    </span>
                  )}
                  {note.links && note.links.length > 0 && (
                    <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                      <Link2 className="w-2.5 h-2.5" />
                      {note.links.length}
                    </span>
                  )}
                  <div className="flex-1" />
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onReply(note)}
                      className="p-1 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                      title="返信"
                    >
                      <CornerDownRight className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onLink(note)}
                      className="p-1 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                      title="リンク"
                    >
                      <Link2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onEdit(note)}
                      className="p-1 text-zinc-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded transition-colors"
                      title="編集"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDelete(note.id)}
                      className="p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Reply input */}
                {isReply && (
                  <div className="flex gap-1.5 mt-2 p-1.5 bg-white dark:bg-indigo-dark-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <input
                      value={replyText}
                      onChange={(e) => onReplyText(e.target.value)}
                      placeholder="返信を入力..."
                      className="flex-1 px-2 py-1 text-xs bg-transparent outline-none placeholder:text-zinc-400"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onReplySubmit())}
                    />
                    <button
                      onClick={onReplyCancel}
                      className="p-1 text-zinc-400 hover:text-zinc-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <button
                      onClick={onReplySubmit}
                      disabled={!replyText.trim()}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-[10px] disabled:opacity-50 transition-colors"
                    >
                      送信
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Nested replies */}
      {hasReplies &&
        !collapsed &&
        note.replies!.map((r) => (
          <Note
            key={r.id}
            note={r as NoteData}
            depth={depth + 1}
            editId={editId}
            editText={editText}
            replyId={replyId}
            replyText={replyText}
            onEdit={onEdit}
            onEditText={onEditText}
            onSave={onSave}
            onCancel={onCancel}
            onDelete={onDelete}
            onReply={onReply}
            onReplyText={onReplyText}
            onReplySubmit={onReplySubmit}
            onReplyCancel={onReplyCancel}
            onLink={onLink}
            onUnlink={onUnlink}
            onScrollToNote={onScrollToNote}
          />
        ))}
    </div>
  );
});
