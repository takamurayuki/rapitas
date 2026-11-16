'use client';

import { useEffect, useState } from 'react';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { isTauri } from '@/utils/tauri';

/** Blank Windows caption. The native window still owns its shell title/icon. */
export default function DesktopTitleBar() {
  const [windowApi, setWindowApi] = useState<TauriWindow | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!isTauri() || !/Win/i.test(navigator.platform)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const current = getCurrentWindow();
        if (current.label !== 'main' || disposed) return;
        const update = async () => {
          const [max, full] = await Promise.all([current.isMaximized(), current.isFullscreen()]);
          if (!disposed) {
            setMaximized(max);
            setFullscreen(full);
          }
        };
        await update();
        const stop = await current.onResized(() => {
          void update().catch(console.error);
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        setWindowApi(current);
      })
      .catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!windowApi) return;
    // The controls have mounted before removing native decorations. If this
    // fails, keep the native frame so the window remains movable/closable.
    document.documentElement.dataset.desktopFrame = fullscreen ? 'fullscreen' : 'caption';
    void windowApi.setDecorations(false).catch((error) => {
      console.error(error);
      delete document.documentElement.dataset.desktopFrame;
      setWindowApi(null);
    });
    return () => {
      delete document.documentElement.dataset.desktopFrame;
    };
  }, [windowApi, fullscreen]);

  if (!windowApi || fullscreen) return null;
  const run = (action: () => Promise<unknown>) => {
    void action().catch(console.error);
  };
  return (
    <div
      data-desktop-titlebar
      className="desktop-titlebar flex select-none bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
    >
      <div className="h-full flex-1" data-tauri-drag-region aria-hidden="true" />
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        className="w-12 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700"
        onClick={() => run(() => windowApi.minimize())}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={maximized ? '元のサイズに戻す' : '最大化'}
        title={maximized ? '元のサイズに戻す' : '最大化'}
        className="w-12 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700"
        onClick={() => run(() => (maximized ? windowApi.unmaximize() : windowApi.maximize()))}
      >
        {maximized ? (
          <Copy size={12} aria-hidden="true" />
        ) : (
          <Square size={12} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label="閉じる"
        title="閉じる"
        className="w-12 flex items-center justify-center hover:bg-red-600 hover:text-white"
        onClick={() => run(() => windowApi.close())}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
