/**
 * Output Parser Handlers
 *
 * Processes individual JSON lines from Claude CLI stdout and dispatches
 * structured messages back to the main thread via a postResult callback.
 * Not responsible for worker state (lineBuffer, activeTools) or message routing.
 */

import { detectQuestionFromToolCall } from '../services/agents/question-detection';
import { formatToolInfo } from './output-parser-parsers';

export interface ToolInfo {
  name: string;
  startTime: number;
  info: string;
}

export interface WorkerToolUse {
  id: string;
  name: string;
  info: string;
  isFileModifying: boolean;
}

export interface WorkerToolResult {
  toolUseId: string;
  isError: boolean;
}

// NOTE: WaitingQuestionState mirrors the worker protocol shape; not exported from output-parser-types.ts.
// HACK: The detectionResult is cast via unknown because detectQuestionFromToolCall returns a
//       superset of the legacy WaitingQuestionState wire shape used by the main thread.
export type WaitingQuestionState = Record<string, unknown> & { questionText: string };

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  tool_use_id?: string;
}

interface ParsedJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    content?: ContentBlock[];
  };
  result?: unknown;
  duration_ms?: number;
  duration_api_ms?: number;
  cost_usd?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
    }
  >;
  session_id?: string;
  error?: string;
  // NOTE: json.message could also be a string in system error events
  [key: string]: unknown;
}

export type PostResultFn = (msg: Record<string, unknown>) => void;
export const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Parses a single JSON line and dispatches to the appropriate handler.
 * Non-JSON lines are forwarded as raw-output unless they match known Windows noise patterns.
 *
 * @param line - A single line from Claude CLI stdout / Claude CLI stdoutの1行
 * @param activeTools - Shared map of in-flight tool calls / 進行中のツールコールの共有マップ
 * @param config - Worker config / ワーカー設定
 * @param postResult - Send-to-main-thread callback / メインスレッドへの送信コールバック
 */
export function processLine(
  line: string,
  activeTools: Map<string, ToolInfo>,
  config: { logPrefix?: string; timeoutSeconds: number },
  postResult: PostResultFn,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const json: ParsedJsonMessage = JSON.parse(trimmed);
    const prefix = config.logPrefix || '[Worker]';

    switch (json.type) {
      case 'assistant':
        processAssistantMessage(json, prefix, activeTools, config, postResult);
        break;
      case 'user':
        processUserMessage(json, activeTools, postResult);
        break;
      case 'result':
        processResultEvent(json, postResult);
        break;
      case 'system':
        processSystemEvent(json, prefix, postResult);
        break;
      default:
        // Unknown event type — silently ignore
        break;
    }
  } catch {
    // JSON parsing failed: filter unnecessary lines
    if (
      !trimmed ||
      /^Active code page:/i.test(trimmed) ||
      /^Current code page:/i.test(trimmed) ||
      /^chcp\s/i.test(trimmed)
    ) {
      return;
    }
    // Output non-JSON lines as-is
    postResult({
      type: 'raw-output',
      displayOutput: line + '\n',
    });
  }
}

/** Handles assistant-type JSON events (text blocks and tool_use blocks). */
function processAssistantMessage(
  json: ParsedJsonMessage,
  prefix: string,
  activeTools: Map<string, ToolInfo>,
  config: { logPrefix?: string; timeoutSeconds: number },
  postResult: PostResultFn,
): void {
  let displayOutput = '';
  const toolUses: WorkerToolUse[] = [];
  let hasFileModifying = false;

  if (json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === 'text' && block.text) {
        displayOutput += block.text;
      } else if (block.type === 'tool_use') {
        if (block.name === 'AskUserQuestion') {
          const detectionResult = detectQuestionFromToolCall(
            block.name,
            block.input,
            config.timeoutSeconds,
          );

          displayOutput += `\n[Question] ${detectionResult.questionText}\n`;

          postResult({
            type: 'question-detected',
            detectionResult: detectionResult as unknown as WaitingQuestionState & {
              questionText: string;
            },
            displayOutput: `\n[Question] ${detectionResult.questionText}\n`,
          });
        } else {
          const toolName = block.name ?? '';
          const toolInfo = formatToolInfo(toolName, block.input);
          displayOutput += `\n[Tool: ${toolName}] ${toolInfo}\n`;

          if (FILE_MODIFYING_TOOLS.has(toolName)) {
            hasFileModifying = true;
          }

          if (block.id) {
            activeTools.set(block.id, {
              name: toolName,
              startTime: Date.now(),
              info: toolInfo,
            });

            toolUses.push({
              id: block.id,
              name: toolName,
              info: toolInfo,
              isFileModifying: FILE_MODIFYING_TOOLS.has(toolName),
            });
          }
        }
      }
    }
  }

  if (hasFileModifying) {
    postResult({
      type: 'tool-tracking',
      hasFileModifyingToolCalls: true,
    });
  }

  if (displayOutput) {
    postResult({
      type: 'assistant-message',
      displayOutput,
      toolUses,
    });
  }
}

/** Handles user-type JSON events (tool_result blocks). */
function processUserMessage(
  json: ParsedJsonMessage,
  activeTools: Map<string, ToolInfo>,
  postResult: PostResultFn,
): void {
  let displayOutput = '';
  const toolResults: WorkerToolResult[] = [];

  if (json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === 'tool_result') {
        const toolId = block.tool_use_id;
        const activeTool = toolId ? activeTools.get(toolId) : undefined;

        if (activeTool) {
          const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
          displayOutput += block.is_error
            ? `[Tool Error: ${activeTool.name}] (${duration}s)\n`
            : `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
          activeTools.delete(toolId!);
        } else {
          const toolIdShort = toolId ? `ID: ${toolId.substring(0, 8)}...` : '';
          displayOutput += block.is_error
            ? `[Tool Error ${toolIdShort}]\n`
            : `[Tool Done ${toolIdShort}]\n`;
        }

        toolResults.push({
          toolUseId: toolId || '',
          isError: !!block.is_error,
        });
      }
    }
  }

  if (displayOutput) {
    postResult({
      type: 'user-message',
      displayOutput,
      toolResults,
    });
  }
}

/** Handles result-type JSON events (execution summary). */
function processResultEvent(json: ParsedJsonMessage, postResult: PostResultFn): void {
  let displayOutput = '';

  // NOTE: stream-json emits `total_cost_usd`; the older `cost_usd` field is kept
  // as a fallback for any non-stream payloads we may also process here.
  const costUsd = json.total_cost_usd ?? json.cost_usd;

  if (json.result !== undefined) {
    const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
    const cost = costUsd ? ` $${costUsd.toFixed(4)}` : '';
    displayOutput += `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;
    if (json.result && typeof json.result === 'string') {
      displayOutput += json.result + '\n';
    }
  }

  const usage = json.usage
    ? {
        inputTokens: json.usage.input_tokens ?? 0,
        outputTokens: json.usage.output_tokens ?? 0,
        cacheReadInputTokens: json.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: json.usage.cache_creation_input_tokens ?? 0,
      }
    : undefined;

  const modelUsage = json.modelUsage
    ? Object.fromEntries(
        Object.entries(json.modelUsage).map(([model, m]) => [
          model,
          {
            inputTokens: m.inputTokens ?? 0,
            outputTokens: m.outputTokens ?? 0,
            cacheReadInputTokens: m.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: m.cacheCreationInputTokens ?? 0,
            costUsd: m.costUSD ?? 0,
          },
        ]),
      )
    : undefined;

  postResult({
    type: 'result-event',
    displayOutput,
    subtype: json.subtype,
    durationMs: json.duration_ms,
    durationApiMs: json.duration_api_ms,
    costUsd,
    result: typeof json.result === 'string' ? json.result : undefined,
    usage,
    modelUsage,
  });
}

/** Handles system-type JSON events (init, error, info). */
function processSystemEvent(
  json: ParsedJsonMessage,
  prefix: string,
  postResult: PostResultFn,
): void {
  let displayOutput = '';
  let sessionId: string | undefined;

  if (json.subtype === 'init' && json.session_id) {
    sessionId = json.session_id;
  }

  if (json.subtype === 'error') {
    const errorMsg = typeof json.message === 'string' ? json.message : json.error || 'unknown';
    displayOutput = `[System Error: ${errorMsg}]\n`;
  } else {
    displayOutput = `[System: ${json.subtype || 'info'}]\n`;
  }

  postResult({
    type: 'system-event',
    subtype: json.subtype || 'info',
    sessionId,
    errorMessage:
      json.subtype === 'error'
        ? typeof json.message === 'string'
          ? json.message
          : json.error
        : undefined,
    displayOutput,
    sessionMismatchWarning: undefined,
  });
}
