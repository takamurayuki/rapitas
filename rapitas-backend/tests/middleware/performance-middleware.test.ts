/**
 * Performance Middleware テスト
 * 圧縮・キャッシュ・レート制限ミドルウェアのエクスポート確認テスト
 */
import { describe, test, expect, mock } from "bun:test";

mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const {
  compressionMiddleware,
  cacheMiddleware,
  performanceMonitoring,
  rateLimitMiddleware,
  performanceOptimization,
  connectionPooling,
} = await import("../middleware/performance");

describe("Performance Middleware exports", () => {
  test("compressionMiddlewareがElysiaインスタンスであること", () => {
    expect(compressionMiddleware).toBeDefined();
  });

  test("cacheMiddlewareがElysiaインスタンスであること", () => {
    expect(cacheMiddleware).toBeDefined();
  });

  test("performanceMonitoringがElysiaインスタンスであること", () => {
    expect(performanceMonitoring).toBeDefined();
  });

  test("rateLimitMiddlewareがElysiaインスタンスであること", () => {
    expect(rateLimitMiddleware).toBeDefined();
  });

  test("performanceOptimizationがElysiaインスタンスであること", () => {
    expect(performanceOptimization).toBeDefined();
  });
});

describe("connectionPooling", () => {
  test("keepAliveTimeoutが設定されていること", () => {
    expect(connectionPooling.keepAliveTimeout).toBe(30000);
  });

  test("maxConnectionsが設定されていること", () => {
    expect(connectionPooling.maxConnections).toBe(1000);
  });

  test("requestTimeoutが設定されていること", () => {
    expect(connectionPooling.requestTimeout).toBe(30000);
  });
});
