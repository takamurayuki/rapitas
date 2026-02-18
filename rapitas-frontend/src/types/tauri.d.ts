// Tauri API の型定義
declare global {
  interface Window {
    __TAURI__?: {
      event: {
        listen: (
          event: string,
          handler: (event: any) => void
        ) => Promise<() => void>;
        emit: (event: string, payload?: any) => Promise<void>;
      };
      window: {
        getCurrent: () => any;
      };
      // 他のTauri APIも必要に応じて追加
    };
  }
}

export {};