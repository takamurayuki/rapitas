'use client';
// NoteItem

import { memo, useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Pin } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { createLogger } from '@/lib/logger';
import type { NoteData, MemoType, MemoAnalysis } from './types';
import { MEMO_TYPE_CONFIG } from './types';
import { analyzeMemo } from './memo-utils';
import { MemoAnalysisDisplay } from './MemoAnalysisDisplay';
import { NoteEditForm } from './NoteEditForm';
import { NoteReplyInput } from './NoteReplyInput';
import { NoteActionBar } from './NoteActionBar';

const logger = createLogger('NoteItem');

export type NoteItemProps = {
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
  highlightedNoteId: number | null;
  /** Incremented whenever localStorage memo-data changes; triggers re-read. */
  storageUpdate: number;
};

/**
 * Renders a memo note card with type badge, content, action buttons, and nested replies.
 *
 * @param note - The note data to display / 表示するメモデータ
 * @param depth - Nesting depth for indentation (max capped at 4) / インデントのネスト深度
 * @param storageUpdate - Counter incremented on storage changes to force re-computation / ストレージ変更カウンター
 */
export const NoteItem = memo(function NoteItem({
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
  highlightedNoteId,
  storageUpdate,
}: NoteItemProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const isEdit = editId === note.id;
  const isReply = replyId === note.id;
  const hasReplies = note.replies && note.replies.length > 0;
  const indent = Math.min(depth, 4);
  const isHighlighted = highlightedNoteId === note.id;

  const savedMemoData = useMemo(() => {
    try {
      const saved = localStorage.getItem(`memo-data-${note.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
    // NOTE: storageUpdate is intentionally included to force re-read on storage changes.
  }, [note.id, storageUpdate]);

  const memoType: MemoType = savedMemoData.memoType || 'general';
  const isPinned: boolean = savedMemoData.isPinned || false;
  const analysis: MemoAnalysis | undefined = savedMemoData.analysis;
  const showAnalysis: boolean = savedMemoData.showAnalysis || false;
  const typeConfig = MEMO_TYPE_CONFIG[memoType];
  const TypeIcon = typeConfig.icon;

  const persistMemoData = (patch: Record<string, unknown>) => {
    const updated = { ...savedMemoData, ...patch };
    localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
  };

  const handleTogglePin = () => persistMemoData({ isPinned: !isPinned });
  const handleToggleAnalysis = () => persistMemoData({ showAnalysis: !showAnalysis });

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const analysisResult = await analyzeMemo(note.content);
      persistMemoData({ analysis: analysisResult, showAnalysis: true });
    } catch (error) {
      logger.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div
      data-note-id={note.id}
      style={{ marginLeft: indent > 0 ? `${indent * 12}px` : 0 }}
      className={indent > 0 ? 'border-l-2 border-zinc-200 dark:border-zinc-700 pl-2.5 mt-1' : ''}
    >
      <div
        className={`group rounded-lg px-2.5 py-2 transition-all duration-200
          ${typeConfig.color.bg} border ${typeConfig.color.border}
          ${isHighlighted ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-900 animate-pulse' : ''}
          ${isPinned ? 'ring-1 ring-blue-300 dark:ring-blue-600' : ''}
          hover:border-zinc-300 dark:hover:border-zinc-600`}
      >
        <div className="flex items-start gap-2">
          {/* Collapse toggle for threaded replies */}
          <div className="flex flex-col items-center shrink-0 gap-0.5">
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
              <NoteEditForm
                editText={editText}
                onEditText={onEditText}
                onSave={onSave}
                onCancel={onCancel}
              />
            ) : (
              <>
                {/* Type Badge & Pin Status */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium ${typeConfig.color.badge}`}
                  >
                    <TypeIcon className="w-2.5 h-2.5" />
                    {typeConfig.label}
                  </span>
                  {isPinned && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-full font-medium">
                      <Pin className="w-2 h-2" />
                      ピン留め
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed [&>p]:m-0 [&_ul]:ml-3 [&_ol]:ml-3 [&_code]:bg-zinc-100 dark:[&_code]:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{ p: ({ children }) => <p>{children}</p> }}
                  >
                    {note.content}
                  </ReactMarkdown>
                </div>

                {/* AI Analysis */}
                {analysis && (
                  <MemoAnalysisDisplay
                    analysis={analysis}
                    isVisible={showAnalysis}
                    onToggle={handleToggleAnalysis}
                  />
                )}

                {/* Meta & Action Buttons */}
                <NoteActionBar
                  note={note}
                  isPinned={isPinned}
                  hasReplies={!!hasReplies}
                  isAnalyzing={isAnalyzing}
                  hasAnalysis={!!analysis}
                  onTogglePin={handleTogglePin}
                  onAnalyze={handleAnalyze}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />

                {/* Reply input */}
                {isReply && (
                  <NoteReplyInput
                    replyText={replyText}
                    onReplyText={onReplyText}
                    onReplySubmit={onReplySubmit}
                    onReplyCancel={onReplyCancel}
                  />
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
          <NoteItem
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
            highlightedNoteId={highlightedNoteId}
            storageUpdate={storageUpdate}
          />
        ))}
    </div>
  );
});
