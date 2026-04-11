/**
 * ai-analysis-panel/ApiKeySetupPrompt.tsx
 *
 * Full-panel prompt shown when no Claude API key is configured.
 * Renders an inline input to enter and save a key before the main panel is accessible.
 */

'use client';

import {
  Key,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Save,
  AlertCircle,
} from 'lucide-react';

type Props = {
  apiKeyInput: string;
  onApiKeyInputChange: (v: string) => void;
  showApiKey: boolean;
  onToggleShowApiKey: () => void;
  isSavingApiKey: boolean;
  apiKeyError: string | null;
  onSave: () => Promise<void>;
};

/**
 * Renders the API key setup gate when no key is configured.
 *
 * @param props.apiKeyInput - Current value of the API key text field.
 * @param props.onApiKeyInputChange - Setter for the API key text field.
 * @param props.showApiKey - Whether the input is in plain-text mode.
 * @param props.onToggleShowApiKey - Toggles visibility of the API key.
 * @param props.isSavingApiKey - True while the save request is in-flight.
 * @param props.apiKeyError - Error message from a failed save attempt.
 * @param props.onSave - Triggers the API key save request.
 */
export function ApiKeySetupPrompt({
  apiKeyInput,
  onApiKeyInputChange,
  showApiKey,
  onToggleShowApiKey,
  isSavingApiKey,
  apiKeyError,
  onSave,
}: Props) {
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-amber-200 dark:border-amber-700 overflow-hidden">
      <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            APIキーの設定が必要です
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          AI分析機能を使用するにはClaude APIキーを設定してください。
        </p>
        <div className="space-y-2">
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => onApiKeyInputChange(e.target.value)}
              placeholder="sk-ant-api..."
              className="w-full px-3 py-2 pr-10 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
            <button
              type="button"
              onClick={onToggleShowApiKey}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {showApiKey ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <a
              href="https://console.anthropic.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
            >
              APIキーを取得
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={onSave}
              disabled={!apiKeyInput.trim() || isSavingApiKey}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        {apiKeyError && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            {apiKeyError}
          </div>
        )}
      </div>
    </div>
  );
}
