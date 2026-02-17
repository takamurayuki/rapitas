import { useState, useEffect, useCallback } from 'react';

// LocalStorageの読み書きを最適化するカスタムフック
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  // 初回のみLocalStorageから読み込み（クライアントサイドのみ）
  const [state, setState] = useState<T>(() => {
    // サーバーサイドレンダリング時はデフォルト値を返す
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    try {
      const item = localStorage.getItem(key);
      return item !== null && item !== 'null' ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // クライアントサイドでマウント時にlocalStorageから値を再読み込み
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const item = localStorage.getItem(key);
      if (item !== null && item !== 'null') {
        setState(JSON.parse(item));
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}" on mount:`, error);
    }
  }, [key]);

  // LocalStorageへの書き込みを最適化（デバウンスなし、即時書き込み）
  const setValue = useCallback(
    (value: T) => {
      try {
        setState(value);
        // サーバーサイドでは何もしない
        if (typeof window === 'undefined') return;

        if (value === null || value === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (error) {
        console.error(`Error saving to localStorage key "${key}":`, error);
      }
    },
    [key]
  );

  // 他のタブでの変更を検知
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setState(JSON.parse(e.newValue));
        } catch (error) {
          console.error(`Error parsing localStorage change for key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [state, setValue];
}