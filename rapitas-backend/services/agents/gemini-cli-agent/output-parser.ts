/**
 * GeminiCliAgent — OutputParser
 *
 * Parses Gemini CLI stream-json events into human-readable output and extracts
 * artifacts and Git commit info from the accumulated output buffer.
 * Not responsible for process lifecycle or question detection.
 */

import type { GeminiStreamEvent } from './types';
import type { AgentArtifact, GitCommitInfo } from '../base-agent';
import { canonicalToolName } from '../common/tool-name-canonicalizer';

/**
 * Parse a single Gemini stream-json event into a display string.
 *
 * @param json - Parsed stream event object / ストリームイベントオブジェクト
 * @param activeTools - Map of active tool calls keyed by tool ID / アクティブなツール呼び出しマップ
 * @param sessionState - Mutable object to update session/checkpoint IDs / セッション/チェックポイントIDを更新するオブジェクト
 * @returns Display text to emit, or empty string if nothing to show
 */
export function parseStreamEvent(
  json: GeminiStreamEvent,
  activeTools: Map<string, { name: string; startTime: number; info: string }>,
  sessionState: { sessionId: string | null; checkpointId: string | null },
): string {
  let displayOutput = '';

  switch (json.type) {
    case 'assistant':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'text' && block.text) {
            displayOutput += block.text;
          } else if (block.type === 'tool_use') {
            // Canonicalise tool names so the frontend log-pattern table
            // (which knows Claude's vocabulary) matches Gemini output too.
            const canonicalName = canonicalToolName(block.name);
            const toolInfo = formatToolInfo(block.name || 'unknown', block.input);
            displayOutput += `\n[Tool: ${canonicalName}] ${toolInfo}\n`;
            if (block.id) {
              activeTools.set(block.id, {
                name: canonicalName,
                startTime: Date.now(),
                info: toolInfo,
              });
            }
          }
        }
      }
      break;

    case 'user':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const toolId = block.tool_use_id;
            const activeTool = activeTools.get(toolId);

            if (activeTool) {
              const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
              if (block.is_error) {
                displayOutput += `[Tool Error: ${activeTool.name}] (${duration}s)\n`;
              } else {
                displayOutput += `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
              }
              activeTools.delete(toolId);
            }
          }
        }
      }
      break;

    case 'result':
      if (json.result) {
        const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
        const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
        displayOutput += `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;
        if (typeof json.result === 'string') {
          displayOutput += json.result + '\n';
        }
      }
      break;

    case 'system':
      if (json.session_id) {
        sessionState.sessionId = json.session_id;
      }
      if (json.checkpoint_id) {
        sessionState.checkpointId = json.checkpoint_id;
      }

      if (json.subtype === 'error' || json.error) {
        displayOutput += `[System Error: ${json.error || json.subtype || 'unknown'}]\n`;
      } else if (json.subtype !== 'init') {
        displayOutput += `[System: ${json.subtype || 'info'}]\n`;
      }
      break;
  }

  return displayOutput;
}

/**
 * Format tool call input into a human-readable info string.
 *
 * @param toolName - Name of the Gemini CLI tool / ツール名
 * @param input - Tool input parameters / ツール入力パラメータ
 * @returns Short descriptive string for display
 */
export function formatToolInfo(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';

  try {
    switch (toolName) {
      // Gemini CLI built-in tools
      case 'ReadFile':
      case 'Read':
        return input.file_path || input.path
          ? `-> ${String(input.file_path || input.path)
              .split(/[/\\]/)
              .pop()}`
          : '';
      case 'WriteFile':
      case 'Write':
        return input.file_path || input.path
          ? `-> ${String(input.file_path || input.path)
              .split(/[/\\]/)
              .pop()}`
          : '';
      case 'Edit':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'FindFiles':
      case 'Glob':
        return input.pattern ? `pattern: ${input.pattern}` : '';
      case 'SearchText':
      case 'Grep':
        return input.pattern || input.query ? `pattern: ${input.pattern || input.query}` : '';
      case 'Shell':
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
      }
      case 'GoogleSearch':
        return input.query ? `"${input.query}"` : '';
      case 'WebFetch':
        return input.url ? `-> ${String(input.url).substring(0, 40)}...` : '';
      case 'CodebaseInvestigatorAgent':
        return input.query ? `"${input.query}"` : '';
      case 'SaveMemory':
        return input.key ? `key: ${input.key}` : '';
      case 'WriteTodos':
        return input.todos ? `${(input.todos as unknown[]).length} items` : '';
      default: {
        // NOTE: Serialize object/array values as JSON to avoid "[object Object]"
        const firstKey = Object.keys(input)[0];
        if (firstKey && input[firstKey] != null) {
          const raw = input[firstKey];
          const val = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
          return val.length > 80 ? `${val.substring(0, 80)}...` : val;
        }
        return '';
      }
    }
  } catch {
    return '';
  }
}

/**
 * Parse artifacts (file changes, diffs) from accumulated output text.
 *
 * @param output - Full output buffer string / 出力バッファ全体
 * @returns Array of detected artifacts
 */
export function parseArtifacts(output: string): AgentArtifact[] {
  const artifacts: AgentArtifact[] = [];

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

/**
 * Parse Git commit hashes from accumulated output text.
 *
 * @param output - Full output buffer string / 出力バッファ全体
 * @returns Array of detected Git commit info objects
 */
export function parseCommits(output: string): GitCommitInfo[] {
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

/**
 * Check whether a raw output line is non-JSON noise that should be filtered.
 * Applies to Windows chcp command output and similar.
 *
 * @param line - Raw output line / 生出力行
 * @returns true if the line should be discarded
 */
export function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    !trimmed ||
    /^Active code page:/i.test(trimmed) ||
    /^現在のコード ページ:/i.test(trimmed) ||
    /^chcp\s/i.test(trimmed)
  );
}
