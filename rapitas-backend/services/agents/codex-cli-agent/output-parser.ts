/**
 * CodexCliAgent — Output Parser
 *
 * Parses Codex CLI stdout text to extract artifacts (file changes, diffs)
 * and git commit references. Also formats tool call info into human-readable strings.
 * Not responsible for streaming, process management, or prompt building.
 */

import type { AgentArtifact, GitCommitInfo } from '../base-agent';

/**
 * Parse artifacts (file changes and diffs) from Codex CLI output text.
 *
 * @param output - Full stdout collected from the Codex CLI process / Codex CLIプロセスから収集したstdout
 * @returns List of file and diff artifacts / ファイルおよびdiffアーティファクトのリスト
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
 * Parse Git commit hashes referenced in Codex CLI output text.
 *
 * @param output - Full stdout collected from the Codex CLI process / Codex CLIプロセスから収集したstdout
 * @returns List of detected git commit objects (message/branch/stats left empty) / 検出されたgitコミットオブジェクトのリスト
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
 * Format a tool call's input object into a compact human-readable string for display.
 *
 * @param toolName - Name of the tool that was called / 呼び出されたツールの名前
 * @param input - Tool input arguments / ツールの入力引数
 * @returns Human-readable summary of the tool call / ツール呼び出しの人間が読める要約
 */
export function formatToolInfo(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';

  try {
    switch (toolName) {
      case 'Read':
      case 'ReadFile':
        return input.file_path || input.path
          ? `-> ${String(input.file_path || input.path)
              .split(/[/\\]/)
              .pop()}`
          : '';
      case 'Write':
      case 'WriteFile':
        return input.file_path || input.path
          ? `-> ${String(input.file_path || input.path)
              .split(/[/\\]/)
              .pop()}`
          : '';
      case 'Edit':
        return input.file_path ? `-> ${String(input.file_path).split(/[/\\]/).pop()}` : '';
      case 'Glob':
      case 'FindFiles':
        return input.pattern ? `pattern: ${input.pattern}` : '';
      case 'Grep':
      case 'SearchText':
        return input.pattern || input.query ? `pattern: ${input.pattern || input.query}` : '';
      case 'Shell':
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 50 ? `$ ${cmd.substring(0, 50)}...` : `$ ${cmd}`;
      }
      case 'WebSearch':
        return input.query ? `"${input.query}"` : '';
      case 'WebFetch':
        return input.url ? `-> ${String(input.url).substring(0, 40)}...` : '';
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
