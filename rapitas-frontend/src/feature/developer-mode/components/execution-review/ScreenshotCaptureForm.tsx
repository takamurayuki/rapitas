'use client';
// ScreenshotCaptureForm

import { useState } from 'react';
import { Globe, Camera, Plus, X, AlertCircle, Loader2 } from 'lucide-react';
import type { ScreenshotInfo } from '@/types';
import { API_BASE_URL } from '@/utils/api';

type CapturePage = { path: string; label: string };

type DetectedProject = {
  type: string;
  baseUrl: string;
  devPort: number;
};

type ScreenshotCaptureFormProps = {
  detectedProject: DetectedProject | null;
  captureBaseUrl: string;
  onCaptureBaseUrlChange: (url: string) => void;
  capturePages: CapturePage[];
  onAddPage: (page: CapturePage) => void;
  onRemovePage: (index: number) => void;
  workingDirectory?: string;
  onCaptureComplete: (screenshots: ScreenshotInfo[]) => void;
};

/**
 * Screenshot capture configuration form (controlled).
 *
 * @param detectedProject - Auto-detected project for URL pre-fill / 自動検出プロジェクト
 * @param captureBaseUrl - Controlled base URL value / 制御されたベースURL
 * @param onCaptureBaseUrlChange - Base URL change handler / ベースURL変更ハンドラ
 * @param capturePages - Controlled page list / 制御されたページリスト
 * @param onAddPage - Add a capture page / ページ追加ハンドラ
 * @param onRemovePage - Remove a capture page by index / ページ削除ハンドラ
 * @param workingDirectory - Agent working directory / エージェント作業ディレクトリ
 * @param onCaptureComplete - Called with new screenshots on success / 撮影成功時コールバック
 */
export function ScreenshotCaptureForm({
  detectedProject,
  captureBaseUrl,
  onCaptureBaseUrlChange,
  capturePages,
  onAddPage,
  onRemovePage,
  workingDirectory,
  onCaptureComplete,
}: ScreenshotCaptureFormProps) {
  const [newPagePath, setNewPagePath] = useState('');
  const [newPageLabel, setNewPageLabel] = useState('');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const commitNewPage = () => {
    if (!newPagePath.trim()) return;
    onAddPage({
      path: newPagePath.startsWith('/') ? newPagePath : `/${newPagePath}`,
      label: newPageLabel.trim() || newPagePath.replace(/^\//, ''),
    });
    setNewPagePath('');
    setNewPageLabel('');
  };

  const handleCapture = async () => {
    if (capturePages.length === 0) return;

    setIsCapturing(true);
    setCaptureError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/screenshots/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: captureBaseUrl || undefined,
          pages: capturePages,
          workingDirectory: workingDirectory || undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.screenshots) {
        onCaptureComplete(data.screenshots);
      } else {
        setCaptureError(data.error || 'スクリーンショットの撮影に失敗しました');
      }
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? err.message
          : 'スクリーンショットの撮影に失敗しました',
      );
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="p-4 bg-zinc-50 dark:bg-indigo-dark-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
          <Globe className="w-4 h-4" />
          スクリーンショット撮影
        </h5>
        {detectedProject && (
          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs font-medium">
            {detectedProject.type} 検出済み
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
          ベースURL
        </label>
        <input
          type="text"
          value={captureBaseUrl}
          onChange={(e) => onCaptureBaseUrlChange(e.target.value)}
          placeholder={
            detectedProject ? detectedProject.baseUrl : 'http://localhost:3000'
          }
          className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
        {detectedProject && (
          <p className="mt-1 text-xs text-zinc-400">
            検出されたポート: {detectedProject.devPort}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
          撮影ページ
        </label>
        <div className="space-y-1.5">
          {capturePages.map((page, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-indigo-dark-800 rounded border border-zinc-200 dark:border-zinc-700"
            >
              <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 flex-1">
                {page.path}
              </span>
              <span className="text-xs text-zinc-400">{page.label}</span>
              <button
                onClick={() => onRemovePage(index)}
                className="p-0.5 text-zinc-400 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={newPagePath}
            onChange={(e) => setNewPagePath(e.target.value)}
            placeholder="/dashboard"
            className="flex-1 px-3 py-1.5 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewPage();
              }
            }}
          />
          <input
            type="text"
            value={newPageLabel}
            onChange={(e) => setNewPageLabel(e.target.value)}
            placeholder="ラベル"
            className="w-24 px-3 py-1.5 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewPage();
              }
            }}
          />
          <button
            onClick={commitNewPage}
            disabled={!newPagePath.trim()}
            className="p-1.5 text-emerald-600 hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {captureError && (
        <div className="flex items-center gap-2 text-red-500 text-xs">
          <AlertCircle className="w-3.5 h-3.5" />
          {captureError}
        </div>
      )}

      <button
        onClick={handleCapture}
        disabled={isCapturing || capturePages.length === 0}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isCapturing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
        {isCapturing ? '撮影中...' : 'スクリーンショットを撮影'}
      </button>
    </div>
  );
}
