'use client';

/**
 * TerminalPanel
 *
 * Terminal-style execution panel for the developer-mode feature.
 * Manages log-line state, polling lifecycle, and user interaction,
 * delegating rendering to TerminalOutput and TerminalInput sub-components
 * and submit logic to useTerminalSubmit.
 */

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { Square, RotateCcw } from 'lucide-react';
import type { AIAgentConfig, ExecutionStatus, ExecutionResult } from '@/types';
import { ModelSelector } from './ModelSelector';
import { useExecutionPolling } from '../hooks/useExecutionStream';
import { StatusDot } from './terminal/TerminalLine';
import { TerminalOutput } from './terminal/TerminalOutput';
import { TerminalInput } from './terminal/TerminalInput';
import { useTerminalSubmit } from './terminal/useTerminalSubmit';
import {
  type LogLine,
  classifyLine,
  appendCapped,
} from './terminal/terminalUtils';

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

export const TerminalPanel = memo(function TerminalPanel({
  taskId,
  agents,
  selectedAgentId,
  onAgentChange,
  isExecuting,
  executionStatus,
  onExecute,
  onReset,
  onStopExecution,
  onRestoreExecutionState,
}: Props) {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevLogsRef = useRef<string[]>([]);
  const lineIdCounter = useRef(0);

  const polling = useExecutionPolling(taskId);
  const isRunning =
    polling.isRunning || executionStatus === 'running' || isExecuting;
  const isWaiting = polling.waitingForInput;
  const question = polling.question;

  // Append new log lines emitted by the polling hook.
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
      setLines((prev) => appendCapped(prev, newLines));
    }
  }, [polling.logs]);

  // Surface the agent's question as a terminal line.
  useEffect(() => {
    if (isWaiting && question) {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        // Guard against duplicate question lines on re-renders.
        if (last?.type === 'question' && last.text === question) return prev;
        return appendCapped(prev, [
          {
            id: `q-${lineIdCounter.current++}`,
            type: 'question' as const,
            text: question,
            ts: Date.now(),
          },
        ]);
      });
    }
  }, [isWaiting, question]);

  // Auto-scroll to bottom whenever lines change.
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Restore previous session output on mount.
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

  const submitHandler = useTerminalSubmit({
    taskId,
    selectedAgentId,
    isWaiting,
    lineIdCounter,
    onExecute,
    polling,
    setLines,
    setSubmitting,
    setInput,
  });

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || submitting) return;
    await submitHandler(input);
  }, [input, submitting, submitHandler]);

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
    setLines((prev) =>
      appendCapped(prev, [
        {
          id: `s-${lineIdCounter.current++}`,
          type: 'system' as const,
          text: '[System] 実行を停止しました',
          ts: Date.now(),
        },
      ]),
    );
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

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-lg overflow-hidden border border-zinc-700">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
        <StatusDot status={polling.status} waitingForInput={isWaiting} />
        <span className="text-[10px] text-zinc-400 font-mono">
          {statusLabel}
        </span>
        <div className="flex-1" />

        <ModelSelector
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelect={onAgentChange}
          disabled={isRunning}
        />

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

      <TerminalOutput
        outputRef={outputRef}
        lines={lines}
        isRunning={isRunning}
        isWaiting={isWaiting}
      />

      <TerminalInput
        inputRef={inputRef}
        value={input}
        submitting={submitting}
        isRunning={isRunning}
        isWaiting={isWaiting}
        onChange={setInput}
        onKeyDown={handleKeyDown}
        onSubmit={handleSubmit}
      />
    </div>
  );
});
