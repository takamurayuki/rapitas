/**
 * Communication Services — Barrel Export
 *
 * Re-exports all communication-related service modules.
 */

export * from './realtime-service';
export * from './websocket-service';
export * from './webhook-notification-service';
export * from './notification-service';
// NOTE: sse-utils also exports SSEEvent which conflicts with realtime-service.
// Exclude the duplicate and let realtime-service's SSEEvent win.
export {
  SSEStreamController,
  getUserFriendlyErrorMessage,
  formatSSEMessage,
  type SSEEventType,
} from './sse-utils';
