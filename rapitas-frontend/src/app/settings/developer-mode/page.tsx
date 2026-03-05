'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Bot, AlertCircle, Loader2, RotateCcw, Zap, Bug, ShieldCheck } from 'lucide-react';
import type { UserSettings } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner, SkeletonBlock } from '@/components/ui/LoadingSpinner';
import { ErrorAnalysisPanel } from '@/feature/developer-mode/components/ErrorAnalysisPanel';
import { useErrorCapture } from '@/feature/developer-mode/hooks/useErrorCapture';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DeveloperModePage');

export default function DeveloperModeSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // エラーキャプチャの設定
  const { manualCaptureError } = useErrorCapture({
    captureConsoleErrors: true,
    captureUnhandledRejections: true,
    captureNetworkErrors: true,
    onError: (error) => {
      logger.debug('Error captured:', error);
    },
  });

  // 自動生成待機時間のローカル状態（即座に反映し、デバウンスで保存）
  const [localDelay, setLocalDelay] = useState<number | ''>(3);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自動再開設定
  const [isSavingAutoResume, setIsSavingAutoResume] = useState(false);
  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setLocalDelay(data.autoGenerateTitleDelay ?? 3);
      }
    } catch {
      setError('設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => (prev ? { ...prev, ...data } : data));
      } else {
        const errorData = await res.json().catch(() => null);
        const errorMsg =
          errorData?.message || errorData?.error || '更新に失敗しました';
        throw new Error(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      showToast(
        err instanceof Error ? err.message : '設定の保存に失敗しました',
        'error',
      );
    } finally {
      setIsSaving(false);
    }
  };

  // 待機時間のデバウンス保存
  const saveDelayDebounced = useCallback((val: number) => {
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current);
    }
    delayTimerRef.current = setTimeout(() => {
      updateSettings({ autoGenerateTitleDelay: val });
    }, 500);
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
      }
    };
  }, []);

  const handleDelayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      setLocalDelay('');
      return;
    }
    const num = Number(raw);
    if (isNaN(num)) return;
    const clamped = Math.max(1, Math.min(30, num));
    setLocalDelay(clamped);
    saveDelayDebounced(clamped);
  };

  const handleDelayBlur = () => {
    // 空欄のままフォーカスを外したらデフォルト値に戻す
    if (localDelay === '' || localDelay < 1) {
      setLocalDelay(3);
      saveDelayDebounced(3);
    }
  };

  const toggleAutoResume = async () => {
    if (!settings) return;
    const newValue = !settings.autoResumeInterruptedTasks;
    setIsSavingAutoResume(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoResumeInterruptedTasks: newValue }),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? { ...prev, autoResumeInterruptedTasks: newValue } : prev,
        );
      } else {
        const errorData = await res.json().catch(() => null);
        const errorMsg =
          errorData?.message || errorData?.error || '設定の保存に失敗しました';
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定の保存に失敗しました');
    } finally {
      setIsSavingAutoResume(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Bot className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            開発者モード
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AI設定とエラー解析ツール
          </p>
        </div>
      </div>

      <Tabs defaultValue="ai-settings" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ai-settings" className="flex items-center gap-2">
            <Bot className="w-4 h-4" />
            AI設定
          </TabsTrigger>
          <TabsTrigger
            value="error-analysis"
            className="flex items-center gap-2"
          >
            <Bug className="w-4 h-4" />
            エラー解析
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai-settings" className="mt-6">
          {/* Messages */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* AIアシスタント設定 */}
            <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <Bot className="w-5 h-5 text-violet-500" />
                  <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                    AIアシスタント設定
                  </h2>
                </div>
              </div>
              <div className="p-6 space-y-6">
                {/* AIアシスタント有効設定 */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                      AIアシスタントを有効にする
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      開発プロジェクトのタスク詳細画面でAIアシスタントパネルを表示します
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      updateSettings({
                        aiTaskAnalysisDefault: !settings?.aiTaskAnalysisDefault,
                      })
                    }
                    disabled={isSaving}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      settings?.aiTaskAnalysisDefault
                        ? 'bg-violet-500'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        settings?.aiTaskAnalysisDefault ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* タスク作成時の設定 */}
          <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-violet-500" />
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  タスク作成時の設定
                </h2>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    作成後にすぐ実行
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    タスク作成後、自動的にAIエージェントによる実行を開始します
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      updateSettings({
                        autoExecuteAfterCreate:
                          !settings?.autoExecuteAfterCreate,
                      })
                    }
                    disabled={isSaving}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      settings?.autoExecuteAfterCreate
                        ? 'bg-violet-500'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                    role="switch"
                    aria-checked={settings?.autoExecuteAfterCreate ?? false}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        settings?.autoExecuteAfterCreate
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    タイトルの自動生成
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    説明を入力すると、AIが自動的にタスクのタイトルを生成します
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      updateSettings({
                        autoGenerateTitle: !settings?.autoGenerateTitle,
                      })
                    }
                    disabled={isSaving}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      settings?.autoGenerateTitle
                        ? 'bg-violet-500'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                    role="switch"
                    aria-checked={settings?.autoGenerateTitle ?? false}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        settings?.autoGenerateTitle
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
              {settings?.autoGenerateTitle && (
                <>
                  <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-violet-200 dark:border-violet-800">
                    <div>
                      <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-50">
                        自動生成までの待機時間
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        入力が止まってから自動生成を開始するまでの秒数
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={localDelay}
                        onChange={handleDelayChange}
                        onBlur={handleDelayBlur}
                        className="w-16 px-2 py-1 text-sm text-center rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        秒
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 ml-4 pl-4 border-l-2 border-violet-200 dark:border-violet-800">
                    <div>
                      <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-50">
                        タイトル生成後に自動作成
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        AIによるタイトル生成が完了したら自動的にタスクを作成します
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        updateSettings({
                          autoCreateAfterTitleGeneration:
                            !settings?.autoCreateAfterTitleGeneration,
                        })
                      }
                      disabled={isSaving}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                        settings?.autoCreateAfterTitleGeneration
                          ? 'bg-violet-500'
                          : 'bg-zinc-300 dark:bg-zinc-600'
                      }`}
                      role="switch"
                      aria-checked={
                        settings?.autoCreateAfterTitleGeneration ?? false
                      }
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          settings?.autoCreateAfterTitleGeneration
                            ? 'translate-x-5'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    AI提案の自動取得
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    テーマを選択した際に、AIによるタスク提案を自動的に取得します
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateSettings({
                      autoFetchTaskSuggestions:
                        !settings?.autoFetchTaskSuggestions,
                    })
                  }
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    settings?.autoFetchTaskSuggestions
                      ? 'bg-violet-500'
                      : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                  role="switch"
                  aria-checked={settings?.autoFetchTaskSuggestions ?? true}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings?.autoFetchTaskSuggestions
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* タスク自動再開設定 */}
          <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <RotateCcw className="w-5 h-5 text-violet-500" />
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  タスク自動再開設定
                </h2>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    中断タスク自動再開
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    アプリ起動時に中断されたAIエージェントのタスクを自動再開します
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isSavingAutoResume && (
                    <SkeletonBlock className="w-4 h-4 rounded" />
                  )}
                  <button
                    onClick={toggleAutoResume}
                    disabled={isSavingAutoResume}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                      settings?.autoResumeInterruptedTasks
                        ? 'bg-violet-600'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                    role="switch"
                    aria-checked={settings?.autoResumeInterruptedTasks ?? false}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        settings?.autoResumeInterruptedTasks
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ワークフロー設定 */}
          <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-violet-500" />
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  ワークフロー設定
                </h2>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    計画の自動承認
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    AIエージェントが作成した計画（plan.md）を自動的に承認し、実装フェーズに移行します
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateSettings({
                      autoApprovePlan: !settings?.autoApprovePlan,
                    })
                  }
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    settings?.autoApprovePlan
                      ? 'bg-violet-500'
                      : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                  role="switch"
                  aria-checked={settings?.autoApprovePlan ?? false}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings?.autoApprovePlan
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                    複雑度の自動分析
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    タスクの複雑度を自動的に分析し、ワークフローモードを設定します。ONの場合、手動でのモード変更はできません
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateSettings({
                      autoComplexityAnalysis: !settings?.autoComplexityAnalysis,
                    })
                  }
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    settings?.autoComplexityAnalysis
                      ? 'bg-violet-500'
                      : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                  role="switch"
                  aria-checked={settings?.autoComplexityAnalysis ?? false}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      settings?.autoComplexityAnalysis
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="error-analysis" className="mt-6">
          <ErrorAnalysisPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
