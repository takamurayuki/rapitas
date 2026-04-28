/**
 * useMemoSection
 *
 * Custom hook encapsulating all state and derived data logic for the MemoSection component.
 * Separates state management from JSX to keep the root component under the line limit.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Comment } from '@/types';
import { createLogger } from '@/lib/logger';
import type { MemoType, NoteData, MemoTemplate } from './types';
import { analyzeMemo, timeAgo } from './memo-utils';

const logger = createLogger('useMemoSection');

type UseMemoSectionOptions = {
  comments: Comment[];
  onAddComment: (content?: string, parentId?: number) => Promise<number | undefined> | void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onNewCommentChange: (v: string) => void;
  newComment: string;
};

/**
 * Manages all interactive state for the MemoSection feature.
 *
 * @param options - Dependencies injected from the parent component / 親コンポーネントから注入される依存関係
 * @returns State values and handlers consumed by MemoSection JSX / MemoSectionのJSXが利用するstate・ハンドラ
 */
export function useMemoSection({
  comments,
  onAddComment,
  onUpdateComment,
  onNewCommentChange,
  newComment,
}: UseMemoSectionOptions) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [highlightedNoteId, setHighlightedNoteId] = useState<number | null>(null);
  const [selectedMemoType, setSelectedMemoType] = useState<MemoType>('general');
  const [filterType, setFilterType] = useState<MemoType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [storageUpdate, setStorageUpdate] = useState(0);

  // NOTE: storage event is dispatched by NoteItem handlers to signal localStorage changes.
  useEffect(() => {
    const handleStorageChange = () => setStorageUpdate((prev) => prev + 1);
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const notes = useMemo(() => {
    const process = (c: Comment): NoteData => {
      let memoData: Record<string, unknown> = {};
      try {
        const saved = localStorage.getItem(`memo-data-${c.id}`);
        memoData = saved ? JSON.parse(saved) : {};
      } catch (_) {
        // Ignore malformed localStorage data
      }

      return {
        ...c,
        time: timeAgo(new Date(c.createdAt)),
        replies: c.replies?.map(process),
        memoType: (memoData.memoType as MemoType) || 'general',
        isPinned: (memoData.isPinned as boolean) || false,
      };
    };

    const processedNotes = comments.filter((c) => !c.parentId).map(process);

    const filtered =
      filterType === 'all'
        ? processedNotes
        : processedNotes.filter((note) => note.memoType === filterType);

    return filtered.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [comments, filterType, storageUpdate]);

  const typeStats = useMemo(() => {
    const stats: Record<MemoType, number> = {
      'work-log': 0,
      idea: 0,
      issue: 0,
      solution: 0,
      general: 0,
    };
    notes.forEach((note) => {
      const type = note.memoType || 'general';
      stats[type]++;
    });
    return stats;
  }, [notes]);

  const pinnedCount = notes.filter((note) => note.isPinned).length;

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

  const handleSubmit = useCallback(async () => {
    if (newComment.trim()) {
      const newCommentId = await onAddComment(newComment);

      if (newCommentId && selectedMemoType !== 'general') {
        const memoData = { memoType: selectedMemoType, isPinned: false };
        localStorage.setItem(`memo-data-${newCommentId}`, JSON.stringify(memoData));
        setStorageUpdate((prev) => prev + 1);
      }

      setSelectedMemoType('general');
      onNewCommentChange('');
    }
  }, [newComment, selectedMemoType, onAddComment, onNewCommentChange]);

  const handleTemplateSelect = useCallback(
    (template: MemoTemplate) => {
      onNewCommentChange(template.content);
      setSelectedMemoType(template.type);
      setShowTemplates(false);
    },
    [onNewCommentChange],
  );

  const handleBulkAnalyze = useCallback(async () => {
    const unanalyzedNotes = notes.filter((note) => {
      try {
        const saved = localStorage.getItem(`memo-data-${note.id}`);
        const data = saved ? JSON.parse(saved) : {};
        return !data.analysis;
      } catch {
        return true;
      }
    });

    for (const note of unanalyzedNotes) {
      try {
        const analysis = await analyzeMemo(note.content);
        const savedData = (() => {
          try {
            const saved = localStorage.getItem(`memo-data-${note.id}`);
            return saved ? JSON.parse(saved) : {};
          } catch {
            return {};
          }
        })();

        const newMemoData = { ...savedData, analysis, showAnalysis: false };
        localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(newMemoData));
      } catch (error) {
        logger.error(`Failed to analyze memo ${note.id}:`, error);
      }
    }

    setStorageUpdate((prev) => prev + 1);
  }, [notes]);

  return {
    // State
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
    // Derived
    notes,
    typeStats,
    pinnedCount,
    // Setters
    setEditText,
    setReplyText,
    setSelectedMemoType,
    setFilterType,
    setShowFilters,
    setShowTemplates,
    setShowTimeline,
    // Handlers
    handleEdit,
    handleSave,
    handleCancel,
    handleReply,
    handleReplySubmit,
    handleReplyCancel,
    handleSubmit,
    handleTemplateSelect,
    handleBulkAnalyze,
    // NOTE: exposed so parent can reset highlight after navigation
    setHighlightedNoteId,
  };
}
