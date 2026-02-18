'use client';

import { useMemo, useState, memo, useCallback, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Link2,
  Search,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  MessageSquare,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Network,
  GripVertical,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Comment, CommentSearchResult } from '@/types';
import { API_BASE_URL } from '@/utils/api';

// Types
type CommentLink = {
  id: number;
  direction: 'outgoing' | 'incoming';
  label?: string | null;
  linkedComment: { id: number; content: string; taskId: number };
};

type NoteData = Comment & {
  time: string;
  replies?: NoteData[];
  links?: CommentLink[];
};

type Props = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  taskId: number;
  onNewCommentChange: (v: string) => void;
  onAddComment: (content?: string, parentId?: number) => void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => void;
  onCreateLink?: (from: number, to: number, label?: string) => Promise<void>;
  onDeleteLink?: (id: number) => Promise<void>;
};

const timeAgo = (d: Date) => {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return '今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}日前`;
  return `${Math.floor(days / 30)}ヶ月前`;
};

const LABEL_COLORS: Record<
  string,
  { bg: string; text: string; border: string; line: string }
> = {
  関連: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    line: '#3b82f6',
  },
  発展: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    line: '#10b981',
  },
  補足: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    line: '#f59e0b',
  },
};

const DEFAULT_LINK_STYLE = {
  bg: 'bg-blue-50 dark:bg-blue-900/20',
  text: 'text-blue-600 dark:text-blue-400',
  border: 'border-blue-200 dark:border-blue-800',
  line: '#8b5cf6',
};

// Link Preview Popover
const LinkPreview = memo(function LinkPreview({
  link,
  onScrollToNote,
  onUnlink,
}: {
  link: CommentLink;
  onScrollToNote: (id: number) => void;
  onUnlink: (id: number) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const style = link.label
    ? LABEL_COLORS[link.label] || DEFAULT_LINK_STYLE
    : DEFAULT_LINK_STYLE;

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setShowPreview(true), 300);
  };
  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowPreview(false);
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => onScrollToNote(link.linkedComment.id)}
        className={`group/l inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 ${style.bg} border ${style.border} rounded-md text-[10px] ${style.text} hover:opacity-80 transition-all cursor-pointer hover:shadow-sm`}
      >
        {link.direction === 'outgoing' ? (
          <ArrowRight className="w-2.5 h-2.5 shrink-0" />
        ) : (
          <ArrowLeft className="w-2.5 h-2.5 shrink-0" />
        )}
        {link.label && <span className="font-medium">{link.label}</span>}
        <span className="max-w-[120px] truncate">
          {link.linkedComment.content}
        </span>
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnlink(link.id);
          }}
          className="opacity-0 group-hover/l:opacity-100 hover:text-red-500 ml-0.5 transition-opacity"
        >
          <X className="w-2.5 h-2.5" />
        </span>
      </button>

      {/* Preview Popover */}
      {showPreview && (
        <div className="absolute z-40 bottom-full left-0 mb-1.5 w-64 animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 p-2.5 overflow-hidden">
            <div className="flex items-center gap-1.5 mb-1.5">
              {link.direction === 'outgoing' ? (
                <ArrowRight className={`w-3 h-3 ${style.text}`} />
              ) : (
                <ArrowLeft className={`w-3 h-3 ${style.text}`} />
              )}
              {link.label && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${style.bg} ${style.text} ${style.border} border`}
                >
                  {link.label}
                </span>
              )}
              <span className="text-[10px] text-zinc-400">
                {link.direction === 'outgoing' ? 'リンク先' : 'リンク元'}
              </span>
            </div>
            <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed line-clamp-4 [&>p]:m-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{ p: ({ children }) => <p>{children}</p> }}
              >
                {link.linkedComment.content}
              </ReactMarkdown>
            </div>
            <button
              onClick={() => onScrollToNote(link.linkedComment.id)}
              className="mt-2 text-[10px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-0.5"
            >
              メモに移動
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// Note Component
const Note = memo(function Note({
  note,
  depth = 0,
  editId,
  editText,
  replyId,
  replyText,
  dragSourceId,
  dragOverId,
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
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  highlightedNoteId,
}: {
  note: NoteData;
  depth?: number;
  editId: number | null;
  editText: string;
  replyId: number | null;
  replyText: string;
  dragSourceId: number | null;
  dragOverId: number | null;
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
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (targetId: number) => void;
  highlightedNoteId: number | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isEdit = editId === note.id;
  const isReply = replyId === note.id;
  const hasReplies = note.replies && note.replies.length > 0;
  const indent = Math.min(depth, 4);
  const isDragSource = dragSourceId === note.id;
  const isDragOver = dragOverId === note.id && dragSourceId !== note.id;
  const isHighlighted = highlightedNoteId === note.id;

  return (
    <div
      data-note-id={note.id}
      style={{ marginLeft: indent > 0 ? `${indent * 12}px` : 0 }}
      className={
        indent > 0
          ? 'border-l-2 border-zinc-200 dark:border-zinc-700 pl-2.5 mt-1'
          : ''
      }
    >
      <div
        className={`group rounded-lg px-2.5 py-2 transition-all duration-200
          ${isDragSource ? 'opacity-50 scale-[0.98]' : ''}
          ${isDragOver ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-900 bg-blue-50/50 dark:bg-blue-900/20' : 'bg-zinc-50/50 dark:bg-zinc-800/30'}
          ${isHighlighted ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-900 animate-pulse' : ''}
          border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700`}
        draggable={!isEdit && !isReply}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'link';
          onDragStart(note.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'link';
          onDragOver(note.id);
        }}
        onDragLeave={() => onDragOver(-1)}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(note.id);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle + Collapse toggle */}
          <div className="flex flex-col items-center shrink-0 gap-0.5">
            {!isEdit && !isReply && (
              <div className="cursor-grab active:cursor-grabbing p-0.5 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100">
                <GripVertical className="w-3 h-3" />
              </div>
            )}
            {hasReplies ? (
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="p-0.5 text-zinc-400 hover:text-blue-500 transition-colors rounded"
              >
                {collapsed ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            ) : (
              <div className="w-4" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {isEdit ? (
              <div className="space-y-1.5">
                <textarea
                  value={editText}
                  onChange={(e) => onEditText(e.target.value)}
                  className="w-full p-2 text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg resize-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
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

                {/* Links with Preview */}
                {note.links && note.links.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {note.links.map((l) => (
                      <LinkPreview
                        key={l.id}
                        link={l}
                        onScrollToNote={onScrollToNote}
                        onUnlink={onUnlink}
                      />
                    ))}
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
                  <div className="flex gap-1.5 mt-2 p-1.5 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <input
                      value={replyText}
                      onChange={(e) => onReplyText(e.target.value)}
                      placeholder="返信を入力..."
                      className="flex-1 px-2 py-1 text-xs bg-transparent outline-none placeholder:text-zinc-400"
                      autoFocus
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        (e.preventDefault(), onReplySubmit())
                      }
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
            dragSourceId={dragSourceId}
            dragOverId={dragOverId}
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
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            highlightedNoteId={highlightedNoteId}
          />
        ))}
    </div>
  );
});

// Link Modal
const LinkModal = memo(function LinkModal({
  source,
  taskId,
  onSelect,
  onClose,
}: {
  source: NoteData;
  taskId: number;
  onSelect: (id: number, label?: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    const search = async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({
          excludeId: String(source.id),
          taskId: String(taskId),
          limit: '10',
        });
        if (q.trim()) p.set('q', q.trim());
        const res = await fetch(`${API_BASE_URL}/comments/search?${p}`);
        if (res.ok) setResults(await res.json());
      } catch {
      } finally {
        setLoading(false);
      }
    };
    const t = setTimeout(search, 200);
    return () => clearTimeout(t);
  }, [q, source.id, taskId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                メモをリンク
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Source preview */}
          <div className="px-2 py-1.5 mb-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md">
            <p className="text-[10px] text-blue-500 dark:text-blue-400 font-medium mb-0.5">
              リンク元
            </p>
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-1">
              {source.content}
            </p>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="メモを検索..."
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors"
              autoFocus
            />
          </div>

          {/* Label buttons */}
          <div className="flex gap-1.5 mt-2">
            {(['関連', '発展', '補足'] as const).map((l) => {
              const style = LABEL_COLORS[l];
              const isActive = label === l;
              return (
                <button
                  key={l}
                  onClick={() => setLabel(isActive ? '' : l)}
                  className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    isActive
                      ? `${style.bg} ${style.text} ${style.border} font-medium`
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-48 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-blue-500" />
              <p className="text-[10px] text-zinc-400 mt-1">検索中...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="p-1.5 space-y-0.5">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.id, label || undefined)}
                  className="w-full flex items-start gap-2 p-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors group"
                >
                  <MessageSquare className="w-3 h-3 text-zinc-400 group-hover:text-blue-500 shrink-0 mt-0.5 transition-colors" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                      {r.content}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {timeAgo(new Date(r.createdAt))}
                    </p>
                  </div>
                  <Link2 className="w-3 h-3 text-zinc-300 group-hover:text-blue-500 shrink-0 mt-0.5 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center">
              <Search className="w-5 h-5 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
              <p className="text-xs text-zinc-400">
                {q ? '一致するメモがありません' : 'リンク先のメモを検索'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Drag & Drop Link Label Selector (shown after drop)
const DragLinkLabelSelector = memo(function DragLinkLabelSelector({
  sourceContent,
  targetContent,
  onSelect,
  onCancel,
}: {
  sourceContent: string;
  targetContent: string;
  onSelect: (label?: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Link2 className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              リンクを作成
            </span>
          </div>

          {/* Preview connection */}
          <div className="space-y-1 mb-3">
            <div className="px-2 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md">
              <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-1">
                {sourceContent}
              </p>
            </div>
            <div className="flex justify-center">
              <ArrowRight className="w-4 h-4 text-blue-400" />
            </div>
            <div className="px-2 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md">
              <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-1">
                {targetContent}
              </p>
            </div>
          </div>

          {/* Label selection */}
          <p className="text-[10px] text-zinc-500 mb-1.5">
            ラベルを選択（任意）:
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(['関連', '発展', '補足'] as const).map((l) => {
              const style = LABEL_COLORS[l];
              return (
                <button
                  key={l}
                  onClick={() => onSelect(l)}
                  className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${style.bg} ${style.text} ${style.border} hover:opacity-80`}
                >
                  {l}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={onCancel}
              className="flex-1 px-2 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => onSelect()}
              className="flex-1 px-2 py-1.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              ラベルなしで作成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// Relationship Map View
const RelationshipMap = memo(function RelationshipMap({
  notes,
  onScrollToNote,
}: {
  notes: NoteData[];
  onScrollToNote: (id: number) => void;
}) {
  // Collect all links from all notes (including replies)
  const allLinks = useMemo(() => {
    const links: {
      from: number;
      to: number;
      fromContent: string;
      toContent: string;
      label?: string | null;
    }[] = [];
    const collectLinks = (n: NoteData) => {
      n.links?.forEach((l) => {
        if (l.direction === 'outgoing') {
          links.push({
            from: n.id,
            to: l.linkedComment.id,
            fromContent: n.content,
            toContent: l.linkedComment.content,
            label: l.label,
          });
        }
      });
      n.replies?.forEach((r) => collectLinks(r as NoteData));
    };
    notes.forEach(collectLinks);
    return links;
  }, [notes]);

  // Collect all unique note ids that participate in links
  const linkedNoteIds = useMemo(() => {
    const ids = new Set<number>();
    allLinks.forEach((l) => {
      ids.add(l.from);
      ids.add(l.to);
    });
    return ids;
  }, [allLinks]);

  // Build a map of all notes by id
  const noteById = useMemo(() => {
    const map = new Map<number, { id: number; content: string }>();
    const collect = (n: NoteData) => {
      map.set(n.id, { id: n.id, content: n.content });
      n.replies?.forEach((r) => collect(r as NoteData));
    };
    notes.forEach(collect);
    return map;
  }, [notes]);

  if (allLinks.length === 0) {
    return (
      <div className="text-center py-4">
        <Network className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
        <p className="text-[10px] text-zinc-400">リンクがありません</p>
        <p className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-0.5">
          メモ同士をドラッグ&ドロップまたはリンクボタンで結び付けましょう
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {allLinks.map((link, i) => {
        const style = link.label
          ? LABEL_COLORS[link.label] || DEFAULT_LINK_STYLE
          : DEFAULT_LINK_STYLE;
        const fromNote = noteById.get(link.from);
        const toNote = noteById.get(link.to);
        return (
          <div
            key={i}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <button
              onClick={() => onScrollToNote(link.from)}
              className="flex-1 min-w-0 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <p className="text-[10px] text-zinc-700 dark:text-zinc-300 truncate">
                {fromNote?.content || link.fromContent}
              </p>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <div
                className={`w-4 h-0.5 ${link.label ? '' : 'bg-blue-300 dark:bg-blue-600'}`}
                style={link.label ? { backgroundColor: style.line } : undefined}
              />
              {link.label && (
                <span
                  className={`text-[9px] px-1 py-0.5 rounded-full ${style.bg} ${style.text} ${style.border} border font-medium`}
                >
                  {link.label}
                </span>
              )}
              <ArrowRight className="w-3 h-3 text-blue-400 shrink-0" />
            </div>
            <button
              onClick={() => onScrollToNote(link.to)}
              className="flex-1 min-w-0 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <p className="text-[10px] text-zinc-700 dark:text-zinc-300 truncate">
                {toNote?.content || link.toContent}
              </p>
            </button>
          </div>
        );
      })}
    </div>
  );
});

// Main
export default function MemoSection({
  comments,
  newComment,
  isAddingComment,
  taskId,
  onNewCommentChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onCreateLink,
  onDeleteLink,
}: Props) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [linkNote, setLinkNote] = useState<NoteData | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [highlightedNoteId, setHighlightedNoteId] = useState<number | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag & Drop state
  const [dragSourceId, setDragSourceId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dragLinkPending, setDragLinkPending] = useState<{
    sourceId: number;
    targetId: number;
    sourceContent: string;
    targetContent: string;
  } | null>(null);

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

  // Build noteById map for drag & drop
  const noteById = useMemo(() => {
    const map = new Map<number, NoteData>();
    const collect = (n: NoteData) => {
      map.set(n.id, n);
      n.replies?.forEach((r) => collect(r as NoteData));
    };
    notes.forEach(collect);
    return map;
  }, [notes]);

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
      setHighlightedNoteId(id);
      setTimeout(() => setHighlightedNoteId(null), 2000);
    }
  }, []);
  const handleSubmit = () => {
    if (newComment.trim()) onAddComment(newComment);
  };

  // Drag & Drop handlers
  const handleDragStart = useCallback((id: number) => setDragSourceId(id), []);
  const handleDragOver = useCallback((id: number) => setDragOverId(id), []);
  const handleDragEnd = useCallback(() => {
    setDragSourceId(null);
    setDragOverId(null);
  }, []);
  const handleDrop = useCallback(
    (targetId: number) => {
      if (dragSourceId && dragSourceId !== targetId) {
        const sourceNote = noteById.get(dragSourceId);
        const targetNote = noteById.get(targetId);
        if (sourceNote && targetNote) {
          setDragLinkPending({
            sourceId: dragSourceId,
            targetId,
            sourceContent: sourceNote.content,
            targetContent: targetNote.content,
          });
        }
      }
      setDragSourceId(null);
      setDragOverId(null);
    },
    [dragSourceId, noteById],
  );

  const handleDragLinkConfirm = useCallback(
    async (label?: string) => {
      if (dragLinkPending && onCreateLink) {
        await onCreateLink(
          dragLinkPending.sourceId,
          dragLinkPending.targetId,
          label,
        );
      }
      setDragLinkPending(null);
    },
    [dragLinkPending, onCreateLink],
  );

  const linkCount = notes.reduce((sum, n) => {
    const countLinks = (note: NoteData): number => {
      let c = note.links?.length || 0;
      note.replies?.forEach((r) => (c += countLinks(r as NoteData)));
      return c;
    };
    return sum + countLinks(n);
  }, 0);

  return (
    <div ref={containerRef}>
      {/* Stats bar & Map toggle */}
      {(notes.length > 0 || linkCount > 0) && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-[10px] text-zinc-400 flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {notes.length}件
          </span>
          {linkCount > 0 && (
            <span className="text-[10px] text-blue-400 flex items-center gap-1">
              <Link2 className="w-3 h-3" />
              {linkCount}件のリンク
            </span>
          )}
          <div className="flex-1" />
          {linkCount > 0 && (
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                showMap
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                  : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <Network className="w-3 h-3" />
              関連マップ
            </button>
          )}
        </div>
      )}

      {/* Relationship Map */}
      {showMap && (
        <div className="mb-3 p-2.5 bg-zinc-50/80 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-1.5 mb-2">
            <Network className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
              メモの関連マップ
            </span>
          </div>
          <RelationshipMap notes={notes} onScrollToNote={handleScrollToNote} />
        </div>
      )}

      {/* Drag hint */}
      {dragSourceId && (
        <div className="mb-2 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-center">
          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium flex items-center justify-center gap-1">
            <Link2 className="w-3 h-3" />
            リンク先のメモにドロップしてください
          </p>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-1.5 mb-3">
        <textarea
          value={newComment}
          onChange={(e) => onNewCommentChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="メモを追加...（Shift+Enterで改行）"
          className="flex-1 px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 placeholder:text-zinc-400 resize-none transition-colors"
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
              dragSourceId={dragSourceId}
              dragOverId={dragOverId}
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
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              highlightedNoteId={highlightedNoteId}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-2">
            <MessageSquare className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="text-xs text-zinc-400">メモを追加してアイデアを記録</p>
          <p className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-0.5">
            メモ同士をドラッグ&ドロップまたはリンクボタンで結び付けられます
          </p>
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

      {dragLinkPending && (
        <DragLinkLabelSelector
          sourceContent={dragLinkPending.sourceContent}
          targetContent={dragLinkPending.targetContent}
          onSelect={handleDragLinkConfirm}
          onCancel={() => setDragLinkPending(null)}
        />
      )}
    </div>
  );
}
