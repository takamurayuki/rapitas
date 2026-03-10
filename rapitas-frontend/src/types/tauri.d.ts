// Tauri API の型定義
declare global {
  interface Window {
    __TAURI__?: {
      event: {
        listen: (
          event: string,
          handler: (event: { payload: unknown }) => void,
        ) => Promise<() => void>;
        emit: (event: string, payload?: unknown) => Promise<void>;
      };
      window: {
        getCurrent: () => TauriWindow;
      };
      core?: {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      // 他のTauri APIも必要に応じて追加
    };
  }
}

// Tauri Windowオブジェクトの基本型定義
interface TauriWindow {
  label: string;
  scaleFactor: number;
  innerPosition: { x: number; y: number };
  outerPosition: { x: number; y: number };
  innerSize: { width: number; height: number };
  outerSize: { width: number; height: number };
  isFullscreen: boolean;
  isMaximized: boolean;
  isMinimized: boolean;
  isResizable: boolean;
  isVisible: boolean;
  title: string;
  isFocused: boolean;
}

export {};
