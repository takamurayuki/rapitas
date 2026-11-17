'use client';

/**
 * MessageBubble
 *
 * One line of the task consult chat: the user's words (plain, with the 👌
 * received stamp once she took them in), her Markdown reply at chat density
 * with its action buttons and tier badge, or the pending note of an action.
 * Split out of CopilotChatComponents to keep that file under 300 lines.
 */
import { useTranslations } from 'next-intl';
import { Loader2, Play } from 'lucide-react';
import type { CopilotMessage } from './useCopilotChat';
import type { AnalysisData } from './copilot-chat-types';
import { MarkdownView } from '../markdown/MarkdownView';
import { ReceivedStamp } from '@/components/ui/chat';
import { AnalysisResultCard, TierBadge } from './CopilotChatComponents';
import { SaveToNoteButton } from './SaveToNoteButton';

/**
 * Single chat message bubble with optional action buttons.
 *
 * @param msg - the line to show / 表示する発言
 * @param onAction - runs one of the reply's action buttons / 返答の操作ボタンの実行
 * @param saveNote - when set, a text reply offers "ノートに保存" with this question and task / 指定時は文章の返答に「ノートに保存」を出す
 */
export function MessageBubble({
  msg,
  onAction,
  saveNote,
}: {
  msg: CopilotMessage;
  onAction?: (action: string, params?: Record<string, unknown>) => void;
  saveNote?: { question: string | null; taskId?: number };
}) {
  const tc = useTranslations('copilot.chatFeel');
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  // NOTE: system lines are the pending notes of an action or the
  // retrospective ("分析中..." etc.); they name the work under way, so they
  // keep their pill and spinner. The plain chat wait is the typing dots in
  // CopilotChatPanel.
  if (isSystem) {
    return (
      <div className="flex justify-center mb-3">
        <div className="flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          {msg.content}
        </div>
      </div>
    );
  }

  const isAnalysis = msg.actionData?.type === 'analyze' && msg.actionData.data;
  // Only ラピ's text replies; structured results (the analysis card) are not notes.
  // `content` can be missing on an action result, so it is not trusted to be a string.
  const showSave = !!saveNote && !isUser && !isAnalysis && (msg.content ?? '').trim() !== '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`relative max-w-[92%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'}`}
      >
        {isAnalysis ? (
          <AnalysisResultCard data={msg.actionData!.data as AnalysisData} onAction={onAction} />
        ) : isUser ? (
          // User input is plain text, not markdown.
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          // Assistant content (incl. the retrospective) is markdown — set at
          // chat density so headings and margins fit the bubble.
          <MarkdownView content={msg.content} density="chat" />
        )}
        {/* Taken in unless the send failed; history lines were taken in. */}
        {isUser && !msg.failed && <ReceivedStamp label={tc('received')} />}
        {!isUser && !isAnalysis && (
          <div className="mt-2 flex items-center justify-between">
            {((msg.actions && msg.actions.length > 0) || showSave) && (
              <div className="flex flex-wrap items-center gap-1">
                {msg.actions?.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => onAction?.(action.type, action.params)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                  >
                    <Play className="h-2.5 w-2.5" />
                    {action.label}
                  </button>
                ))}
                {showSave && (
                  <SaveToNoteButton
                    question={saveNote.question}
                    answer={msg.content}
                    taskId={saveNote.taskId}
                  />
                )}
              </div>
            )}
            <TierBadge tier={msg.tier} cached={msg.cached} model={msg.model} />
          </div>
        )}
      </div>
    </div>
  );
}
