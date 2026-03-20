/**
 * Gemini CLI Provider — Types
 *
 * Shared type definitions for the Gemini CLI provider and agent.
 * Does not contain runtime logic.
 */

import type { GeminiCliProviderConfig } from '../abstraction/types';

/**
 * Gemini CLI provider configuration
 */
export interface GeminiCliConfig extends GeminiCliProviderConfig {
  workingDirectory?: string;
  /** e.g. gemini-2.0-flash, gemini-1.5-flash */
  model?: string;
  timeout?: number;
  maxTokens?: number;
}

/**
 * Gemini CLI stream-json event type.
 * Maps to the objects emitted on stdout when `--output-format stream-json` is set.
 */
export interface GeminiStreamEvent {
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
}

/**
 * Parsed output of a single stream event.
 */
export interface StreamEventResult {
  output: string;
  sessionId?: string;
  checkpointId?: string;
  isQuestion?: boolean;
  questionText?: string;
}

/**
 * Parses a single Gemini CLI stream-json event into a normalised result.
 *
 * @param json - The parsed JSON event object / パース済みJSONイベントオブジェクト
 * @returns Normalised output and metadata / 正規化された出力とメタデータ
 */
export function processStreamEvent(json: GeminiStreamEvent): StreamEventResult {
  let output = '';
  let sessionId: string | undefined;
  let checkpointId: string | undefined;
  let isQuestion = false;
  let questionText = '';

  switch (json.type) {
    case 'assistant':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'text' && block.text) {
            output += block.text;
          } else if (block.type === 'tool_use') {
            if (block.name === 'AskUserQuestion' || block.name === 'ask_user' || block.name === 'ask') {
              isQuestion = true;
              const input = block.input as { questions?: Array<{ question?: string }> } | undefined;
              if (input?.questions?.[0]?.question) questionText = input.questions[0].question;
              output += `\n[質問] ${questionText}\n`;
            } else {
              output += `\n[Tool: ${block.name}]\n`;
            }
          }
        }
      }
      break;
    case 'user':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'tool_result') {
            output += block.is_error ? `[Tool Error]\n` : `[Tool Done]\n`;
          }
        }
      }
      break;
    case 'system':
      if (json.session_id) sessionId = json.session_id;
      if (json.checkpoint_id) checkpointId = json.checkpoint_id;
      if (json.subtype === 'error' || json.error) {
        output += `[System Error: ${json.error || json.subtype || 'unknown'}]\n`;
      }
      break;
    case 'result':
      if (json.result && typeof json.result === 'string') {
        const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
        const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
        output += `\n[Result: completed${duration}${cost}]\n${json.result}\n`;
      }
      break;
  }

  return { output, sessionId, checkpointId, isQuestion, questionText };
}
