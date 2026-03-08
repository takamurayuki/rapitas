/**
 * 学習セッションタイマー用カスタムフック
 * 経過時間の計測、一時停止・再開・リセット機能を提供する
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useStudyTimer');

export function useStudyTimer() {
  const [elapsed, setElapsed] = useState(0); // 経過秒数
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (isRunning && !isPaused) return;
    logger.info('Study timer started');
    clearTimer();
    setIsRunning(true);
    setIsPaused(false);
    setElapsed(0);
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, [isRunning, isPaused, clearTimer]);

  const pause = useCallback(() => {
    if (!isRunning || isPaused) return;
    logger.info(`Study timer paused at ${elapsed}s`);
    clearTimer();
    setIsPaused(true);
  }, [isRunning, isPaused, elapsed, clearTimer]);

  const resume = useCallback(() => {
    if (!isRunning || !isPaused) return;
    logger.info('Study timer resumed');
    setIsPaused(false);
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, [isRunning, isPaused]);

  const reset = useCallback(() => {
    logger.info('Study timer reset');
    clearTimer();
    setElapsed(0);
    setIsRunning(false);
    setIsPaused(false);
  }, [clearTimer]);

  // クリーンアップ
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return { elapsed, isRunning, isPaused, start, pause, resume, reset };
}
