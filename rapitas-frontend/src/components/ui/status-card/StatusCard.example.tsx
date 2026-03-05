'use client';

import React, { useState } from 'react';
import { StatusCard, AgentStatusType } from './index';
import { Bot, Zap } from 'lucide-react';
import { createLogger } from '@/lib/logger';
const logger = createLogger('StatusCardExample');

/**
 * StatusCard 使用例・デモコンポーネント
 *
 * このファイルは StatusCard コンポーネントの使用方法を示すデモです。
 * 実際のプロダクションコードでは、このファイルを参照してください。
 */

/**
 * 基本的な使用例
 */
export const BasicExample: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        基本的な使用例
      </h3>
      <div className="flex flex-wrap gap-4">
        <StatusCard status="processing" />
        <StatusCard status="waiting_for_input" />
        <StatusCard status="error" />
        <StatusCard status="completed" />
      </div>
    </div>
  );
};

/**
 * メッセージ付きの使用例
 */
export const WithMessageExample: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        メッセージ付き
      </h3>
      <div className="flex flex-col gap-3">
        <StatusCard status="processing" message="ファイルを分析しています..." />
        <StatusCard
          status="waiting_for_input"
          message="続行するには承認が必要です"
        />
        <StatusCard status="error" message="API接続に失敗しました" />
        <StatusCard status="completed" message="タスクが正常に完了しました" />
      </div>
    </div>
  );
};

/**
 * サイズバリエーション
 */
export const SizeVariantsExample: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        サイズバリエーション
      </h3>
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-sm text-zinc-500 mb-1 block">Small (sm)</span>
          <StatusCard status="processing" size="sm" message="処理中" />
        </div>
        <div>
          <span className="text-sm text-zinc-500 mb-1 block">
            Medium (md) - デフォルト
          </span>
          <StatusCard status="processing" size="md" message="処理中" />
        </div>
        <div>
          <span className="text-sm text-zinc-500 mb-1 block">Large (lg)</span>
          <StatusCard status="processing" size="lg" message="処理中" />
        </div>
      </div>
    </div>
  );
};

/**
 * カスタムアイコンの使用例
 */
export const CustomIconExample: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        カスタムアイコン
      </h3>
      <div className="flex flex-wrap gap-4">
        <StatusCard
          status="processing"
          message="AIエージェント実行中"
          icon={<Bot className="w-full h-full animate-bounce" />}
        />
        <StatusCard
          status="completed"
          message="高速処理完了"
          icon={<Zap className="w-full h-full" />}
        />
      </div>
    </div>
  );
};

/**
 * インタラクティブデモ
 */
export const InteractiveDemo: React.FC = () => {
  const [currentStatus, setCurrentStatus] =
    useState<AgentStatusType>('processing');

  const statusMessages: Record<AgentStatusType, string> = {
    processing: 'タスクを実行中です...',
    waiting_for_input: 'ユーザーの入力を待っています',
    error: '予期しないエラーが発生しました',
    completed: 'すべてのタスクが完了しました',
  };

  const handleStatusChange = (newStatus: AgentStatusType) => {
    logger.debug(`ステータスが変更されました: ${newStatus}`);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        インタラクティブデモ
      </h3>

      <div className="flex flex-wrap gap-2">
        {(
          [
            'processing',
            'waiting_for_input',
            'error',
            'completed',
          ] as AgentStatusType[]
        ).map((status) => (
          <button
            key={status}
            onClick={() => setCurrentStatus(status)}
            className={`
                px-3 py-1.5 text-sm rounded-md transition-colors
                ${
                  currentStatus === status
                    ? 'bg-blue-500 text-white'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                }
              `}
          >
            {status}
          </button>
        ))}
      </div>

      <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
        <StatusCard
          status={currentStatus}
          message={statusMessages[currentStatus]}
          onStatusChange={handleStatusChange}
          animated
        />
      </div>
    </div>
  );
};

/**
 * アクセシビリティ対応の例
 */
export const AccessibilityExample: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
        アクセシビリティ対応
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        aria-label を使用してスクリーンリーダー向けの説明を提供できます
      </p>
      <StatusCard
        status="processing"
        message="ファイルをアップロード中"
        ariaLabel="AIエージェントがファイルをアップロードしています。しばらくお待ちください。"
      />
    </div>
  );
};

/**
 * すべての例を含むデモページ
 */
export const StatusCardDemo: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-indigo-dark-900 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 mb-8">
          StatusCard コンポーネント デモ
        </h1>

        <div className="space-y-8 bg-white dark:bg-zinc-800 rounded-xl shadow-lg p-6">
          <BasicExample />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <WithMessageExample />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <SizeVariantsExample />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <CustomIconExample />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <InteractiveDemo />
          <hr className="border-zinc-200 dark:border-zinc-700" />
          <AccessibilityExample />
        </div>
      </div>
    </div>
  );
};

export default StatusCardDemo;
