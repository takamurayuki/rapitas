/**
 * MemoSection
 *
 * Root component for the task memo/comment feature. Composes MemoStatsBar,
 * MemoInputArea, TaskTimeline, NoteItem list, and TemplateSelector.
 * All state logic is delegated to the useMemoSection hook.
 */

'use client';

import { useRef } from 'react';
import { MessageSquare, History } from 'lucide-react';
import type { Props } from './types';
import { useMemoSection } from './useMemoSection';
import { MemoStatsBar } from './MemoStatsBar';
import { MemoInputArea } from './MemoInputArea';
import { NoteItem } from './NoteItem';
import { TaskTimeline } from './TaskTimeline';
import { TemplateSelector } from './TemplateSelector';

/**
 * Renders the full memo section for a task detail view.
 *
 * @param comments - Raw comment records from the API / APIから取得したコメント一覧
 * @param newComment - Controlled value for the new comment textarea / 新規コメントのテキスト
 * @param isAddingComment - Whether a comment submission is in-flight / コメント送信中フラグ
 * @param taskId - Numeric ID of the owning task / 親タスクのID
 * @param onNewCommentChange - Updates the newComment state in the parent / 親のnewComment更新コールバック
 * @param onAddComment - Submits a new comment / コメント追加コールバック
 * @param onUpdateComment - Saves an edited comment / コメント更新コールバック
 * @param onDeleteComment - Deletes a comment by ID / コメント削除コールバック
 */
export default function MemoSection({
  comments,
  newComment,
  isAddingComment,
  taskId,
  onNewCommentChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    editId,
    editText,
    replyId,
    replyText,
    highlightedNoteId,
    selectedMemoType,
    filterType,
    showFilters,
    showTemplates,
    showTimeline,
    storageUpdate,
    notes,
    typeStats,
    pinnedCount,
    setEditText,
    setReplyText,
    setSelectedMemoType,
    setFilterType,
    setShowFilters,
    setShowTemplates,
    setShowTimeline,
    handleEdit,
    handleSave,
    handleCancel,
    handleReply,
    handleReplySubmit,
    handleReplyCancel,
    handleSubmit,
    handleTemplateSelect,
    handleBulkAnalyze,
  } = useMemoSection({
    comments,
    onAddComment,
    onUpdateComment,
    onNewCommentChange,
    newComment,
  });

  return (
    <div ref={containerRef}>
      {notes.length > 0 && (
        <MemoStatsBar
          noteCount={notes.length}
          pinnedCount={pinnedCount}
          typeStats={typeStats}
          filterType={filterType}
          showFilters={showFilters}
          showTimeline={showTimeline}
          onSetFilterType={setFilterType}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onToggleTimeline={() => setShowTimeline(!showTimeline)}
          onBulkAnalyze={handleBulkAnalyze}
        />
      )}

      {/* Timeline View */}
      {showTimeline && (
        <div className="mb-3 p-3 bg-emerald-50/80 dark:bg-emerald-800/20 rounded-xl border border-emerald-200 dark:border-emerald-700">
          <div className="flex items-center gap-1.5 mb-3">
            <History className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              タスク履歴とメモの統合表示
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto pr-1 scrollbar-thin">
            <TaskTimeline taskId={taskId} notes={notes} />
          </div>
        </div>
      )}

      <MemoInputArea
        newComment={newComment}
        isAddingComment={isAddingComment}
        selectedMemoType={selectedMemoType}
        onNewCommentChange={onNewCommentChange}
        onSelectedMemoTypeChange={setSelectedMemoType}
        onSubmit={handleSubmit}
        onOpenTemplates={() => setShowTemplates(true)}
      />

      {/* Note List */}
      {notes.length > 0 ? (
        <div className="space-y-1 max-h-[400px] overflow-y-auto pr-0.5 scrollbar-thin">
          {notes.map((n) => (
            <NoteItem
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
              highlightedNoteId={highlightedNoteId}
              storageUpdate={storageUpdate}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-2">
            <MessageSquare className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="text-xs text-zinc-400">メモを追加してアイデアを記録</p>
        </div>
      )}

      {showTemplates && (
        <TemplateSelector
          selectedType={selectedMemoType}
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}
