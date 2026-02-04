"use client";

import {
  useMemo,
  useRef,
  useEffect,
  useState,
  memo,
  useCallback,
} from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Link2,
  Search,
  ChevronDown,
  Maximize2,
  Minimize2,
  Shuffle,
  Grid3X3,
  CornerDownRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Comment, CommentSearchResult } from "@/types";

// ============================================================================
// Types
// ============================================================================

type CommentLinkDisplay = {
  id: number;
  direction: "outgoing" | "incoming";
  label?: string | null;
  linkedComment: {
    id: number;
    content: string;
    taskId: number;
    createdAt: string;
  };
  createdAt: string;
};

type CommentWithMeta = Omit<Comment, "replies"> & {
  relativeTime: string;
  color: string;
  rotation: number;
  replies?: CommentWithMeta[];
  links?: CommentLinkDisplay[];
};

type CommentsSectionProps = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  isExpanded: boolean;
  taskId: number;
  onToggleExpand: () => void;
  onNewCommentChange: (value: string) => void;
  onAddComment: (content?: string, parentId?: number) => void;
  onUpdateComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number) => void;
  onCreateLink?: (
    fromCommentId: number,
    toCommentId: number,
    label?: string
  ) => Promise<void>;
  onDeleteLink?: (linkId: number) => Promise<void>;
};

// ============================================================================
// Constants & Utilities
// ============================================================================

// パステルカラーの付箋色
const STICKY_COLORS = [
  { bg: "bg-yellow-100", border: "border-yellow-200", hover: "hover:bg-yellow-50", text: "text-yellow-900", shadow: "shadow-yellow-200/50" },
  { bg: "bg-pink-100", border: "border-pink-200", hover: "hover:bg-pink-50", text: "text-pink-900", shadow: "shadow-pink-200/50" },
  { bg: "bg-blue-100", border: "border-blue-200", hover: "hover:bg-blue-50", text: "text-blue-900", shadow: "shadow-blue-200/50" },
  { bg: "bg-green-100", border: "border-green-200", hover: "hover:bg-green-50", text: "text-green-900", shadow: "shadow-green-200/50" },
  { bg: "bg-purple-100", border: "border-purple-200", hover: "hover:bg-purple-50", text: "text-purple-900", shadow: "shadow-purple-200/50" },
  { bg: "bg-orange-100", border: "border-orange-200", hover: "hover:bg-orange-50", text: "text-orange-900", shadow: "shadow-orange-200/50" },
];

const LINK_LABELS = [
  { value: "関連", icon: "↔" },
  { value: "発展", icon: "→" },
  { value: "対比", icon: "⇔" },
  { value: "補足", icon: "+" },
  { value: "根拠", icon: "∵" },
];

const getRelativeTime = (date: Date, now: Date): string => {
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "今";
  if (diffMins < 60) return `${diffMins}分`;
  if (diffHours < 24) return `${diffHours}時間`;
  if (diffDays < 7) return `${diffDays}日`;
  return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
};

// 安定したランダム値を生成（IDベース）
const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
};

// ============================================================================
// Sticky Note Component
// ============================================================================

const StickyNote = memo(function StickyNote({
  comment,
  isSelected,
  isLinkMode,
  isLinkSource,
  highlightedIds,
  onSelect,
  onEdit,
  onDelete,
  onStartLink,
  onCompleteLink,
  onReply,
  onHover,
}: {
  comment: CommentWithMeta;
  isSelected: boolean;
  isLinkMode: boolean;
  isLinkSource: boolean;
  highlightedIds: Set<number>;
  onSelect: (id: number | null) => void;
  onEdit: (comment: CommentWithMeta) => void;
  onDelete: (id: number) => void;
  onStartLink: (id: number) => void;
  onCompleteLink: (targetId: number) => void;
  onReply: (parentId: number) => void;
  onHover: (id: number | null) => void;
}) {
  const color = STICKY_COLORS[parseInt(comment.color) % STICKY_COLORS.length];
  const isHighlighted = highlightedIds.has(comment.id);
  const hasLinks = comment.links && comment.links.length > 0;
  const outgoingLinks = comment.links?.filter((l) => l.direction === "outgoing") || [];
  const incomingLinks = comment.links?.filter((l) => l.direction === "incoming") || [];

  return (
    <div
      className="group relative"
      style={{
        transform: `rotate(${comment.rotation}deg)`,
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      onMouseEnter={() => onHover(comment.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className={`
          relative p-4 rounded-sm cursor-pointer
          transition-all duration-300 ease-out
          ${color.bg} ${color.border} border
          ${isSelected ? "ring-2 ring-violet-400 ring-offset-2 z-20 scale-105" : ""}
          ${isHighlighted && !isSelected ? "ring-2 ring-blue-400 ring-offset-1 z-10 scale-102" : ""}
          ${isLinkSource ? "ring-2 ring-emerald-400 ring-offset-2 animate-pulse" : ""}
          ${isLinkMode && !isLinkSource ? "hover:ring-2 hover:ring-emerald-300 cursor-crosshair" : ""}
          shadow-md hover:shadow-lg ${color.shadow}
          hover:scale-105 hover:z-30
        `}
        style={{
          transform: isSelected ? "rotate(0deg)" : undefined,
          minHeight: "100px",
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (isLinkMode && !isLinkSource) {
            onCompleteLink(comment.id);
          } else {
            onSelect(isSelected ? null : comment.id);
          }
        }}
      >
        {/* 付箋の折り目エフェクト */}
        <div className="absolute top-0 right-0 w-6 h-6 overflow-hidden">
          <div
            className={`absolute -top-3 -right-3 w-6 h-6 ${color.bg} rotate-45 shadow-sm`}
            style={{ filter: "brightness(0.92)" }}
          />
        </div>

        {/* Content */}
        <div className={`${color.text} text-sm leading-relaxed mb-2`}>
          <div className="prose prose-sm max-w-none [&>p]:my-0 [&>ul]:my-1 [&>ol]:my-1 [&_code]:bg-white/50 [&_code]:px-1 [&_code]:rounded">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {comment.content.length > 150
                ? comment.content.slice(0, 150) + "..."
                : comment.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Time */}
        <div className="text-[10px] opacity-50 mt-2">
          {comment.relativeTime}
        </div>

        {/* Link indicators */}
        {hasLinks && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {outgoingLinks.slice(0, 3).map((link, i) => (
              <div
                key={link.id}
                className="w-2 h-2 rounded-full bg-blue-400 border border-white shadow-sm"
                title={`→ ${link.label || "リンク"}`}
              />
            ))}
            {incomingLinks.slice(0, 3).map((link, i) => (
              <div
                key={link.id}
                className="w-2 h-2 rounded-full bg-green-400 border border-white shadow-sm"
                title={`← ${link.label || "リンク"}`}
              />
            ))}
            {(outgoingLinks.length + incomingLinks.length) > 6 && (
              <div className="w-2 h-2 rounded-full bg-zinc-400 border border-white shadow-sm" />
            )}
          </div>
        )}

        {/* Reply indicator */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm border-2 border-white">
            {comment.replies.length}
          </div>
        )}

        {/* Actions */}
        <div
          className={`
            absolute top-1 right-6 flex gap-0.5
            transition-opacity duration-200
            ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
          `}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onReply(comment.id); }}
            className="p-1 rounded bg-white/80 hover:bg-white text-zinc-600 hover:text-violet-600 transition-colors shadow-sm"
            title="返信"
          >
            <CornerDownRight className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onStartLink(comment.id); }}
            className="p-1 rounded bg-white/80 hover:bg-white text-zinc-600 hover:text-blue-600 transition-colors shadow-sm"
            title="つなげる"
          >
            <Link2 className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(comment); }}
            className="p-1 rounded bg-white/80 hover:bg-white text-zinc-600 hover:text-amber-600 transition-colors shadow-sm"
            title="編集"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(comment.id); }}
            className="p-1 rounded bg-white/80 hover:bg-white text-zinc-600 hover:text-red-600 transition-colors shadow-sm"
            title="削除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {/* Link mode overlay */}
        {isLinkSource && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 rounded-sm">
            <span className="text-xs font-medium text-emerald-700 bg-white/90 px-2 py-1 rounded shadow-sm">
              接続先を選択...
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Link Search Modal
// ============================================================================

const LinkSearchModal = memo(function LinkSearchModal({
  sourceContent,
  excludeId,
  onSelect,
  onClose,
}: {
  sourceContent: string;
  excludeId: number;
  onSelect: (toCommentId: number, label?: string) => void;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const search = async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery) params.set("q", searchQuery);
        params.set("excludeId", String(excludeId));
        params.set("limit", "10");
        const res = await fetch(`/api/comments/search?${params}`);
        if (res.ok) setSearchResults(await res.json());
      } catch (e) { console.error(e); }
      finally { setIsSearching(false); }
    };
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, excludeId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden border border-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-b border-zinc-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-zinc-800">アイデアをつなげる</h3>
            <button onClick={onClose} className="p-1 hover:bg-white/50 rounded">
              <X className="w-5 h-5 text-zinc-500" />
            </button>
          </div>
          <div className="text-xs text-zinc-500 bg-white/50 p-2 rounded line-clamp-2">
            {sourceContent}
          </div>
        </div>

        <div className="p-3 border-b border-zinc-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="キーワードで探す..."
              className="w-full pl-9 pr-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="p-3 border-b border-zinc-100 bg-zinc-50/50">
          <p className="text-[10px] text-zinc-500 mb-2">関係性</p>
          <div className="flex flex-wrap gap-1.5">
            {LINK_LABELS.map(({ value, icon }) => (
              <button
                key={value}
                onClick={() => setSelectedLabel(selectedLabel === value ? "" : value)}
                className={`px-2.5 py-1 text-xs rounded-full transition-all ${
                  selectedLabel === value
                    ? "bg-blue-500 text-white"
                    : "bg-white border border-zinc-200 text-zinc-600 hover:border-blue-300"
                }`}
              >
                <span className="mr-1">{icon}</span>
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-48 overflow-y-auto">
          {isSearching ? (
            <div className="p-6 text-center text-zinc-400 text-sm">検索中...</div>
          ) : searchResults.length > 0 ? (
            <div className="p-2">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => onSelect(result.id, selectedLabel || undefined)}
                  className="w-full p-3 text-left rounded-lg hover:bg-zinc-50 transition-colors"
                >
                  <p className="text-sm text-zinc-700 line-clamp-2">{result.content}</p>
                  {result.task && (
                    <p className="text-[10px] text-zinc-400 mt-1">{result.task.title}</p>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-zinc-400 text-sm">
              {searchQuery ? "見つかりません" : "キーワードを入力"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

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
}: CommentsSectionProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linkSourceId, setLinkSourceId] = useState<number | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [editingComment, setEditingComment] = useState<CommentWithMeta | null>(null);
  const [editContent, setEditContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [shuffleKey, setShuffleKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Process comments
  const processedComments = useMemo(() => {
    const now = new Date();

    const process = (c: Comment, idx: number): CommentWithMeta => {
      const date = new Date(c.createdAt);
      const colorIndex = seededRandom(c.id + shuffleKey) * STICKY_COLORS.length;
      const rotation = (seededRandom(c.id * 2 + shuffleKey) - 0.5) * 6; // -3 to 3 degrees

      const links: CommentLinkDisplay[] = [];
      c.linksFrom?.forEach((link) => {
        if (link.toComment) {
          links.push({
            id: link.id, direction: "outgoing", label: link.label,
            linkedComment: link.toComment, createdAt: link.createdAt,
          });
        }
      });
      c.linksTo?.forEach((link) => {
        if (link.fromComment) {
          links.push({
            id: link.id, direction: "incoming", label: link.label,
            linkedComment: link.fromComment, createdAt: link.createdAt,
          });
        }
      });

      return {
        ...c,
        relativeTime: getRelativeTime(date, now),
        color: String(Math.floor(colorIndex)),
        rotation,
        replies: c.replies?.map((r, i) => process(r, i)),
        links,
      };
    };

    return comments.filter((c) => !c.parentId).map((c, i) => process(c, i));
  }, [comments, shuffleKey]);

  // Get linked IDs for highlighting
  const highlightedIds = useMemo(() => {
    const ids = new Set<number>();
    if (hoveredId) {
      const comment = processedComments.find((c) => c.id === hoveredId);
      comment?.links?.forEach((l) => ids.add(l.linkedComment.id));
    }
    return ids;
  }, [hoveredId, processedComments]);

  // Get source comment
  const sourceComment = useMemo(() => {
    return processedComments.find((c) => c.id === linkSourceId);
  }, [linkSourceId, processedComments]);

  const totalCount = comments.filter((c) => !c.parentId).length;
  const linkCount = comments.reduce((sum, c) => sum + (c.linksFrom?.length || 0), 0);

  // Handlers
  const handleStartLink = useCallback((id: number) => {
    setLinkSourceId(id);
    setShowLinkModal(true);
  }, []);

  const handleCompleteLink = useCallback(async (targetId: number, label?: string) => {
    if (!linkSourceId || !onCreateLink) return;
    await onCreateLink(linkSourceId, targetId, label);
    setLinkSourceId(null);
    setShowLinkModal(false);
  }, [linkSourceId, onCreateLink]);

  const handleCancelLink = useCallback(() => {
    setLinkSourceId(null);
    setShowLinkModal(false);
  }, []);

  const handleEdit = useCallback((comment: CommentWithMeta) => {
    setEditingComment(comment);
    setEditContent(comment.content);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingComment || !editContent.trim()) return;
    await onUpdateComment(editingComment.id, editContent);
    setEditingComment(null);
    setEditContent("");
  }, [editingComment, editContent, onUpdateComment]);

  const handleReply = useCallback((parentId: number) => {
    setReplyingTo(parentId);
    setReplyContent("");
  }, []);

  const handleSubmitReply = useCallback(() => {
    if (!replyingTo || !replyContent.trim()) return;
    onAddComment(replyContent, replyingTo);
    setReplyingTo(null);
    setReplyContent("");
  }, [replyingTo, replyContent, onAddComment]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (newComment.trim()) onAddComment(newComment);
    }
  };

  const containerClass = isFullscreen
    ? "fixed inset-0 z-50 bg-gradient-to-br from-amber-50 via-white to-rose-50"
    : "bg-gradient-to-br from-amber-50/50 via-white to-rose-50/50 rounded-2xl border border-zinc-200/80 shadow-sm";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 ${!isFullscreen ? "cursor-pointer hover:bg-white/50" : ""} transition-colors border-b border-zinc-100`}
        onClick={!isFullscreen ? onToggleExpand : undefined}
      >
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1">
            {STICKY_COLORS.slice(0, 4).map((c, i) => (
              <div key={i} className={`w-4 h-4 ${c.bg} rounded-sm border ${c.border} shadow-sm`} style={{ transform: `rotate(${(i - 1.5) * 8}deg)` }} />
            ))}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-zinc-800">思考ボード</h2>
              {totalCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-600 rounded-full">
                  {totalCount}
                </span>
              )}
              {linkCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-600 rounded-full flex items-center gap-0.5">
                  <Link2 className="w-2.5 h-2.5" />
                  {linkCount}
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-400">ペタペタ貼って、つなげて、発見する</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isExpanded && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setShuffleKey((k) => k + 1); }}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-white rounded-lg transition-colors"
                title="シャッフル"
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsFullscreen(!isFullscreen); }}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-white rounded-lg transition-colors"
                title={isFullscreen ? "縮小" : "拡大"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </>
          )}
          {!isFullscreen && (
            <ChevronDown className={`w-5 h-5 text-zinc-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`transition-all duration-300 ${isExpanded ? "opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
        {/* Input */}
        <div className="p-4 border-b border-zinc-100">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={newComment}
                onChange={(e) => onNewCommentChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="新しいアイデアを書く..."
                className="w-full px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-yellow-300 resize-none shadow-sm"
                rows={2}
                disabled={isAddingComment}
              />
            </div>
            <button
              onClick={() => newComment.trim() && onAddComment(newComment)}
              disabled={!newComment.trim() || isAddingComment}
              className="self-end px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium rounded-lg disabled:opacity-40 transition-colors shadow-sm flex items-center gap-1.5"
            >
              {isAddingComment ? (
                <div className="w-4 h-4 border-2 border-yellow-900/30 border-t-yellow-900 rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              貼る
            </button>
          </div>
        </div>

        {/* Board */}
        {processedComments.length > 0 ? (
          <div className={`p-6 ${isFullscreen ? "h-[calc(100vh-180px)] overflow-auto" : ""}`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-min">
              {processedComments.map((comment) => (
                <div key={comment.id}>
                  <StickyNote
                    comment={comment}
                    isSelected={selectedId === comment.id}
                    isLinkMode={linkSourceId !== null && !showLinkModal}
                    isLinkSource={linkSourceId === comment.id}
                    highlightedIds={highlightedIds}
                    onSelect={setSelectedId}
                    onEdit={handleEdit}
                    onDelete={onDeleteComment}
                    onStartLink={handleStartLink}
                    onCompleteLink={(id) => handleCompleteLink(id)}
                    onReply={handleReply}
                    onHover={setHoveredId}
                  />

                  {/* Replies */}
                  {comment.replies && comment.replies.length > 0 && selectedId === comment.id && (
                    <div className="mt-2 ml-4 space-y-2 border-l-2 border-violet-200 pl-3">
                      {comment.replies.map((reply) => (
                        <div
                          key={reply.id}
                          className="p-2 bg-white/80 rounded-lg border border-zinc-200 text-xs text-zinc-600 shadow-sm"
                        >
                          {reply.content}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply input */}
                  {replyingTo === comment.id && (
                    <div className="mt-2 p-2 bg-violet-50 rounded-lg border border-violet-200">
                      <textarea
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        placeholder="返信..."
                        className="w-full p-2 bg-white border border-violet-200 rounded text-sm outline-none resize-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-1 mt-2">
                        <button
                          onClick={() => setReplyingTo(null)}
                          className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700"
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={handleSubmitReply}
                          disabled={!replyContent.trim()}
                          className="px-3 py-1 bg-violet-500 text-white text-xs font-medium rounded disabled:opacity-50"
                        >
                          返信
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center">
            <div className="inline-flex items-center justify-center gap-2 mb-3">
              {STICKY_COLORS.slice(0, 3).map((c, i) => (
                <div
                  key={i}
                  className={`w-10 h-10 ${c.bg} rounded-sm border ${c.border} shadow-sm`}
                  style={{ transform: `rotate(${(i - 1) * 12}deg)` }}
                />
              ))}
            </div>
            <p className="text-zinc-500 text-sm font-medium">まだ何もありません</p>
            <p className="text-zinc-400 text-xs mt-1">アイデアを書いて貼ってみましょう</p>
          </div>
        )}
      </div>

      {/* Link Search Modal */}
      {showLinkModal && sourceComment && (
        <LinkSearchModal
          sourceContent={sourceComment.content}
          excludeId={sourceComment.id}
          onSelect={handleCompleteLink}
          onClose={handleCancelLink}
        />
      )}

      {/* Edit Modal */}
      {editingComment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setEditingComment(null)}>
          <div
            className={`w-full max-w-sm mx-4 p-4 ${STICKY_COLORS[parseInt(editingComment.color) % STICKY_COLORS.length].bg} rounded-lg shadow-2xl border border-white/50`}
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-3 bg-white/80 border border-white rounded-lg text-sm outline-none resize-none"
              rows={5}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setEditingComment(null)}
                className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editContent.trim()}
                className="px-4 py-1.5 bg-white text-zinc-800 text-sm font-medium rounded-lg shadow-sm disabled:opacity-50"
              >
                <Check className="w-4 h-4 inline mr-1" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to cancel link mode */}
      {linkSourceId && !showLinkModal && (
        <div className="fixed inset-0 z-40" onClick={handleCancelLink} />
      )}
    </div>
  );
}
