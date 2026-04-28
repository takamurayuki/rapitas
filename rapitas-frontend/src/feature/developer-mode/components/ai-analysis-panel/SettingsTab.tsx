'use client';
// ai-analysis-panel/SettingsTab.tsx

import {
  Key,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Trash2,
  Settings,
  ChevronDown,
} from 'lucide-react';

type Props = {
  isApiKeyConfigured: boolean;
  maskedApiKey: string | null;
  isEditingApiKey: boolean;
  onSetIsEditingApiKey: (v: boolean) => void;
  apiKeyInput: string;
  onApiKeyInputChange: (v: string) => void;
  showApiKey: boolean;
  onToggleShowApiKey: () => void;
  isSavingApiKey: boolean;
  apiKeyError: string | null;
  apiKeySuccess: string | null;
  onSaveApiKey: () => Promise<void>;
  onDeleteApiKey: () => Promise<void>;
  onOpenSettings: () => void;
};

/**
 * Renders the settings tab with API key management and a link to developer mode settings.
 */
export function SettingsTab({
  isApiKeyConfigured,
  maskedApiKey,
  isEditingApiKey,
  onSetIsEditingApiKey,
  apiKeyInput,
  onApiKeyInputChange,
  showApiKey,
  onToggleShowApiKey,
  isSavingApiKey,
  apiKeyError,
  apiKeySuccess,
  onSaveApiKey,
  onDeleteApiKey,
  onOpenSettings,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Claude API キー
            </span>
          </div>
          {isApiKeyConfigured && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs">
              <CheckCircle2 className="w-3 h-3" />
              設定済み
            </span>
          )}
        </div>

        {apiKeyError && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-2">
            <AlertCircle className="w-4 h-4" />
            {apiKeyError}
          </div>
        )}
        {apiKeySuccess && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-2">
            <CheckCircle2 className="w-4 h-4" />
            {apiKeySuccess}
          </div>
        )}

        {isApiKeyConfigured && maskedApiKey && !isEditingApiKey ? (
          <div className="flex items-center justify-between">
            <code className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">
              {maskedApiKey}
            </code>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onSetIsEditingApiKey(true)}
                className="px-2 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-800"
              >
                変更
              </button>
              <button
                onClick={onDeleteApiKey}
                disabled={isSavingApiKey}
                className="p-1 text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => onApiKeyInputChange(e.target.value)}
                placeholder="sk-ant-api..."
                className="w-full px-3 py-1.5 pr-8 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
              />
              <button
                type="button"
                onClick={onToggleShowApiKey}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
              >
                {showApiKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
              >
                APIキーを取得
              </a>
              <div className="flex items-center gap-2">
                {isEditingApiKey && (
                  <button
                    onClick={() => {
                      onSetIsEditingApiKey(false);
                      onApiKeyInputChange('');
                    }}
                    className="text-xs text-zinc-500"
                  >
                    キャンセル
                  </button>
                )}
                <button
                  onClick={onSaveApiKey}
                  disabled={!apiKeyInput.trim() || isSavingApiKey}
                  className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded disabled:opacity-50"
                >
                  {isSavingApiKey ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onOpenSettings}
        className="w-full flex items-center justify-between p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            開発者モード詳細設定
          </span>
        </div>
        <ChevronDown className="w-4 h-4 text-zinc-400 -rotate-90" />
      </button>
    </div>
  );
}
