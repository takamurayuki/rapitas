'use client';

/**
 * ConfirmDialogProvider
 *
 * Global context that provides a Promise-based confirm() function as a
 * drop-in replacement for the browser-native window.confirm(). Renders the
 * single shared ConfirmDialog at the root level, keeping callers free of
 * per-component state boilerplate.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog';

/** Function signature for the confirm() hook return value. */
export type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | undefined>(undefined);

interface ConfirmState {
  config: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Provides the confirm() function to all descendant components.
 * Must be placed inside ToastProvider so ConfirmDialog can use toasts if needed.
 *
 * @param children - Descendant components / 子コンポーネント
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  // NOTE: useCallback with empty deps — stable reference so consumers can add
  // `confirm` to their useCallback deps without triggering re-renders.
  const confirm = useCallback((optionsOrMessage: ConfirmOptions | string): Promise<boolean> => {
    const config =
      typeof optionsOrMessage === 'string' ? { message: optionsOrMessage } : optionsOrMessage;
    return new Promise<boolean>((resolve) => {
      setState({ config, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          open={true}
          config={state.config}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

/**
 * Returns the global confirm() function. Must be called inside ConfirmDialogProvider.
 *
 * @returns Promise-based confirm function / Promiseを返す確認関数
 * @throws When called outside ConfirmDialogProvider
 */
export function useConfirmDialog(): ConfirmFn {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  return ctx;
}
