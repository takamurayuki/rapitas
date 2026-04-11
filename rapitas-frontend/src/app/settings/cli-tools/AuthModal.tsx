/**
 * AuthModal
 *
 * Multi-step modal dialog that guides the user through the interactive
 * authentication flow for a CLI tool (copy command → run → verify → complete).
 */

'use client';

import {
  Terminal,
  CheckCircle,
  AlertCircle,
  Loader2,
  Key,
  Play,
  Copy,
  X,
} from 'lucide-react';
import type { AuthModalState, ToolActionState } from './types';

interface AuthModalProps {
  authModal: AuthModalState;
  actionStates: Record<string, ToolActionState>;
  onClose: () => void;
  onVerify: () => void;
  onCopy: (text: string) => void;
  setStep: (step: AuthModalState['step']) => void;
}

/**
 * Renders the three-step CLI authentication modal (command → verify → completed).
 *
 * @param authModal - Current modal open/tool/command/step state.
 * @param actionStates - Per-tool loading flags used to gate the verify button.
 * @param onClose - Closes the modal.
 * @param onVerify - Triggers authentication verification against the backend.
 * @param onCopy - Copies the auth command to the clipboard.
 * @param setStep - Advances or retreats the modal step.
 */
export function AuthModal({
  authModal,
  actionStates,
  onClose,
  onVerify,
  onCopy,
  setStep,
}: AuthModalProps) {
  if (!authModal.isOpen || !authModal.tool) return null;

  const isAuthenticating =
    actionStates[authModal.tool.id]?.isAuthenticating ?? false;

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6">
          {/* Modal header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <Key className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {authModal.tool.name} の認証
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  ターミナルでコマンドを実行して認証を完了してください
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-zinc-400" />
            </button>
          </div>

          {/* Step 1: show command */}
          {authModal.step === 'command' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-3">
                  ステップ 1: ターミナルでコマンドを実行
                </h3>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                      認証コマンド
                    </span>
                    <button
                      onClick={() => onCopy(authModal.command || '')}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      コピー
                    </button>
                  </div>
                  <code className="block p-3 bg-zinc-900 dark:bg-zinc-950 text-green-400 rounded text-sm font-mono overflow-x-auto">
                    {authModal.command}
                  </code>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <div className="p-1 bg-blue-100 dark:bg-blue-900/30 rounded">
                    <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                      実行手順
                    </h4>
                    <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                      <li>1. 上記のコマンドをコピーしてください</li>
                      <li>
                        2.
                        ターミナル（コマンドプロンプトまたはPowerShell）を開いてください
                      </li>
                      <li>3. コマンドを貼り付けて実行してください</li>
                      <li>4. ブラウザで認証プロセスを完了してください</li>
                      <li>5. 下記の「認証確認」ボタンをクリックしてください</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => setStep('verify')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  認証確認へ
                </button>
              </div>
            </div>
          )}

          {/* Step 2: verify */}
          {authModal.step === 'verify' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-3">
                  ステップ 2: 認証状況を確認
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  ターミナルで認証コマンドを実行しましたか？下記のボタンをクリックして認証状況を確認してください。
                </p>

                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800 dark:text-amber-200">
                      <p className="mb-1">
                        認証が完了していない場合は、以下を確認してください：
                      </p>
                      <ul className="text-xs space-y-1 ml-2">
                        <li>• ターミナルでコマンドを正しく実行したか</li>
                        <li>• ブラウザでの認証プロセスを完了したか</li>
                        <li>• ターミナルでエラーが表示されていないか</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep('command')}
                  className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  戻る
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={onVerify}
                    disabled={isAuthenticating}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isAuthenticating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    認証確認
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: completed */}
          {authModal.step === 'completed' && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto w-fit mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
                  認証が完了しました！
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {authModal.tool.name}
                  の認証が正常に完了しました。CLIツールをご利用いただけます。
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                  このダイアログは3秒後に自動的に閉じます
                </p>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  完了
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
