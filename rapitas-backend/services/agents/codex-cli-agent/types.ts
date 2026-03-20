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
