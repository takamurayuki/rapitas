/**
 * ApiClientBatch
 *
 * Batches multiple outgoing API requests into a single HTTP POST to /batch,
 * falling back to individual requests if the batch endpoint fails.
 */

import { API_BASE_URL } from '@/utils/api';
import type { BatchRequest, BatchResponse, RequestOptions } from './types';

type Resolver = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class ApiClientBatch {
  private pendingBatch: BatchRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchResolvers = new Map<string, Resolver>();

  /**
   * Queue a request into the next batch window (10 ms coalescing delay).
   *
   * @param path - API path relative to base URL / ベースURLからの相対パス
   * @param options - Fetch options / フェッチオプション
   * @param fetchFallback - Single-request fallback used when the batch endpoint fails / バッチ失敗時のフォールバック
   * @returns Response body typed as T / レスポンスボディ
   */
  enqueue<T>(
    path: string,
    options: RequestOptions,
    fetchFallback: (path: string, options: RequestOptions) => Promise<T>,
  ): Promise<T> {
    const id = Math.random().toString(36).substring(7);
    const request: BatchRequest = {
      id,
      method: options.method || 'GET',
      url: path,
      body: options.body,
    };

    return new Promise<T>((resolve, reject) => {
      this.batchResolvers.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pendingBatch.push(request);

      if (this.batchTimeout) clearTimeout(this.batchTimeout);

      // Wait 10ms before flushing — allows concurrent callers to join the same batch
      this.batchTimeout = setTimeout(() => {
        this.flush(fetchFallback);
      }, 10);
    });
  }

  private async flush(
    fetchFallback: (path: string, options: RequestOptions) => Promise<unknown>,
  ): Promise<void> {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.batchTimeout = null;

    try {
      const response = await fetch(`${API_BASE_URL}/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: batch }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.status}`);
      }

      const results: BatchResponse[] = await response.json();

      results.forEach((result) => {
        const resolver = this.batchResolvers.get(result.id);
        if (resolver) {
          if (result.error) {
            resolver.reject(new Error(result.error));
          } else {
            resolver.resolve(result.body);
          }
          this.batchResolvers.delete(result.id);
        }
      });
    } catch {
      // Retry each request individually when the entire batch endpoint fails
      batch.forEach(async (request) => {
        const resolver = this.batchResolvers.get(request.id);
        if (resolver) {
          try {
            const result = await fetchFallback(request.url, {
              method: request.method,
              body: request.body as BodyInit | undefined,
            });
            resolver.resolve(result);
          } catch (err) {
            resolver.reject(err);
          }
          this.batchResolvers.delete(request.id);
        }
      });
    }
  }
}
