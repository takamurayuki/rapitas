/**
 * LocalLlmSection
 *
 * Settings panel for the local LLM integration (Ollama / llama-server).
 * Handles connection testing, model download progress, and title-generation
 * provider selection.
 */
'use client';

import { useTranslations } from 'next-intl';
import { Terminal, Loader2, Save, CheckCircle, Trash2 } from 'lucide-react';
import type { UserSettings } from '@/types';
import { API_BASE_URL } from '@/utils/api';

type LocalLlmStatus = {
  available: boolean;
  source: string;
  model: string;
  models: string[];
  modelDownloaded: boolean;
};

type DownloadProgress = {
  status: string;
  progress: number;
  downloadedMB: number;
  totalMB: number;
};

type Props = {
  settings: UserSettings | null;
  localLlmStatus: LocalLlmStatus | null;
  localLlmLoading: boolean;
  downloadProgress: DownloadProgress | null;
  ollamaUrlInput: string;
  onOllamaUrlChange: (value: string) => void;
  onTestConnection: () => void;
  onDownloadModel: () => void;
  onDeleteModel: () => void;
  onSaveLocalLlmSettings: (updates: Record<string, unknown>) => void;
};

/**
 * Full local LLM settings panel.
 *
 * @param props - Local LLM state and action handlers.
 */
export function LocalLlmSection({
  settings,
  localLlmStatus,
  localLlmLoading,
  downloadProgress,
  ollamaUrlInput,
  onOllamaUrlChange,
  onTestConnection,
  onDownloadModel,
  onDeleteModel,
  onSaveLocalLlmSettings,
}: Props) {
  const t = useTranslations('settings');

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-emerald-500" />
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              {t('localLlmConfig')}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('localLlmDescription')}
            </p>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-5">
        {/* Connection status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('localLlmStatus')}:
            </span>
            {localLlmStatus?.available ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t('localLlmConnected')} ({localLlmStatus.source})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                {t('localLlmDisconnected')}
              </span>
            )}
          </div>
          <button
            onClick={onTestConnection}
            disabled={localLlmLoading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {localLlmLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              t('localLlmTestConnection')
            )}
          </button>
        </div>

        {/* Ollama URL */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {t('localLlmOllamaUrl')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={ollamaUrlInput}
              onChange={(e) => onOllamaUrlChange(e.target.value)}
              placeholder="http://localhost:11434"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            <button
              onClick={() => onSaveLocalLlmSettings({ ollamaUrl: ollamaUrlInput })}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Available models */}
        {localLlmStatus?.available && localLlmStatus.models.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t('localLlmModel')}
            </label>
            <div className="flex flex-wrap gap-2">
              {localLlmStatus.models.slice(0, 10).map((model) => (
                <span
                  key={model}
                  className="px-2.5 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"
                >
                  {model}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bundled model download */}
        <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Qwen2.5-0.5B (Q4) — llama-server用
              </h4>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Ollamaがない場合のフォールバックモデル (~400MB)
              </p>
            </div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                localLlmStatus?.modelDownloaded
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {localLlmStatus?.modelDownloaded
                ? t('localLlmDownloaded')
                : t('localLlmNotDownloaded')}
            </span>
          </div>

          {downloadProgress?.status === 'downloading' && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                <span>{t('localLlmDownloading')}</span>
                <span>
                  {downloadProgress.downloadedMB}MB / {downloadProgress.totalMB}MB (
                  {downloadProgress.progress}%)
                </span>
              </div>
              <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                <div
                  className="bg-violet-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress.progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            {!localLlmStatus?.modelDownloaded && (
              <button
                onClick={onDownloadModel}
                disabled={
                  localLlmLoading || downloadProgress?.status === 'downloading'
                }
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {downloadProgress?.status === 'downloading'
                  ? t('localLlmDownloading')
                  : t('localLlmDownloadModel')}
              </button>
            )}
            {localLlmStatus?.modelDownloaded && (
              <button
                onClick={onDeleteModel}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="w-3 h-3 inline mr-1" />
                {t('localLlmDeleteModel')}
              </button>
            )}
          </div>
        </div>

        {/* Title-generation provider selector */}
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            {t('titleGenerationProvider')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => onSaveLocalLlmSettings({ titleGenerationProvider: 'ollama' })}
              className={`p-3 rounded-xl border-2 text-left transition-all ${
                !settings?.titleGenerationProvider ||
                settings.titleGenerationProvider === 'ollama'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-emerald-300 dark:hover:border-emerald-700 bg-white dark:bg-zinc-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {(!settings?.titleGenerationProvider ||
                  settings.titleGenerationProvider === 'ollama') && (
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                )}
                <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                  {t('titleGenUseLocal')}
                </h3>
              </div>
            </button>
            <button
              onClick={() => onSaveLocalLlmSettings({ titleGenerationProvider: 'default' })}
              className={`p-3 rounded-xl border-2 text-left transition-all ${
                settings?.titleGenerationProvider === 'default'
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {settings?.titleGenerationProvider === 'default' && (
                  <CheckCircle className="w-4 h-4 text-violet-500" />
                )}
                <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                  {t('titleGenUseDefault')}
                </h3>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { API_BASE_URL };
