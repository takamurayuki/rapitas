'use client';
// ScreenshotsSection

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Camera } from 'lucide-react';
import type { ScreenshotInfo } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { ScreenshotCaptureForm } from './ScreenshotCaptureForm';
import { ScreenshotGrid } from './ScreenshotGrid';

type CapturePage = { path: string; label: string };

type DetectedProject = {
  type: string;
  baseUrl: string;
  devPort: number;
};

type ScreenshotsSectionProps = {
  initialScreenshots?: ScreenshotInfo[];
  workingDirectory?: string;
};

/**
 * Collapsible screenshots section with auto-detection and manual capture support.
 *
 * @param initialScreenshots - Screenshots pre-populated from execution result / 実行結果から設定されたスクリーンショット
 * @param workingDirectory - Agent working directory for project auto-detection / プロジェクト自動検出用作業ディレクトリ
 */
export function ScreenshotsSection({
  initialScreenshots,
  workingDirectory,
}: ScreenshotsSectionProps) {
  const [showScreenshots, setShowScreenshots] = useState(true);
  const [showCaptureForm, setShowCaptureForm] = useState(false);
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>(initialScreenshots || []);
  const [captureBaseUrl, setCaptureBaseUrl] = useState('');
  const [capturePages, setCapturePages] = useState<CapturePage[]>([{ path: '/', label: 'home' }]);
  const [detectedProject, setDetectedProject] = useState<DetectedProject | null>(null);

  // NOTE: Also reflect changes when initialScreenshots updates later
  useEffect(() => {
    if (initialScreenshots && initialScreenshots.length > 0) {
      setScreenshots(initialScreenshots);
    }
  }, [initialScreenshots]);

  /** Auto-detect project structure from working directory */
  const detectProject = async () => {
    if (!workingDirectory) return;

    try {
      const res = await fetch(`${API_BASE_URL}/screenshots/detect-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        setDetectedProject({
          type: data.project.type,
          baseUrl: data.project.baseUrl,
          devPort: data.project.devPort,
        });
        setCaptureBaseUrl(data.project.baseUrl);
      }
    } catch {
      // ignore — detection is best-effort
    }
  };

  const handleOpenCaptureForm = () => {
    setShowCaptureForm(!showCaptureForm);
    setShowScreenshots(true);
    if (!detectedProject && workingDirectory) {
      detectProject();
    }
  };

  const handleCaptureComplete = (newScreenshots: ScreenshotInfo[]) => {
    setScreenshots((prev) => [...prev, ...newScreenshots]);
    setShowCaptureForm(false);
    setShowScreenshots(true);
  };

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center">
        <button
          onClick={() => setShowScreenshots(!showScreenshots)}
          className="flex-1 flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
        >
          {showScreenshots ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
          <Camera className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            画面スクリーンショット
          </span>
          {screenshots.length > 0 && (
            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-medium">
              {screenshots.length}
            </span>
          )}
        </button>
        <button
          onClick={handleOpenCaptureForm}
          className="flex items-center gap-1.5 px-3 py-1.5 mr-4 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-md transition-colors"
        >
          <Camera className="w-3.5 h-3.5" />
          撮影
        </button>
      </div>

      {showScreenshots && (
        <div className="px-6 pb-4 space-y-4">
          {showCaptureForm && (
            <ScreenshotCaptureForm
              detectedProject={detectedProject}
              captureBaseUrl={captureBaseUrl}
              onCaptureBaseUrlChange={setCaptureBaseUrl}
              capturePages={capturePages}
              onAddPage={(page) => setCapturePages((prev) => [...prev, page])}
              onRemovePage={(index) =>
                setCapturePages((prev) => prev.filter((_, i) => i !== index))
              }
              workingDirectory={workingDirectory}
              onCaptureComplete={handleCaptureComplete}
            />
          )}
          <ScreenshotGrid screenshots={screenshots} hidePlaceholder={showCaptureForm} />
        </div>
      )}
    </div>
  );
}
