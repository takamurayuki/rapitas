/**
 * ScreenshotGrid
 *
 * Stateless grid display for screenshot thumbnails with a lightbox overlay.
 * Renders an empty-state message when no screenshots are available.
 */

'use client';

import { useState } from 'react';
import { Camera, AlertCircle, Maximize2, X } from 'lucide-react';
import type { ScreenshotInfo } from '@/types';
import { API_BASE_URL } from '@/utils/api';

type ScreenshotGridProps = {
  screenshots: ScreenshotInfo[];
  /** When true, the empty-state message is hidden (capture form is already visible) */
  hidePlaceholder?: boolean;
};

/**
 * Renders a 2-column screenshot grid with lightbox preview on click.
 *
 * @param screenshots - Screenshot list to display / 表示するスクリーンショットリスト
 * @param hidePlaceholder - Suppress empty-state message when capture form is open / キャプチャフォーム表示中は空状態メッセージを非表示
 */
export function ScreenshotGrid({
  screenshots,
  hidePlaceholder,
}: ScreenshotGridProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  if (screenshots.length === 0) {
    return hidePlaceholder ? null : (
      <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-4">
        UI変更が検出されなかったため、スクリーンショットは自動撮影されませんでした。「撮影」ボタンから手動で撮影することもできます。
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {screenshots.map((screenshot) => (
          <div
            key={screenshot.id}
            className="group relative rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-50 dark:bg-indigo-dark-800/30"
          >
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-indigo-dark-800/50 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {screenshot.page}
                </span>
              </div>
              <span className="text-xs text-zinc-400">{screenshot.label}</span>
            </div>
            <div
              className="relative cursor-pointer"
              onClick={() =>
                setLightboxImage(`${API_BASE_URL}${screenshot.url}`)
              }
            >
              <img
                src={`${API_BASE_URL}${screenshot.url}`}
                alt={`Screenshot of ${screenshot.page}`}
                className="w-full h-auto min-h-[100px] bg-zinc-200 dark:bg-zinc-700 object-contain"
                loading="lazy"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                  const fallback =
                    target.parentElement?.querySelector('.screenshot-error');
                  if (fallback instanceof HTMLElement)
                    fallback.style.display = 'flex';
                }}
              />
              <div className="screenshot-error hidden items-center justify-center gap-2 py-8 text-zinc-400 dark:text-zinc-500 text-sm">
                <AlertCircle className="w-4 h-4" />
                画像を読み込めませんでした
              </div>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox — fixed overlay rendered outside the grid layout */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors"
            onClick={() => setLightboxImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage}
            alt="Screenshot preview"
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
