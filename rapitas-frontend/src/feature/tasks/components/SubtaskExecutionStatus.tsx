'use client';

import React from 'react';
import { CheckCircle2, Circle, XCircle, Clock, Pause } from 'lucide-react';

/**
 * 並列実行時のサブタスクステータス
 */
export type ParallelExecutionStatus =
  | 'pending' // Waiting
  | 'scheduled' // スケジュール済み
  | 'running' // Running
  | 'completed' // Completed
  | 'failed' // Failed
  | 'cancelled' // キャンセル
  | 'blocked'; // ブロック（依存タスク未完了）

interface SubtaskExecutionStatusProps {
  /** 並列実行のステータス */
  executionStatus?: ParallelExecutionStatus;
  /** コンパクト表示（アイコンのみ） */
  compact?: boolean;
  /** サイズ */
  size?: 'sm' | 'md' | 'lg';
  /** クラス名 */
  className?: string;
}

/**
 * サブタスク並列実行ステータス表示コンポーネント
 *
 * 並列実行中のサブタスクの進行状況を視覚的に表示します。
 * - pending: グレーの円形アイコン（待機中）
 * - scheduled: 時計アイコン（スケジュール済み）
 * - running: 回転するローディングアイコン（実行中）
 * - completed: 緑のチェックマーク（完了）
 * - failed: 赤のXアイコン（失敗）
 * - cancelled: 黄色の一時停止アイコン（キャンセル）
 * - blocked: オレンジの一時停止アイコン（ブロック中）
 */
export function SubtaskExecutionStatus({
  executionStatus,
  compact = false,
  size = 'sm',
  className = '',
}: SubtaskExecutionStatusProps) {
  // ステータスがない場合は何も表示しない
  if (!executionStatus) {
    return null;
  }

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const containerSizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-7 h-7',
  };

  const iconSize = sizeClasses[size];
  const containerSize = containerSizeClasses[size];

  const statusConfig: Record<
    ParallelExecutionStatus,
    {
      icon: React.ReactNode;
      bgColor: string;
      textColor: string;
      label: string;
      animate?: boolean;
    }
  > = {
    pending: {
      icon: <Circle className={iconSize} />,
      bgColor: 'bg-zinc-100 dark:bg-indigo-dark-800',
      textColor: 'text-zinc-400 dark:text-zinc-500',
      label: '待機中',
    },
    scheduled: {
      icon: <Clock className={iconSize} />,
      bgColor: 'bg-blue-50 dark:bg-blue-900/30',
      textColor: 'text-blue-500 dark:text-blue-400',
      label: 'スケジュール済み',
    },
    running: {
      icon: (
        <div className={`relative ${containerSize}`}>
          <svg
            className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
          >
            <rect
              x="1"
              y="1"
              width="22"
              height="22"
              rx="5"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="14 74"
              strokeLinecap="round"
              fill="none"
              style={{
                animation: 'icon-outer-border-spin 1.5s linear infinite',
                willChange: 'stroke-dashoffset',
                transform: 'translateZ(0)',
              }}
            />
          </svg>
          <Circle className={`${iconSize} text-blue-600 dark:text-blue-400`} />
        </div>
      ),
      bgColor: 'bg-blue-100 dark:bg-blue-900/40',
      textColor: 'text-blue-600 dark:text-blue-400',
      label: '実行中',
      animate: true,
    },
    completed: {
      icon: <CheckCircle2 className={iconSize} />,
      bgColor: 'bg-green-100 dark:bg-green-900/40',
      textColor: 'text-green-600 dark:text-green-400',
      label: '完了',
    },
    failed: {
      icon: <XCircle className={iconSize} />,
      bgColor: 'bg-red-100 dark:bg-red-900/40',
      textColor: 'text-red-600 dark:text-red-400',
      label: '失敗',
    },
    cancelled: {
      icon: <Pause className={iconSize} />,
      bgColor: 'bg-yellow-100 dark:bg-yellow-900/40',
      textColor: 'text-yellow-600 dark:text-yellow-400',
      label: 'キャンセル',
    },
    blocked: {
      icon: <Pause className={iconSize} />,
      bgColor: 'bg-orange-100 dark:bg-orange-900/40',
      textColor: 'text-orange-600 dark:text-orange-400',
      label: 'ブロック中',
    },
  };

  const config = statusConfig[executionStatus];

  if (compact) {
    return (
      <div
        className={`${containerSize} rounded-full ${config.bgColor} flex items-center justify-center ${config.textColor} ${className}`}
        title={config.label}
      >
        {config.icon}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${config.bgColor} ${config.textColor} text-xs font-medium ${className}`}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

/**
 * サブタスクタイトル用のローディングインジケーター
 * タイトルの前に表示して、実行中であることを示します
 */
interface SubtaskTitleIndicatorProps {
  /** 並列実行のステータス */
  executionStatus?: ParallelExecutionStatus;
  /** サイズ */
  size?: 'sm' | 'md';
  /** クラス名 */
  className?: string;
}

export function SubtaskTitleIndicator({
  executionStatus,
  size = 'sm',
  className = '',
}: SubtaskTitleIndicatorProps) {
  if (!executionStatus) {
    return null;
  }

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
  };

  const iconSize = sizeClasses[size];

  switch (executionStatus) {
    case 'running':
      return (
        <div className={`relative ${sizeClasses[size]} shrink-0 ${className}`}>
          <svg
            className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] pointer-events-none"
            viewBox="0 0 20 20"
            fill="none"
          >
            <rect
              x="1"
              y="1"
              width="18"
              height="18"
              rx="4"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="12 60"
              strokeLinecap="round"
              fill="none"
              style={{
                animation: 'icon-outer-border-spin 1.5s linear infinite',
                willChange: 'stroke-dashoffset',
                transform: 'translateZ(0)',
              }}
            />
          </svg>
          <Circle className={`${iconSize} text-blue-500 dark:text-blue-400`} />
        </div>
      );
    case 'completed':
      return (
        <CheckCircle2
          className={`${iconSize} text-green-500 dark:text-green-400 shrink-0 ${className}`}
        />
      );
    case 'failed':
      return (
        <XCircle
          className={`${iconSize} text-red-500 dark:text-red-400 shrink-0 ${className}`}
        />
      );
    case 'scheduled':
      return (
        <Clock
          className={`${iconSize} text-blue-400 dark:text-blue-500 shrink-0 ${className}`}
        />
      );
    case 'blocked':
      return (
        <Pause
          className={`${iconSize} text-orange-500 dark:text-orange-400 shrink-0 ${className}`}
        />
      );
    case 'cancelled':
      return (
        <Pause
          className={`${iconSize} text-yellow-500 dark:text-yellow-400 shrink-0 ${className}`}
        />
      );
    case 'pending':
    default:
      return null;
  }
}

export default SubtaskExecutionStatus;
