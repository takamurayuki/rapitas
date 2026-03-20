/**
 * GeminiCliAgent — Types
 *
 * Type definitions for GeminiCliAgent configuration and stream events.
 * Not responsible for process lifecycle or output parsing.
 */

export type GeminiCliAgentConfig = {
  workingDirectory?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
  projectId?: string;
  location?: string;
  apiKey?: string;
  sandboxMode?: boolean;
  checkpointId?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  yolo?: boolean;
};

/**
 * Gemini CLI stream-json event type.
 */
export type GeminiStreamEvent = {
  type: 'assistant' | 'user' | 'result' | 'system' | 'tool_use' | 'tool_result';
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      is_error?: boolean;
      tool_use_id?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  cost_usd?: number;
  session_id?: string;
  checkpoint_id?: string;
  error?: string;
};
