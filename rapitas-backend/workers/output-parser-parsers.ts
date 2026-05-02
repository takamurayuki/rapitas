/**
 * Output Parser Parsers
 *
 * Pure functions for parsing artifacts and git commits from agent output text,
 * and for formatting tool call info into human-readable strings.
 * Not responsible for worker state or message dispatch.
 */

// ==================== Artifact and commit types (local to worker) ====================

export interface WorkerArtifact {
  type: 'file' | 'diff';
  name: string;
  content: string;
  path?: string;
}

export interface WorkerCommit {
  hash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

// ==================== Artifact parsing ====================

/**
 * Scans output text for file creation/edit patterns and diff blocks.
 *
 * @param output - Full output string from the agent / エージェントの完全な出力文字列
 * @returns Array of detected artifacts / 検出されたアーティファクトの配列
 */
export function parseArtifacts(output: string): WorkerArtifact[] {
  const artifacts: WorkerArtifact[] = [];

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

// ==================== Commit parsing ====================

/**
 * Scans output text for git commit hash patterns.
 *
 * @param output - Full output string from the agent / エージェントの完全な出力文字列
 * @returns Array of detected commit records / 検出されたコミットレコードの配列
 */
export function parseCommits(output: string): WorkerCommit[] {
  const commits: WorkerCommit[] = [];

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

// ==================== Tool information formatting ====================

/**
 * Formats tool call input into a short human-readable summary string.
 *
 * @param toolName - Name of the tool being called / 呼び出されるツールの名前
 * @param input - Tool input object / ツールの入力オブジェクト
 * @returns Short summary string, or empty string if not formattable / 短いサマリー文字列
 */
export function formatToolInfo(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
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
    // intentionally ignore - malformed input returns empty string
    return '';
  }
}
