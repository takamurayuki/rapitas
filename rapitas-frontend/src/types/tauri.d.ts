// Tauri API type definitions
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
      // Add other Tauri APIs as needed
    };
  }
}

// Basic type definition for Tauri Window object
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
