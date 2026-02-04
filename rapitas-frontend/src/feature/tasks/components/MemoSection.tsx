"use client";

import { useMemo, useState, memo, useCallback, useEffect } from "react";
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
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Comment, CommentSearchResult } from "@/types";
import { API_BASE_URL } from "@/utils/api";

// Types
type CommentLink = {
  id: number;
  direction: "outgoing" | "incoming";
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
  if (m < 1) return "今";
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間`;
  return `${Math.floor(h / 24)}日`;
};

// Compact Note Component
const Note = memo(function Note({
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
}: {
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
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isEdit = editId === note.id;
  const isReply = replyId === note.id;
  const hasReplies = note.replies && note.replies.length > 0;
  const indent = Math.min(depth, 4);

  return (
    <div
      style={{ marginLeft: indent > 0 ? `${indent * 10}px` : 0 }}
      className={
        indent > 0 ? "border-l border-zinc-200 dark:border-zinc-700 pl-2" : ""
      }
    >
      <div className="group flex gap-1.5 py-1">
        {hasReplies ? (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 p-0.5 text-zinc-400 hover:text-zinc-600 mt-0.5"
          >
            {collapsed ? (
              <ChevronUp className="w-2.5 h-2.5" />
            ) : (
              <ChevronDown className="w-2.5 h-2.5" />
            )}
          </button>
        ) : (
          <div className="w-3.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          {isEdit ? (
            <div className="space-y-1">
              <textarea
                value={editText}
                onChange={(e) => onEditText(e.target.value)}
                className="w-full p-1.5 text-[11px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded resize-none outline-none focus:border-violet-400"
                rows={2}
                autoFocus
              />
              <div className="flex justify-end gap-1">
                <button
                  onClick={onCancel}
                  className="px-1.5 py-0.5 text-[9px] text-zinc-500"
                >
                  キャンセル
                </button>
                <button
                  onClick={onSave}
                  disabled={!editText.trim()}
                  className="px-1.5 py-0.5 text-[9px] bg-violet-600 text-white rounded disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-tight line-clamp-2 [&>p]:inline">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ p: ({ children }) => <span>{children}</span> }}
                >
                  {note.content}
                </ReactMarkdown>
              </div>

              {note.links && note.links.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {note.links.map((l) => (
                    <span
                      key={l.id}
                      className="group/l inline-flex items-center gap-0.5 px-1 py-0.5 bg-violet-50 dark:bg-violet-900/20 rounded text-[9px] text-violet-600 dark:text-violet-400"
                    >
                      {l.direction === "outgoing" ? "→" : "←"}
                      <span className="max-w-[60px] truncate">
                        {l.linkedComment.content}
                      </span>
                      <button
                        onClick={() => onUnlink(l.id)}
                        className="opacity-0 group-hover/l:opacity-100 hover:text-red-500"
                      >
                        <X className="w-2 h-2" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[9px] text-zinc-400">{note.time}</span>
                {hasReplies && (
                  <span className="text-[9px] text-zinc-400">
                    ·{note.replies!.length}
                  </span>
                )}
                <div className="flex-1" />
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onReply(note)}
                    className="p-0.5 text-zinc-400 hover:text-violet-500"
                    title="返信"
                  >
                    <CornerDownRight className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => onLink(note)}
                    className="p-0.5 text-zinc-400 hover:text-blue-500"
                    title="リンク"
                  >
                    <Link2 className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => onEdit(note)}
                    className="p-0.5 text-zinc-400 hover:text-amber-500"
                    title="編集"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => onDelete(note.id)}
                    className="p-0.5 text-zinc-400 hover:text-red-500"
                    title="削除"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>

              {isReply && (
                <div className="flex gap-1 mt-1">
                  <input
                    value={replyText}
                    onChange={(e) => onReplyText(e.target.value)}
                    placeholder="返信..."
                    className="flex-1 px-1.5 py-1 text-[10px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded outline-none focus:border-violet-400"
                    autoFocus
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), onReplySubmit())
                    }
                  />
                  <button onClick={onReplyCancel} className="p-1 text-zinc-400">
                    <X className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={onReplySubmit}
                    disabled={!replyText.trim()}
                    className="px-1.5 py-1 bg-violet-600 text-white rounded text-[9px] disabled:opacity-50"
                  >
                    送信
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CommentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const search = async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({
          excludeId: String(source.id),
          taskId: String(taskId),
          limit: "8",
        });
        if (q.trim()) p.set("q", q.trim());
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs mx-4 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
              リンク先
            </span>
            <button
              onClick={onClose}
              className="p-0.5 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="検索..."
              className="w-full pl-6 pr-2 py-1 text-[10px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded outline-none focus:border-violet-400"
              autoFocus
            />
          </div>
          <div className="flex gap-1 mt-1.5">
            {["関連", "発展", "補足"].map((l) => (
              <button
                key={l}
                onClick={() => setLabel(label === l ? "" : l)}
                className={`px-1.5 py-0.5 text-[9px] rounded-full border ${label === l ? "bg-violet-500 text-white border-violet-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-36 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-center">
              <Loader2 className="w-3 h-3 animate-spin mx-auto text-violet-500" />
            </div>
          ) : results.length > 0 ? (
            <div className="p-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.id, label || undefined)}
                  className="w-full p-1.5 text-left text-[10px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded line-clamp-1"
                >
                  {r.content}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3 text-center text-[10px] text-zinc-400">
              {q ? "なし" : "検索"}
            </div>
          )}
        </div>
      </div>
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
  const [editText, setEditText] = useState("");
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [linkNote, setLinkNote] = useState<NoteData | null>(null);

  const notes = useMemo(() => {
    const process = (c: Comment): NoteData => {
      const links: CommentLink[] = [];
      c.linksFrom?.forEach(
        (l) =>
          l.toComment &&
          links.push({
            id: l.id,
            direction: "outgoing",
            label: l.label,
            linkedComment: l.toComment,
          }),
      );
      c.linksTo?.forEach(
        (l) =>
          l.fromComment &&
          links.push({
            id: l.id,
            direction: "incoming",
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
    setEditText("");
  }, []);
  const handleReply = useCallback((n: NoteData) => {
    setReplyId(n.id);
    setReplyText("");
  }, []);
  const handleReplySubmit = useCallback(() => {
    if (replyId && replyText.trim()) {
      onAddComment(replyText, replyId);
      setReplyId(null);
    }
  }, [replyId, replyText, onAddComment]);
  const handleReplyCancel = useCallback(() => {
    setReplyId(null);
    setReplyText("");
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
  const handleSubmit = () => {
    if (newComment.trim()) onAddComment(newComment);
  };

  return (
    <div>
      {/* Input */}
      <div className="flex gap-1.5 mb-2">
        <input
          value={newComment}
          onChange={(e) => onNewCommentChange(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), handleSubmit())
          }
          placeholder="メモを追加..."
          className="flex-1 px-2 py-1.5 text-[11px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-violet-400 placeholder:text-zinc-400"
          disabled={isAddingComment}
        />
        <button
          onClick={handleSubmit}
          disabled={!newComment.trim() || isAddingComment}
          className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40 transition-colors"
        >
          {isAddingComment ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* Notes */}
      {notes.length > 0 ? (
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
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
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-3">
          <MessageSquare className="w-5 h-5 text-zinc-300 dark:text-zinc-600 mx-auto mb-1" />
          <p className="text-[9px] text-zinc-400">メモを追加してアイデアを記録</p>
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
