/**
 * Dedicated Worker thread for output parsing
 *
 * Analyzes stdout output from Claude CLI, executes JSON parsing, artifact extraction,
 * commit detection, question detection and sends results to main thread
 */

declare var self: Worker;

import { detectQuestionFromToolCall } from '../services/agents/question-detection';

// ==================== Type definitions ====================

export type QuestionCategory = 'clarification' | 'confirmation' | 'selection';

export type QuestionDetectionMethod = 'tool_call' | 'key_based' | 'none';

interface QuestionDetails {
  category: QuestionCategory;
  detectionMethod: QuestionDetectionMethod;
  questionText: string;
  options?: string[];
  metadata?: Record<string, unknown>;
}

interface WaitingQuestionState {
  questionKey: string;
  questionType: QuestionDetectionMethod;
  questionDetails: QuestionDetails;
  timestamp: Date;
  timeoutSeconds: number;
}

interface ToolInfo {
  name: string;
  startTime: number;
  info: string;
}

interface AgentArtifact {
  type: 'file' | 'diff';
  name: string;
  content: string;
  path?: string;
}

interface GitCommitInfo {
  hash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

// ==================== Message protocol ====================

// Input message types
type WorkerInputMessage =
  | { type: 'configure'; config: { logPrefix?: string; timeoutSeconds: number } }
  | { type: 'parse-chunk'; data: string }
  | { type: 'parse-complete'; outputBuffer: string }
  | { type: 'terminate' };

// Output message types
type WorkerOutputMessage =
  | { type: 'system-event'; data: { sessionId?: string; error?: string } }
  | {
      type: 'assistant-message';
      data: { text: string; tools: Array<{ name: string; id: string; info: string }> };
    }
  | {
      type: 'user-message';
      data: {
        toolResults: Array<{ id: string; name: string; duration: number; isError: boolean }>;
      };
    }
  | { type: 'result'; data: { duration?: number; cost?: number; sessionId?: string } }
  | { type: 'question-detected'; data: WaitingQuestionState & { questionText: string } }
  | { type: 'artifacts-parsed'; data: { artifacts: AgentArtifact[] } }
  | { type: 'commits-parsed'; data: { commits: GitCommitInfo[] } }
  | { type: 'tool-tracking'; data: { hasFileModifyingTools: boolean; toolName: string } }
  | { type: 'error'; error: string };

// ==================== Worker internal state ====================

let lineBuffer = '';
const activeTools = new Map<string, ToolInfo>();
const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
let config: { logPrefix?: string; timeoutSeconds: number } = { timeoutSeconds: 300 };

// ==================== Artifact and commit parsing ====================

function parseArtifacts(output: string): AgentArtifact[] {
  const artifacts: AgentArtifact[] = [];

  // Detect file creation/editing patterns
  const filePatterns = [
    /(?:Created|Modified|Wrote to|Writing to)[:\s]+([^\n]+)/gi,
    /File: ([^\n]+)/gi,
  ];

  for (const pattern of filePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output)) !== null) {
      const captured = match[1];
      if (!captured) continue;
      const filePath = captured.trim();
      if (filePath && !filePath.includes('...')) {
        artifacts.push({
          type: 'file',
          name: filePath.split('/').pop() || filePath,
          content: '',
          path: filePath,
        });
      }
    }
  }

  // Detect diff output
  const diffPattern = /```diff\n([\s\S]*?)```/g;
  let diffMatch;
  while ((diffMatch = diffPattern.exec(output)) !== null) {
    artifacts.push({
      type: 'diff',
      name: 'changes.diff',
      content: diffMatch[1] || '',
    });
  }

  return artifacts;
}

function parseCommits(output: string): GitCommitInfo[] {
  const commits: GitCommitInfo[] = [];

  const commitPattern = /(?:Committed|commit)\s+([a-f0-9]{7,40})/gi;
  let match;
  while ((match = commitPattern.exec(output)) !== null) {
    commits.push({
      hash: match[1] || '',
      message: '',
      branch: '',
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    });
  }

  return commits;
}

interface WorkerToolUse {
  id: string;
  name: string;
  info: string;
  isFileModifying: boolean;
}

interface WorkerToolResult {
  toolUseId: string;
  isError: boolean;
}

// ==================== Tool information formatting ====================

function formatToolInfo(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';

  try {
    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'Glob':
      case 'Grep':
        return input.pattern ? `pattern: ${input.pattern}` : '';
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
      }
      case 'Task':
        return input.description ? String(input.description) : '';
      case 'WebFetch':
        return input.url ? `-> ${String(input.url).substring(0, 40)}...` : '';
      case 'WebSearch':
        return input.query ? `"${input.query}"` : '';
      case 'LSP':
        return input.operation ? String(input.operation) : '';
      default: {
        const firstKey = Object.keys(input)[0];
        if (firstKey && input[firstKey]) {
          const val = String(input[firstKey]);
          return val.length > 40 ? `${val.substring(0, 40)}...` : val;
        }
        return '';
      }
    }
  } catch {
    return '';
  }
}

// ==================== JSON line parsing ====================

function processLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const json = JSON.parse(trimmed);
    const prefix = config.logPrefix || '[Worker]';

    switch (json.type) {
      case 'assistant':
        processAssistantMessage(json, prefix);
        break;
      case 'user':
        processUserMessage(json);
        break;
      case 'result':
        processResultEvent(json);
        break;
      case 'system':
        processSystemEvent(json, prefix);
        break;
      default:
        // Unknown event type - log only
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
    // Output non-JSON lines as is
    postResult({
      type: 'raw-output',
      displayOutput: line + '\n',
    });
  }
}

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
  cost_usd?: number;
  session_id?: string;
  error?: string;
}

function processAssistantMessage(json: ParsedJsonMessage, prefix: string): void {
  let displayOutput = '';
  const toolUses: WorkerToolUse[] = [];
  let hasFileModifying = false;

  if (json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === 'text' && block.text) {
        displayOutput += block.text;
      } else if (block.type === 'tool_use') {
        if (block.name === 'AskUserQuestion') {
          // AskUserQuestion detection
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
          // Regular tool call
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

function processUserMessage(json: ParsedJsonMessage): void {
  let displayOutput = '';
  const toolResults: WorkerToolResult[] = [];

  if (json.message?.content) {
    for (const block of json.message.content) {
      if (block.type === 'tool_result') {
        const toolId = block.tool_use_id;
        const activeTool = toolId ? activeTools.get(toolId) : undefined;

        if (activeTool) {
          const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
          if (block.is_error) {
            displayOutput += `[Tool Error: ${activeTool.name}] (${duration}s)\n`;
          } else {
            displayOutput += `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
          }
          activeTools.delete(toolId!);
        } else {
          const toolIdShort = toolId ? `ID: ${toolId.substring(0, 8)}...` : '';
          if (block.is_error) {
            displayOutput += `[Tool Error ${toolIdShort}]\n`;
          } else {
            displayOutput += `[Tool Done ${toolIdShort}]\n`;
          }
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

function processResultEvent(json: ParsedJsonMessage): void {
  let displayOutput = '';

  if (json.result !== undefined) {
    const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
    const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
    displayOutput += `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;
    if (json.result && typeof json.result === 'string') {
      displayOutput += json.result + '\n';
    }
  }

  postResult({
    type: 'result-event',
    displayOutput,
    subtype: json.subtype,
    durationMs: json.duration_ms,
    costUsd: json.cost_usd,
    result: typeof json.result === 'string' ? json.result : undefined,
  });
}

function processSystemEvent(json: ParsedJsonMessage, prefix: string): void {
  let displayOutput = '';
  let sessionId: string | undefined;
  let sessionMismatchWarning: string | undefined;

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
    sessionMismatchWarning,
  });
}

// ==================== Main message handler ====================

interface WorkerPostMessage {
  type: string;
  displayOutput?: string;
  toolUses?: WorkerToolUse[];
  toolResults?: WorkerToolResult[];
  detectionResult?: WaitingQuestionState & { questionText: string };
  hasFileModifyingToolCalls?: boolean;
  subtype?: string;
  sessionId?: string;
  errorMessage?: string;
  sessionMismatchWarning?: string;
  durationMs?: number;
  costUsd?: number;
  result?: string;
  data?: { artifacts: AgentArtifact[] } | { commits: GitCommitInfo[] };
  remainingBuffer?: string;
  message?: string;
  stack?: string;
}

function postResult(msg: WorkerPostMessage): void {
  self.postMessage(msg);
}

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'configure':
        config = msg.config;
        break;

      case 'parse-chunk': {
        // Add chunks to buffer and process complete lines
        lineBuffer += msg.data;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep last incomplete line

        for (const line of lines) {
          processLine(line);
        }
        break;
      }

      case 'parse-complete': {
        // Flush remaining buffer
        if (lineBuffer.trim()) {
          processLine(lineBuffer);
        }

        // Parse artifacts and commits from outputBuffer
        const artifacts = msg.outputBuffer ? parseArtifacts(msg.outputBuffer) : [];
        const commits = msg.outputBuffer ? parseCommits(msg.outputBuffer) : [];

        if (artifacts.length > 0) {
          postResult({
            type: 'artifacts-parsed',
            data: { artifacts },
          });
        }
        if (commits.length > 0) {
          postResult({
            type: 'commits-parsed',
            data: { commits },
          });
        }

        postResult({
          type: 'parse-complete',
          remainingBuffer: lineBuffer,
        });
        lineBuffer = '';
        activeTools.clear();
        break;
      }

      case 'terminate':
        // Worker termination (stopped by worker.terminate() from main thread)
        lineBuffer = '';
        activeTools.clear();
        // Only reset state since self.close() doesn't exist in Bun Worker
        process.exit(0);
        break;
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    postResult({
      type: 'error',
      message: err.message,
      stack: err.stack,
    });
  }
};
