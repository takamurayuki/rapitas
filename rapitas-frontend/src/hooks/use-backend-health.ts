"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "@/utils/api";

type BackendHealthStatus = "connected" | "disconnected" | "checking";

type UseBackendHealthOptions = {
  /** ヘルスチェック間隔（ミリ秒）。デフォルト: 5000 */
  intervalMs?: number;
  /** 切断検知後のリトライ間隔（ミリ秒）。デフォルト: 2000 */
  retryIntervalMs?: number;
  /** 再接続時に呼ばれるコールバック */
  onReconnect?: () => void;
  /** 切断時に呼ばれるコールバック */
  onDisconnect?: () => void;
};

/**
 * バックエンドの接続状態を監視し、再起動後の復帰を検知するフック。
 * 切断→復帰を検知した場合に onReconnect コールバックを呼び出す。
 */
export function useBackendHealth(options: UseBackendHealthOptions = {}) {
  const {
    intervalMs = 5000,
    retryIntervalMs = 2000,
    onReconnect,
    onDisconnect,
  } = options;

  const [status, setStatus] = useState<BackendHealthStatus>("checking");
  const wasDisconnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  const onDisconnectRef = useRef(onDisconnect);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    onDisconnectRef.current = onDisconnect;
  }, [onDisconnect]);

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${API_BASE_URL}/events/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        if (wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          onReconnectRef.current?.();
        }
        setStatus("connected");
      } else {
        if (!wasDisconnectedRef.current) {
          wasDisconnectedRef.current = true;
          onDisconnectRef.current?.();
        }
        setStatus("disconnected");
      }
    } catch {
      if (!wasDisconnectedRef.current) {
        wasDisconnectedRef.current = true;
        onDisconnectRef.current?.();
      }
      setStatus("disconnected");
    }
  }, []);

  // status に応じて間隔を切り替える単一のインターバル
  useEffect(() => {
    checkHealth();

    const currentInterval =
      status === "disconnected" ? retryIntervalMs : intervalMs;
    const timer = setInterval(checkHealth, currentInterval);

    return () => clearInterval(timer);
  }, [checkHealth, status, intervalMs, retryIntervalMs]);

  return { status, isConnected: status === "connected" };
}
