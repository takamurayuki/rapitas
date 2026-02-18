'use client';

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Send,
  Terminal,
  Circle,
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import type { AIAgentConfig, ExecutionStatus, ExecutionResult } from '@/types';
import { ModelSelector } from './ModelSelector';
import { useExecutionPolling } from '../hooks/useExecutionStream';

type Props = {
  taskId: number;
  agents: AIAgentConfig[];
  selectedAgentId: number | null;
  onAgentChange: (agentId: number) => void;
  isExecuting: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  onExecute: (options?: {
    instruction?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  onStopExecution?: () => void;
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    output?: string;
    status: string;
  } | null>;
  optimizedPrompt?: string | null;
  useTaskAnalysis?: boolean;
};

type LogLine = {
  id: string;
  type: 'user' | 'agent' | 'system' | 'error' | 'question' | 'tool';
  text: string;
  ts: number;
};

// ターミナルの最大行数（メモリリーク防止）
const MAX_TERMINAL_LINES = 1000;

function classifyLine(line: string): LogLine['type'] {
  if (line.startsWith('[Tool:') || line.startsWith('[ツール:')) return 'tool';
  if (
    line.startsWith('[エラー]') ||
    line.startsWith('[Error]') ||
    line.startsWith('[失敗]')
  )
    return 'error';
  if (
    line.startsWith('[Question]') ||
    line.startsWith('[質問]') ||
    line.includes('waitingForInput')
  )
    return 'question';
  if (line.startsWith('[System') || line.startsWith('[システム'))
    return 'system';
  return 'agent';
}

function lineColor(type: LogLine['type']): string {
  switch (type) {
    case 'user':
      return 'text-violet-400';
    case 'tool':
      return 'text-cyan-400';
    case 'error':
      return 'text-red-400';
    case 'question':
      return 'text-amber-400';
    case 'system':
      return 'text-zinc-500';
    default:
      return 'text-zinc-300';
  }
}

const TerminalLine = memo(function TerminalLine({ line }: { line: LogLine }) {
  return (
    <div
      className={`px-3 py-0.5 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all ${lineColor(line.type)}`}
    >
      {line.type === 'user' && (
        <span className="text-green-400 select-none">❯ </span>
      )}
      {line.text}
    </div>
  );
});

const StatusDot = memo(function StatusDot({
  status,
  waitingForInput,
}: {
  status: string;
  waitingForInput?: boolean;
}) {
  if (waitingForInput)
    return <HelpCircle className="w-3 h-3 text-amber-400 animate-pulse" />;
  switch (status) {
    case 'running':
      return <Loader2 className="w-3 h-3 text-green-400 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-3 h-3 text-green-400" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case 'cancelled':
      return <Circle className="w-3 h-3 text-yellow-400" />;
    default:
      return <Terminal className="w-3 h-3 text-zinc-500" />;
  }
});

export const TerminalPanel = memo(function TerminalPanel({
  taskId,
  agents,
  selectedAgentId,
  onAgentChange,
  isExecuting,
  executionStatus,
  executionResult,
  onExecute,
  onReset,
  onStopExecution,
  onRestoreExecutionState,
  optimizedPrompt,
  useTaskAnalysis,
}: Props) {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevLogsRef = useRef<string[]>([]);
  const lineIdCounter = useRef(0);

  // Polling
  const polling = useExecutionPolling(taskId);
  const isRunning =
    polling.isRunning || executionStatus === 'running' || isExecuting;
  const isWaiting = polling.waitingForInput;
  const question = polling.question;

  // Convert polling logs to lines
  useEffect(() => {
    const currentLogs = polling.logs;
    if (currentLogs.length <= prevLogsRef.current.length) return;

    const newLogs = currentLogs.slice(prevLogsRef.current.length);
    prevLogsRef.current = currentLogs;

    const newLines: LogLine[] = newLogs
      .filter(
        (l) => l.trim() && l.trim() !== 'null' && l.trim() !== 'undefined',
      )
      .map((text) => ({
        id: `log-${lineIdCounter.current++}`,
        type: classifyLine(text),
        text,
        ts: Date.now(),
      }));

    if (newLines.length > 0) {
      setLines((prev) => {
        const combined = [...prev, ...newLines];
        return combined.length > MAX_TERMINAL_LINES
          ? combined.slice(-MAX_TERMINAL_LINES)
          : combined;
      });
    }
  }, [polling.logs]);

  // Show question as a line
  useEffect(() => {
    if (isWaiting && question) {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last?.type === 'question' && last.text === question) return prev;
        const combined = [
          ...prev,
          {
            id: `q-${lineIdCounter.current++}`,
            type: 'question' as const,
            text: question,
            ts: Date.now(),
          },
        ];
        return combined.length > MAX_TERMINAL_LINES
          ? combined.slice(-MAX_TERMINAL_LINES)
          : combined;
      });
    }
  }, [isWaiting, question]);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Restore session on mount
  useEffect(() => {
    if (onRestoreExecutionState) {
      onRestoreExecutionState().then((state) => {
        if (state?.output) {
          const restoredLines = state.output
            .split('\n')
            .filter(
              (l) =>
                l.trim() && l.trim() !== 'null' && l.trim() !== 'undefined',
            )
            .map((text) => ({
              id: `r-${lineIdCounter.current++}`,
              type: classifyLine(text) as LogLine['type'],
              text,
              ts: Date.now(),
            }));
          setLines(restoredLines);
        }
        if (
          state?.status === 'running' ||
          state?.status === 'waiting_for_input'
        ) {
          polling.startPolling();
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || submitting) return;

    // Add user line
    setLines((prev) => {
      const combined = [
        ...prev,
        {
          id: `u-${lineIdCounter.current++}`,
          type: 'user' as const,
          text,
          ts: Date.now(),
        },
      ];
      return combined.length > MAX_TERMINAL_LINES
        ? combined.slice(-MAX_TERMINAL_LINES)
        : combined;
    });
    setInput('');

    if (isWaiting) {
      // Respond to question
      setSubmitting(true);
      try {
        const { API_BASE_URL } = await import('@/utils/api');
        const res = await fetch(
          `${API_BASE_URL}/tasks/${taskId}/agent-respond`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response: text }),
          },
        );
        if (res.ok) {
          polling.clearQuestion();
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        setLines((prev) => {
          const combined = [
            ...prev,
            {
              id: `e-${lineIdCounter.current++}`,
              type: 'error' as const,
              text: `[エラー] 回答の送信に失敗しました`,
              ts: Date.now(),
            },
          ];
          return combined.length > MAX_TERMINAL_LINES
            ? combined.slice(-MAX_TERMINAL_LINES)
            : combined;
        });
      } finally {
        setSubmitting(false);
      }
    } else {
      // New execution
      setSubmitting(true);
      try {
        const result = await onExecute({
          instruction: text,
          agentConfigId: selectedAgentId ?? undefined,
        });
        if (result?.sessionId) {
          setLines((prev) => {
            const combined = [
              ...prev,
              {
                id: `s-${lineIdCounter.current++}`,
                type: 'system' as const,
                text: `[System] 実行開始 (session: ${result.sessionId})`,
                ts: Date.now(),
              },
            ];
            return combined.length > MAX_TERMINAL_LINES
              ? combined.slice(-MAX_TERMINAL_LINES)
              : combined;
          });
          polling.startPolling();
        }
      } catch (e) {
        setLines((prev) => {
          const combined = [
            ...prev,
            {
              id: `e-${lineIdCounter.current++}`,
              type: 'error' as const,
              text: `[エラー] 実行の開始に失敗しました`,
              ts: Date.now(),
            },
          ];
          return combined.length > MAX_TERMINAL_LINES
            ? combined.slice(-MAX_TERMINAL_LINES)
            : combined;
        });
      } finally {
        setSubmitting(false);
      }
    }
  }, [
    input,
    submitting,
    isWaiting,
    taskId,
    selectedAgentId,
    onExecute,
    polling,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleStop = useCallback(() => {
    onStopExecution?.();
    polling.stopPolling();
    polling.setCancelled();
    setLines((prev) => {
      const combined = [
        ...prev,
        {
          id: `s-${lineIdCounter.current++}`,
          type: 'system' as const,
          text: '[System] 実行を停止しました',
          ts: Date.now(),
        },
      ];
      return combined.length > MAX_TERMINAL_LINES
        ? combined.slice(-MAX_TERMINAL_LINES)
        : combined;
    });
  }, [onStopExecution, polling]);

  const handleReset = useCallback(() => {
    onReset();
    polling.stopPolling();
    polling.clearLogs();
    setLines([]);
    prevLogsRef.current = [];
    setInput('');
  }, [onReset, polling]);

  const statusLabel = useMemo(() => {
    if (isWaiting) return '入力待ち';
    if (isRunning) return '実行中';
    switch (polling.status) {
      case 'completed':
        return '完了';
      case 'failed':
        return '失敗';
      case 'cancelled':
        return '中断';
      default:
        return '待機';
    }
  }, [isWaiting, isRunning, polling.status]);

  const placeholder = isWaiting
    ? '回答を入力...'
    : isRunning
      ? '実行中...'
      : '指示を入力... (Enter で送信)';

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-lg overflow-hidden border border-zinc-700">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
        <StatusDot status={polling.status} waitingForInput={isWaiting} />
        <span className="text-[10px] text-zinc-400 font-mono">
          {statusLabel}
        </span>
        <div className="flex-1" />

        {/* Model selector */}
        <ModelSelector
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelect={onAgentChange}
          disabled={isRunning}
        />

        {/* Controls */}
        <div className="flex items-center gap-1">
          {isRunning && (
            <button
              onClick={handleStop}
              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
              title="停止"
            >
              <Square className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
            title="リセット"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto min-h-[200px] max-h-[500px] py-2 font-mono"
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
            <Terminal className="w-6 h-6" />
            <span className="text-[10px]">
              指示を入力してAIエージェントを実行
            </span>
          </div>
        ) : (
          lines.map((line) => <TerminalLine key={line.id} line={line} />)
        )}

        {/* Waiting indicator */}
        {isRunning && !isWaiting && (
          <div className="px-3 py-1">
            <span className="inline-block w-2 h-4 bg-green-400 animate-pulse" />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2 px-3 py-2 bg-zinc-800/50 border-t border-zinc-700">
        <span className="text-green-400 text-[11px] font-mono pt-1.5 select-none">
          ❯
        </span>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={submitting || (isRunning && !isWaiting)}
          rows={1}
          className="flex-1 bg-transparent text-[11px] text-zinc-200 font-mono placeholder:text-zinc-600 outline-none resize-none disabled:opacity-40"
          style={{ minHeight: '24px', maxHeight: '96px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || submitting || (isRunning && !isWaiting)}
          className="p-1.5 text-zinc-400 hover:text-violet-400 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
          title={isWaiting ? '回答を送信' : '実行'}
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isWaiting ? (
            <Send className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
});
