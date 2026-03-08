'use client';

import { useMemo, useState, memo, useCallback, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Search,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  MessageSquare,
  Loader2,
  Filter,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  Clock,
  Pin,
  PinOff,
  FileText,
  Zap,
  ChevronLeft,
  History,
  TrendingUp,
  Calendar,
  User,
  GitCommit,
  Brain,
  Star,
  Sparkles,
  Eye,
  EyeOff,
  ArrowRight,
  Tag,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Comment, CommentSearchResult } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MemoSection');

// Types

type MemoType = 'work-log' | 'idea' | 'issue' | 'solution' | 'general';

type TaskActivity = {
  id: string;
  type: 'status_change' | 'assignment' | 'priority_change' | 'description_update' | 'label_change';
  action: string;
  details?: string;
  user?: string;
  timestamp: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
};

type MemoAnalysis = {
  summary: string;
  importance: 'low' | 'medium' | 'high';
  keywords: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  actionItems: string[];
  analyzedAt: string;
};

type NoteData = Comment & {
  time: string;
  replies?: NoteData[];
  memoType?: MemoType; // メモタイプ情報（ローカルに保存）
  isPinned?: boolean; // ピン留めフラグ（ローカルに保存）
  analysis?: MemoAnalysis; // AI分析結果（ローカルに保存）
  showAnalysis?: boolean; // 分析結果表示フラグ
};

// タスク履歴のモックデータ生成関数
const generateMockTaskActivities = (taskId: number): TaskActivity[] => [
  {
    id: `${taskId}-1`,
    type: 'status_change',
    action: 'ステータスを変更',
    details: 'TODO → 進行中',
    user: 'システム',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    changes: { status: { from: 'todo', to: 'in-progress' } },
  },
  {
    id: `${taskId}-2`,
    type: 'priority_change',
    action: '優先度を変更',
    details: '中 → 高',
    user: 'ユーザー',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    changes: { priority: { from: 'medium', to: 'high' } },
  },
  {
    id: `${taskId}-3`,
    type: 'assignment',
    action: 'タスクを作成',
    user: 'システム',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
];

// メモ分析のモック関数
const analyzeMemo = async (content: string): Promise<MemoAnalysis> => {
  // 実際の実装ではAI APIを呼び出す
  await new Promise(resolve => setTimeout(resolve, 1500)); // API呼び出しをシミュレート

  const length = content.length;
  const hasActionWords = /実装|修正|追加|削除|テスト|確認|検討|調査/.test(content);
  const hasIssueWords = /問題|エラー|バグ|課題|困る|難しい|失敗/.test(content);
  const hasPositiveWords = /完了|成功|良い|改善|進捗|解決/.test(content);

  // 重要度判定のロジック
  let importance: MemoAnalysis['importance'] = 'low';
  if (hasActionWords || hasIssueWords || length > 100) importance = 'medium';
  if (hasIssueWords && hasActionWords) importance = 'high';
  if (length > 200) importance = 'high';

  // 感情分析
  let sentiment: MemoAnalysis['sentiment'] = 'neutral';
  if (hasPositiveWords) sentiment = 'positive';
  if (hasIssueWords) sentiment = 'negative';

  // キーワード抽出（簡単な実装）
  const keywords: string[] = [];
  const keywordMatches = content.match(/\b[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+\b/g) || [];
  const commonWords = ['です', 'ます', 'した', 'する', 'ある', 'この', 'その', 'たり'];
  keywordMatches.forEach(word => {
    if (word.length >= 2 && !commonWords.includes(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  });

  // アクションアイテム抽出
  const actionItems: string[] = [];
  const actionMatches = content.match(/[・\-\*]\s*(.+)/g) || [];
  actionMatches.forEach(match => {
    const item = match.replace(/^[・\-\*]\s*/, '').trim();
    if (item) actionItems.push(item);
  });

  // 要約生成（簡単な実装）
  let summary = content.length > 50
    ? content.substring(0, 47) + '...'
    : content;

  if (hasActionWords) summary = `${summary} (アクション項目を含む)`;
  if (hasIssueWords) summary = `${summary} (課題を報告)`;

  return {
    summary,
    importance,
    keywords: keywords.slice(0, 5), // 上位5個まで
    sentiment,
    actionItems: actionItems.slice(0, 3), // 上位3個まで
    analyzedAt: new Date().toISOString(),
  };
};

type MemoTemplate = {
  id: string;
  label: string;
  content: string;
  type: MemoType;
  description: string;
};

const MEMO_TEMPLATES: MemoTemplate[] = [
  {
    id: 'work-start',
    label: '作業開始',
    content: '## 作業開始\n\n**目標:**\n- \n\n**作業内容:**\n- \n\n**注意事項:**\n- ',
    type: 'work-log',
    description: '作業開始時の記録用テンプレート',
  },
  {
    id: 'work-end',
    label: '作業終了',
    content: '## 作業終了\n\n**完了項目:**\n- \n\n**進捗状況:**\n- \n\n**次回作業:**\n- \n\n**気づき:**\n- ',
    type: 'work-log',
    description: '作業終了時の振り返り用テンプレート',
  },
  {
    id: 'issue-report',
    label: '課題報告',
    content: '## 課題報告\n\n**問題:**\n\n\n**発生条件:**\n- \n\n**影響範囲:**\n- \n\n**緊急度:** [高/中/低]\n\n**対応方針:**\n- ',
    type: 'issue',
    description: '課題や問題の報告用テンプレート',
  },
  {
    id: 'solution',
    label: '解決策',
    content: '## 解決策\n\n**対象課題:**\n\n\n**解決方法:**\n\n\n**実装手順:**\n1. \n2. \n3. \n\n**検証方法:**\n- \n\n**リスク:**\n- ',
    type: 'solution',
    description: '解決策の提案用テンプレート',
  },
  {
    id: 'idea',
    label: 'アイデア',
    content: '## アイデア\n\n**概要:**\n\n\n**メリット:**\n- \n\n**実現可能性:** [高/中/低]\n\n**必要リソース:**\n- \n\n**次のステップ:**\n- ',
    type: 'idea',
    description: '新しいアイデアの整理用テンプレート',
  },
  {
    id: 'meeting-notes',
    label: '会議メモ',
    content: '## 会議メモ\n\n**日時:** \n**参加者:** \n\n**議題:**\n- \n\n**決定事項:**\n- \n\n**アクションアイテム:**\n- [ ] \n- [ ] \n\n**次回予定:**\n',
    type: 'general',
    description: '会議や打ち合わせの記録用テンプレート',
  },
];

const MEMO_TYPE_CONFIG: Record<MemoType, {
  label: string;
  icon: React.ElementType;
  color: { bg: string; text: string; border: string; badge: string };
}> = {
  'work-log': {
    label: '作業ログ',
    icon: Clock,
    color: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200 dark:border-blue-800',
      badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    },
  },
  'idea': {
    label: 'アイデア',
    icon: Lightbulb,
    color: {
      bg: 'bg-amber-50 dark:bg-amber-900/20',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
    },
  },
  'issue': {
    label: '課題',
    icon: AlertTriangle,
    color: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      text: 'text-red-600 dark:text-red-400',
      border: 'border-red-200 dark:border-red-800',
      badge: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
    },
  },
  'solution': {
    label: '解決策',
    icon: CheckCircle,
    color: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      text: 'text-emerald-600 dark:text-emerald-400',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
    },
  },
  'general': {
    label: '一般',
    icon: MessageSquare,
    color: {
      bg: 'bg-zinc-50 dark:bg-zinc-800/50',
      text: 'text-zinc-600 dark:text-zinc-400',
      border: 'border-zinc-200 dark:border-zinc-700',
      badge: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    },
  },
};

type Props = {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  taskId: number;
  onNewCommentChange: (v: string) => void;
  onAddComment: (content?: string, parentId?: number) => Promise<number | undefined> | void;
  onUpdateComment: (id: number, content: string) => Promise<void>;
  onDeleteComment: (id: number) => void;
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



// Note Component
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
  highlightedNoteId,
  storageUpdate,
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
  highlightedNoteId: number | null;
  storageUpdate: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isEdit = editId === note.id;
  const isReply = replyId === note.id;
  const hasReplies = note.replies && note.replies.length > 0;
  const indent = Math.min(depth, 4);
  const isHighlighted = highlightedNoteId === note.id;

  // ローカルストレージからメモタイプとピン留め情報を取得
  const savedMemoData = useMemo(() => {
    try {
      const saved = localStorage.getItem(`memo-data-${note.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, [note.id, storageUpdate]);

  const memoType: MemoType = savedMemoData.memoType || 'general';
  const isPinned: boolean = savedMemoData.isPinned || false;
  const analysis: MemoAnalysis | undefined = savedMemoData.analysis;
  const showAnalysis: boolean = savedMemoData.showAnalysis || false;
  const typeConfig = MEMO_TYPE_CONFIG[memoType];
  const TypeIcon = typeConfig.icon;

  // 分析状態
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
          ${typeConfig.color.bg} border ${typeConfig.color.border}
          ${isHighlighted ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-900 animate-pulse' : ''}
          ${isPinned ? 'ring-1 ring-blue-300 dark:ring-blue-600' : ''}
          hover:border-zinc-300 dark:hover:border-zinc-600`}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle + Collapse toggle */}
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
                {/* Type Badge & Pin Status */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-medium ${typeConfig.color.badge}`}>
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
                    onToggle={() => {
                      const newMemoData = {
                        ...savedMemoData,
                        showAnalysis: !showAnalysis,
                      };
                      localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(newMemoData));
                      window.dispatchEvent(new Event('storage'));
                    }}
                  />
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
                  <div className="flex-1" />
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        const newPinnedState = !isPinned;
                        const newMemoData = { ...savedMemoData, isPinned: newPinnedState };
                        localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(newMemoData));
                        // コンポーネントを再レンダリングするためにダミーの状態更新をトリガー
                        window.dispatchEvent(new Event('storage'));
                      }}
                      className={`p-1 transition-colors rounded ${
                        isPinned
                          ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                      }`}
                      title={isPinned ? "ピン留め解除" : "ピン留め"}
                    >
                      {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={async () => {
                        setIsAnalyzing(true);
                        try {
                          const analysisResult = await analyzeMemo(note.content);
                          const newMemoData = {
                            ...savedMemoData,
                            analysis: analysisResult,
                            showAnalysis: true,
                          };
                          localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(newMemoData));
                          window.dispatchEvent(new Event('storage'));
                        } catch (error) {
                          logger.error('Analysis failed:', error);
                        } finally {
                          setIsAnalyzing(false);
                        }
                      }}
                      disabled={isAnalyzing}
                      className={`p-1 transition-colors rounded ${
                        analysis
                          ? 'text-purple-500 bg-purple-50 dark:bg-purple-900/30'
                          : 'text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/30'
                      } disabled:opacity-50`}
                      title="AI分析"
                    >
                      {isAnalyzing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Brain className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => onReply(note)}
                      className="p-1 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                      title="返信"
                    >
                      <CornerDownRight className="w-3 h-3" />
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


// Memo Analysis Display Component
const MemoAnalysisDisplay = memo(function MemoAnalysisDisplay({
  analysis,
  isVisible,
  onToggle,
}: {
  analysis: MemoAnalysis;
  isVisible: boolean;
  onToggle: () => void;
}) {
  const getImportanceColor = (importance: MemoAnalysis['importance']) => {
    switch (importance) {
      case 'high':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'medium':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
      case 'low':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
    }
  };

  const getSentimentIcon = (sentiment: MemoAnalysis['sentiment']) => {
    switch (sentiment) {
      case 'positive':
        return <span className="text-emerald-500">😊</span>;
      case 'negative':
        return <span className="text-red-500">😔</span>;
      case 'neutral':
        return <span className="text-zinc-400">😐</span>;
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
      >
        <Brain className="w-2.5 h-2.5" />
        AI分析結果
        {isVisible ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
      </button>

      {/* Analysis Results */}
      {isVisible && (
        <div className="p-2.5 bg-purple-50/50 dark:bg-purple-900/10 rounded-lg border border-purple-100 dark:border-purple-800/50 space-y-2">
          {/* Summary */}
          <div>
            <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
              要約
            </h4>
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400">
              {analysis.summary}
            </p>
          </div>

          {/* Importance & Sentiment */}
          <div className="flex items-center gap-2">
            <span
              className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full border ${getImportanceColor(
                analysis.importance
              )}`}
            >
              重要度: {analysis.importance === 'high' ? '高' : analysis.importance === 'medium' ? '中' : '低'}
            </span>
            <span className="flex items-center gap-1 text-[9px] text-zinc-500 dark:text-zinc-400">
              感情: {getSentimentIcon(analysis.sentiment)}
            </span>
          </div>

          {/* Keywords */}
          {analysis.keywords.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
                キーワード
              </h4>
              <div className="flex flex-wrap gap-1">
                {analysis.keywords.map((keyword, index) => (
                  <span
                    key={index}
                    className="px-1.5 py-0.5 text-[8px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Items */}
          {analysis.actionItems.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
                アクション項目
              </h4>
              <ul className="space-y-0.5">
                {analysis.actionItems.map((item, index) => (
                  <li
                    key={index}
                    className="text-[9px] text-zinc-600 dark:text-zinc-400 flex items-start gap-1"
                  >
                    <span className="text-purple-400 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Analysis timestamp */}
          <div className="text-[8px] text-zinc-400 text-right">
            分析日時: {timeAgo(new Date(analysis.analyzedAt))}
          </div>
        </div>
      )}
    </div>
  );
});

// Task Activity Item Component
const TaskActivityItem = memo(function TaskActivityItem({
  activity,
}: {
  activity: TaskActivity;
}) {
  const getActivityIcon = () => {
    switch (activity.type) {
      case 'status_change':
        return <TrendingUp className="w-3 h-3" />;
      case 'assignment':
        return <User className="w-3 h-3" />;
      case 'priority_change':
        return <ArrowRight className="w-3 h-3" />;
      case 'description_update':
        return <FileText className="w-3 h-3" />;
      case 'label_change':
        return <Tag className="w-3 h-3" />;
      default:
        return <GitCommit className="w-3 h-3" />;
    }
  };

  const getActivityColor = () => {
    switch (activity.type) {
      case 'status_change':
        return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'assignment':
        return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
      case 'priority_change':
        return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
      case 'description_update':
        return 'text-purple-500 bg-purple-50 dark:bg-purple-900/20';
      case 'label_change':
        return 'text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20';
      default:
        return 'text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50';
    }
  };

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className={`p-1 rounded-full ${getActivityColor()}`}>
        {getActivityIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {activity.action}
          </span>
          {activity.details && (
            <span className="text-zinc-500 dark:text-zinc-400">
              {activity.details}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
          <span>{timeAgo(new Date(activity.timestamp))}</span>
          {activity.user && (
            <>
              <span>•</span>
              <span>{activity.user}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// Task Timeline Component
const TaskTimeline = memo(function TaskTimeline({
  taskId,
  notes,
}: {
  taskId: number;
  notes: NoteData[];
}) {
  const activities = useMemo(() => generateMockTaskActivities(taskId), [taskId]);

  // メモと履歴を統合して時系列順に並べる
  const timelineItems = useMemo(() => {
    const items: Array<
      | { type: 'activity'; data: TaskActivity; timestamp: string }
      | { type: 'memo'; data: NoteData; timestamp: string }
    > = [];

    // タスク履歴を追加
    activities.forEach(activity => {
      items.push({
        type: 'activity',
        data: activity,
        timestamp: activity.timestamp,
      });
    });

    // メモを追加（トップレベルのみ、リプライは除外）
    notes.forEach(note => {
      items.push({
        type: 'memo',
        data: note,
        timestamp: note.createdAt,
      });
    });

    // 時系列でソート（新しい順）
    return items.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [activities, notes]);

  if (timelineItems.length === 0) {
    return (
      <div className="text-center py-4">
        <History className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
        <p className="text-[10px] text-zinc-400">タスクの履歴がありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {timelineItems.map((item, index) => (
        <div key={`${item.type}-${item.data.id || index}`} className="relative">
          {/* Timeline Line */}
          {index < timelineItems.length - 1 && (
            <div className="absolute left-3.5 top-8 w-0.5 h-6 bg-zinc-200 dark:bg-zinc-700" />
          )}

          {/* Content */}
          <div className="relative">
            {item.type === 'activity' ? (
              <TaskActivityItem activity={item.data as TaskActivity} />
            ) : (
              <div className="flex items-start gap-2.5 py-1.5">
                <div className={`p-1 rounded-full ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.bg}`}>
                  <MessageSquare className={`w-3 h-3 ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].color.badge}`}>
                      {MEMO_TYPE_CONFIG[(item.data as NoteData).memoType || 'general'].label}
                    </span>
                    {(item.data as NoteData).isPinned && (
                      <Pin className="w-2.5 h-2.5 text-blue-500" />
                    )}
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5 line-clamp-2">
                    {(item.data as NoteData).content}
                  </p>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {(item.data as NoteData).time}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});

// Template Selector Modal
const TemplateSelector = memo(function TemplateSelector({
  selectedType,
  onSelect,
  onClose,
}: {
  selectedType: MemoType;
  onSelect: (template: MemoTemplate) => void;
  onClose: () => void;
}) {
  const filteredTemplates = MEMO_TEMPLATES.filter(t => t.type === selectedType || selectedType === 'general');
  const typeConfig = MEMO_TYPE_CONFIG[selectedType];
  const TypeIcon = typeConfig.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                メモテンプレート選択
              </span>
              <div className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full ${typeConfig.color.badge}`}>
                <TypeIcon className="w-2.5 h-2.5" />
                {typeConfig.label}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Templates */}
        <div className="max-h-80 overflow-y-auto">
          {filteredTemplates.length > 0 ? (
            <div className="p-2 space-y-1">
              {filteredTemplates.map((template) => {
                const templateTypeConfig = MEMO_TYPE_CONFIG[template.type];
                const TemplateIcon = templateTypeConfig.icon;
                return (
                  <button
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className="w-full text-left p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-lg ${templateTypeConfig.color.bg}`}>
                        <TemplateIcon className={`w-3.5 h-3.5 ${templateTypeConfig.color.text}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {template.label}
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 transition-colors rotate-180" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center">
              <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {typeConfig.label}用のテンプレートがありません
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="w-full px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
          >
            手動で入力
          </button>
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
}: Props) {
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [highlightedNoteId, setHighlightedNoteId] = useState<number | null>(
    null,
  );
  const [selectedMemoType, setSelectedMemoType] = useState<MemoType>('general');
  const [filterType, setFilterType] = useState<MemoType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [storageUpdate, setStorageUpdate] = useState(0); // ローカルストレージ更新のトリガー
  const containerRef = useRef<HTMLDivElement>(null);

  // ローカルストレージの変更を監視
  useEffect(() => {
    const handleStorageChange = () => setStorageUpdate(prev => prev + 1);
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);


  const notes = useMemo(() => {
    const process = (c: Comment): NoteData => {
      // ローカルストレージからメモデータを取得
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

    // フィルタリング
    const filtered = filterType === 'all' ? processedNotes :
      processedNotes.filter((note) => note.memoType === filterType);

    // ソート: ピン留め優先、その後は作成日時順
    return filtered.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [comments, filterType, storageUpdate]);

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
  const handleSubmit = async () => {
    if (newComment.trim()) {
      // 新しいコメントを追加し、作成されたコメントのIDを取得
      const newCommentId = await onAddComment(newComment);

      // 作成されたコメントにメモタイプを設定
      if (newCommentId && selectedMemoType !== 'general') {
        const memoData = { memoType: selectedMemoType, isPinned: false };
        localStorage.setItem(`memo-data-${newCommentId}`, JSON.stringify(memoData));
        setStorageUpdate(prev => prev + 1);
      }

      // メモタイプを一般に戻す
      setSelectedMemoType('general');

      // 入力内容をクリア
      onNewCommentChange('');
    }
  };


  const handleTemplateSelect = useCallback((template: MemoTemplate) => {
    onNewCommentChange(template.content);
    setSelectedMemoType(template.type);
    setShowTemplates(false);
  }, [onNewCommentChange]);

  const typeStats = useMemo(() => {
    const stats: Record<MemoType, number> = {
      'work-log': 0,
      'idea': 0,
      'issue': 0,
      'solution': 0,
      'general': 0,
    };

    notes.forEach(note => {
      const type = note.memoType || 'general';
      stats[type]++;
    });

    return stats;
  }, [notes]);

  const pinnedCount = notes.filter(note => note.isPinned).length;

  return (
    <div ref={containerRef}>
      {/* Stats bar & Controls */}
      {notes.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] text-zinc-400 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {notes.length}件
            </span>
            {pinnedCount > 0 && (
              <span className="text-[10px] text-blue-500 flex items-center gap-1">
                <Pin className="w-2.5 h-2.5" />
                {pinnedCount}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                showTimeline
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                  : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <History className="w-3 h-3" />
              履歴統合表示
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                showFilters
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                  : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <Filter className="w-3 h-3" />
              フィルター
            </button>
          </div>

          {/* Type Filter Buttons */}
          {showFilters && (
            <div className="flex flex-wrap gap-1.5 px-1">
              <button
                onClick={() => setFilterType('all')}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-full border transition-colors ${
                  filterType === 'all'
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600'
                    : 'text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                全て ({Object.values(typeStats).reduce((a, b) => a + b, 0)})
              </button>
              {(Object.keys(MEMO_TYPE_CONFIG) as MemoType[]).map((type) => {
                const config = MEMO_TYPE_CONFIG[type];
                const Icon = config.icon;
                const count = typeStats[type];
                if (count === 0) return null;

                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-full border transition-colors ${
                      filterType === type
                        ? `${config.color.badge} border-current`
                        : 'text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {config.label} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick Actions */}
          {notes.length > 0 && (
            <div className="flex items-center gap-2 px-1 mt-2">
              <button
                onClick={async () => {
                  // 未分析のメモを一括分析
                  const unanalyzedNotes = notes.filter(note => {
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

                      const newMemoData = {
                        ...savedData,
                        analysis,
                        showAnalysis: false,
                      };
                      localStorage.setItem(`memo-data-${note.id}`, JSON.stringify(newMemoData));
                    } catch (error) {
                      logger.error(`Failed to analyze memo ${note.id}:`, error);
                    }
                  }

                  setStorageUpdate(prev => prev + 1);
                }}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
              >
                <Sparkles className="w-2.5 h-2.5" />
                全メモ一括分析
              </button>
            </div>
          )}
        </div>
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


      {/* Input */}
      <div className="space-y-2 mb-3">
        {/* Memo Type Selector & Template Button */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-zinc-500">種類:</span>
          <div className="flex gap-1">
            {(Object.keys(MEMO_TYPE_CONFIG) as MemoType[]).map((type) => {
              const config = MEMO_TYPE_CONFIG[type];
              const Icon = config.icon;
              const isSelected = selectedMemoType === type;

              return (
                <button
                  key={type}
                  onClick={() => setSelectedMemoType(type)}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    isSelected
                      ? `${config.color.badge} border-current`
                      : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300'
                  }`}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {config.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-full hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
            title="テンプレートを使用"
          >
            <Zap className="w-2.5 h-2.5" />
            テンプレート
          </button>
        </div>

        {/* Input Area */}
        <div className="flex gap-1.5">
          <div className="flex-1 space-y-1">
            <textarea
              value={newComment}
              onChange={(e) => onNewCommentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={`${MEMO_TYPE_CONFIG[selectedMemoType].label}メモを追加...（Shift+Enterで改行）`}
              className={`w-full px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-800 border rounded-lg outline-none focus:ring-1 placeholder:text-zinc-400 resize-none transition-colors ${
                selectedMemoType !== 'general'
                  ? `${MEMO_TYPE_CONFIG[selectedMemoType].color.border} focus:border-current focus:ring-current/30`
                  : 'border-zinc-200 dark:border-zinc-700 focus:border-blue-400 focus:ring-blue-400/30'
              }`}
              disabled={isAddingComment}
              rows={2}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || isAddingComment}
            className="self-stretch px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 transition-colors"
          >
            {isAddingComment ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
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
