/**
 * realtime.types
 *
 * Type definitions for real-time communication over SSE (Server-Sent Events),
 * including execution output/status events and GitHub webhook event payloads.
 */

import type { AgentExecutionStatus } from './agent.types';

export type SSEEvent = {
  type: string;
  data: unknown;
  id?: string;
  timestamp: string;
};

export type ExecutionOutputEvent = {
  executionId: number;
  output: string;
  isError: boolean;
  timestamp: string;
};

export type ExecutionStatusEvent = {
  executionId: number;
  status: AgentExecutionStatus;
  timestamp: string;
};

export type GitHubEventData = {
  action: string;
  prNumber?: number;
  issueNumber?: number;
  title?: string;
  repo: string;
  timestamp: string;
};
