/**
 * Common Hooks
 *
 * Re-exports all general-purpose utility hooks for convenient importing.
 */
export { useAsyncOperation, useMultiAsyncOperation } from './useAsyncOperation';
export type { AsyncOperationState, UseAsyncOperationReturn } from './useAsyncOperation';
export { useDebounce } from './useDebounce';
export { useLocalStorageState } from './useLocalStorageState';
export { useSSE } from './useSse';
export type { SSEEventType, SSEEvent, SSEProgressData, SSERetryData, SSERollbackData, SSEErrorData, UseSSEOptions, UseSSEReturn } from './useSse';
export { useBackendHealth } from './useBackendHealth';
export { useBrowserNotifications } from './useBrowserNotifications';
export { useOfflineQueue } from './useOfflineQueue';
export { useSpeechRecognition } from './useSpeechRecognition';
export { useTauriVoice } from './useTauriVoice';
