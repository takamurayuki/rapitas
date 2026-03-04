'use client';

import { useState, useCallback } from 'react';

/**
 * 非同期操作の状態
 */
export type AsyncOperationState<T> = {
  data: T | null;
  isLoading: boolean;
  error: string | null;
};

/**
 * 非同期操作フックの戻り値
 */
export type UseAsyncOperationReturn<T, Args extends unknown[]> = {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
  setData: (data: T | null) => void;
  setError: (error: string | null) => void;
};

/**
 * 非同期操作を管理する汎用フック
 *
 * @example
 * const { data, isLoading, error, execute } = useAsyncOperation(
 *   async (taskId: number) => {
 *     const res = await fetch(`/api/tasks/${taskId}`);
 *     if (!res.ok) throw new Error("Failed to fetch task");
 *     return res.json();
 *   }
 * );
 *
 * // 使用例
 * execute(123);
 */
export function useAsyncOperation<T, Args extends unknown[] = []>(
  operation: (...args: Args) => Promise<T>,
  options?: {
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  },
): UseAsyncOperationReturn<T, Args> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await operation(...args);
        setData(result);
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'エラーが発生しました';
        setError(errorMessage);
        options?.onError?.(
          err instanceof Error ? err : new Error(errorMessage),
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [operation, options],
  );

  const reset = useCallback(() => {
    setData(null);
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    data,
    isLoading,
    error,
    execute,
    reset,
    setData,
    setError,
  };
}

/**
 * 複数の非同期操作を管理するフック
 * 各操作に個別の状態を持つ
 */
export function useMultiAsyncOperation<
  Operations extends Record<string, (...args: unknown[]) => Promise<unknown>>,
>(operations: Operations) {
  type OperationKeys = keyof Operations;
  type OperationStates = {
    [K in OperationKeys]: AsyncOperationState<
      Awaited<ReturnType<Operations[K]>>
    >;
  };

  const [states, setStates] = useState<OperationStates>(() => {
    const initialStates = {} as OperationStates;
    for (const key of Object.keys(operations) as OperationKeys[]) {
      initialStates[key] = {
        data: null,
        isLoading: false,
        error: null,
      } as OperationStates[typeof key];
    }
    return initialStates;
  });

  const execute = useCallback(
    async <K extends OperationKeys>(
      key: K,
      ...args: Parameters<Operations[K]>
    ): Promise<Awaited<ReturnType<Operations[K]>> | null> => {
      setStates((prev) => ({
        ...prev,
        [key]: { ...prev[key], isLoading: true, error: null },
      }));

      try {
        const result = await (
          operations[key] as (...args: unknown[]) => Promise<unknown>
        )(...args);
        setStates((prev) => ({
          ...prev,
          [key]: { data: result, isLoading: false, error: null },
        }));
        return result as Awaited<ReturnType<Operations[K]>>;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'エラーが発生しました';
        setStates((prev) => ({
          ...prev,
          [key]: { ...prev[key], isLoading: false, error: errorMessage },
        }));
        return null;
      }
    },
    [operations],
  );

  const reset = useCallback((key: OperationKeys) => {
    setStates((prev) => ({
      ...prev,
      [key]: { data: null, isLoading: false, error: null },
    }));
  }, []);

  const resetAll = useCallback(() => {
    setStates((prev) => {
      const newStates = { ...prev };
      for (const key of Object.keys(prev) as OperationKeys[]) {
        newStates[key] = {
          data: null,
          isLoading: false,
          error: null,
        } as OperationStates[typeof key];
      }
      return newStates;
    });
  }, []);

  return {
    states,
    execute,
    reset,
    resetAll,
  };
}

export default useAsyncOperation;
