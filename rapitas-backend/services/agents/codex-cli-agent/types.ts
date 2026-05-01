/**
 * CodexCliAgent — Types and Utilities
 *
 * Shared type definitions and platform utility for the CodexCliAgent module.
 * Not responsible for process spawning or output parsing.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

/** Configuration for the CodexCliAgent. */
export type CodexCliAgentConfig = {
  workingDirectory?: string;
  model?: string;
  timeout?: number;
  apiKey?: string;
  fullAuto?: boolean;
  yolo?: boolean;
  resumeSessionId?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Approval policy mirror of `--ask-for-approval`. When set, this overrides
   * the implicit policy from `--full-auto`. Use `never` for non-interactive
   * read-only investigation runs.
   */
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  /**
   * Path to which Codex should write its final assistant message via the
   * `-o / --output-last-message` flag. Used by research/plan/review phases
   * so the agent's output is captured as a file even though it cannot
   * modify the workspace.
   */
  outputLastMessageFile?: string;
  /**
   * When true, codex is treated as an investigation-only agent for the
   * current execution: skip `--full-auto`, use `--sandbox=read-only`, set
   * `--ask-for-approval=never`, and write final output via `-o` if
   * `outputLastMessageFile` is provided. The result is a Markdown report
   * with NO code changes possible at the OS level.
   */
  investigationMode?: boolean;
  /**
   * Which kind of artifact the investigation should produce. Drives the
   * positional headline given to `codex exec` so the agent knows whether
   * its final message must start with `# 調査レポート`, `# 実装計画`, or
   * `# レビュー指摘`. Defaults to `research` when omitted to preserve
   * the original behaviour of the researcher role.
   */
  investigationOutputType?: 'research' | 'plan' | 'review' | 'verify';
};

/**
 * Resolve the absolute path of a CLI tool on Windows using `where`.
 * Returns the original name unchanged on non-Windows platforms.
 *
 * @param cliName - Name of the CLI executable / CLI実行ファイル名
 * @returns Resolved absolute path on Windows, or cliName on other platforms / WindowsではAbsoluteパス、それ以外ではcliName
 */
export function resolveCliPath(cliName: string): string {
  if (process.platform !== 'win32') return cliName;
  try {
    const resolved = execSync(`where ${cliName}`, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
    if (resolved && existsSync(resolved)) {
      return resolved;
    }
  } catch {}
  return cliName;
}
