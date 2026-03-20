/**
 * api-client barrel
 *
 * Re-exports all public symbols from the api-client sub-modules so that
 * existing import paths (`@/lib/api-client`) continue to work unchanged.
 */

export type { RequestOptions, BatchRequest, BatchResponse, CacheEntry } from './types';
export { ApiClientCache } from './cache';
export { ApiClientBatch } from './batch';
export { APIClient } from './client';

import { APIClient } from './client';

// Singleton instance shared across the application
export const apiClient = new APIClient();

// Convenience function bindings — mirrors the original api-client.ts exports
export const apiFetch = apiClient.fetch.bind(apiClient);
export const batchFetch = apiClient.batchFetch.bind(apiClient);
export const debouncedFetch = apiClient.debouncedFetch.bind(apiClient);
export const throttledFetch = apiClient.throttledFetch.bind(apiClient);
export const parallelFetch = apiClient.parallelFetch.bind(apiClient);
export const prefetch = apiClient.prefetch.bind(apiClient);
export const clearApiCache = apiClient.clearCache.bind(apiClient);
