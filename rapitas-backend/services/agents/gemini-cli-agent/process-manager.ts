/**
 * GeminiCliAgent — ProcessManager
 *
 * Handles spawning, stopping, pausing, and resuming the Gemini CLI child process.
 * Not responsible for parsing CLI output or building prompts.
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync } from 'fs';
import type { GeminiCliAgentConfig } from './types';
import { createLogger } from '../../../config/logger';

const logger = createLogger('gemini-cli-agent:process-manager');

/**
 * Resolve the full path to the Gemini CLI executable on Windows.
 *
 * @param cliName - Executable name to resolve / 解決するCLI名
 * @returns Resolved full path on Windows, or the original name on other platforms
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

/**
 * Build the spawn arguments array for the Gemini CLI.
 *
 * IMPORTANT: The prompt itself is not passed in `args` any more — long
 * multi-line workflow prompts get truncated when serialised through
 * `shell: true` on Windows, which is why Gemini was responding to only
 * the first line ("use Japanese") and idling. The prompt is instead
 * piped via stdin in `spawnGeminiProcess`. The Gemini CLI auto-detects
 * piped stdin and consumes the body as the user prompt without entering
 * interactive mode.
 *
 * @param config - Agent configuration / エージェント設定
 * @param resumeId - Optional checkpoint/session ID to resume from / 再開用チェックポイントID
 * @returns Array of CLI argument strings
 */
export function buildCliArgs(config: GeminiCliAgentConfig, resumeId?: string | null): string[] {
  const args: string[] = [];

  // Pass `-p` (with empty value) to trigger headless / non-interactive
  // mode. Without it, Gemini CLI starts an interactive REPL on Windows
  // that loads `node-pty` and crashes with `AttachConsole failed`.
  // Per `gemini --help`, the `-p` value is "Appended to input on stdin
  // (if any)", so the real prompt body comes through the stdin pipe in
  // `spawnGeminiProcess` and the empty `-p` is a no-op suffix.
  args.push('-p', '');
  args.push('--output-format', 'stream-json');
  // Skip the workspace-trust prompt — already opted in via theme settings.
  args.push('--skip-trust');

  if (config.sandboxMode) {
    args.push('--sandbox');
  }

  if (config.yolo) {
    args.push('--yolo');
  }

  if (config.model) {
    args.push('-m', config.model);
  }

  if (resumeId) {
    args.push('--checkpoint', resumeId);
    logger.info(`[ProcessManager] Resuming from checkpoint: ${resumeId}`);
  }

  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push('--allowlist', config.allowedTools.join(','));
  }

  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--denylist', config.disallowedTools.join(','));
  }

  return args;
}

/**
 * Build the environment variables for the Gemini CLI process.
 *
 * @param config - Agent configuration / エージェント設定
 * @returns Merged environment object
 */
export function buildProcessEnv(config: GeminiCliAgentConfig): NodeJS.ProcessEnv {
  const isWindows = process.platform === 'win32';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
    TERM: 'dumb',
    // Gemini CLI refuses to run in directories it doesn't recognise as
    // "trusted" with exit code 55. Workflows operate against external
    // working directories the user has already opted into via theme
    // configuration, so flag the workspace as trusted unconditionally.
    // The user can override by setting GEMINI_CLI_TRUST_WORKSPACE=false
    // at the parent-process level if they want stricter behaviour.
    GEMINI_CLI_TRUST_WORKSPACE: process.env.GEMINI_CLI_TRUST_WORKSPACE ?? 'true',
  };

  if (config.apiKey) {
    env.GEMINI_API_KEY = config.apiKey;
    env.GOOGLE_API_KEY = config.apiKey;
  }

  if (config.projectId) {
    env.GOOGLE_CLOUD_PROJECT = config.projectId;
  }

  if (config.location) {
    env.GOOGLE_CLOUD_LOCATION = config.location;
  }

  if (isWindows) {
    env.LANG = 'en_US.UTF-8';
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    env.CHCP = '65001';
  }

  return env;
}

/**
 * Spawn the Gemini CLI process and pipe the prompt via stdin.
 *
 * The prompt is delivered through stdin rather than the `-p` flag because
 * long workflow prompts (system header + role context + file-save curl
 * snippets) get truncated when serialised through `shell: true` on
 * Windows, making Gemini reply only to the first line. Piping through
 * stdin has no length / quoting limits.
 *
 * @param geminiPath - Resolved path to the Gemini CLI executable
 * @param args - CLI argument array (must NOT contain the prompt)
 * @param workDir - Working directory for the process
 * @param env - Environment variables
 * @param prompt - User prompt to feed via stdin
 * @returns Spawned ChildProcess instance
 */
export function spawnGeminiProcess(
  geminiPath: string,
  args: string[],
  workDir: string,
  env: NodeJS.ProcessEnv,
  prompt: string,
): ChildProcess {
  const isWindows = process.platform === 'win32';

  let finalCommand: string;
  let finalArgs: string[];

  if (isWindows) {
    const argsString = args
      .map((arg) => {
        if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
          return `"${arg}"`;
        }
        return arg;
      })
      .join(' ');
    const quotedPath = geminiPath.includes(' ') ? `"${geminiPath}"` : geminiPath;
    finalCommand = `chcp 65001 >NUL 2>&1 && ${quotedPath} ${argsString}`;
    finalArgs = [];
  } else {
    finalCommand = geminiPath;
    finalArgs = args;
  }

  logger.info(
    { promptChars: prompt.length },
    `[ProcessManager] Spawning Gemini (prompt via stdin)`,
  );

  const proc = spawn(finalCommand, finalArgs, {
    cwd: workDir,
    shell: true,
    windowsHide: true, // NOTE: Prevents TCP handle inheritance — stops CLI process from inheriting port 3001 socket
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  if (proc.stdout) {
    proc.stdout.setEncoding('utf8');
  }
  if (proc.stderr) {
    proc.stderr.setEncoding('utf8');
  }

  // Feed the prompt via stdin then close it so Gemini knows the prompt
  // is complete and can begin processing instead of waiting interactively.
  if (proc.stdin) {
    proc.stdin.setDefaultEncoding('utf8');
    proc.stdin.write(prompt);
    if (!prompt.endsWith('\n')) proc.stdin.write('\n');
    proc.stdin.end();
  }

  return proc;
}

/**
 * Stop a running Gemini CLI process.
 *
 * @param proc - The child process to stop / 停止するプロセス
 * @param logPrefix - Log prefix for identification / ログ識別プレフィックス
 */
export async function stopGeminiProcess(proc: ChildProcess, logPrefix: string): Promise<void> {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    try {
      const pid = proc.pid;
      if (pid) {
        const { execSync } = require('child_process');
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        logger.info(`${logPrefix} Process ${pid} killed via taskkill`);
      }
    } catch (e) {
      logger.error({ err: e }, `${logPrefix} taskkill failed`);
      try {
        proc.kill();
      } catch (killErr) {
        logger.warn({ err: killErr }, `${logPrefix} process.kill() also failed`);
      }
    }
  } else {
    proc.kill('SIGINT');

    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!proc || proc.killed) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        if (proc && !proc.killed) {
          proc.kill('SIGTERM');
        }
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });
  }
}

/**
 * Check whether the Gemini CLI is available in PATH.
 *
 * @returns true if `gemini --version` exits with code 0 / 利用可能な場合はtrue
 */
export function checkGeminiAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const geminiPath = resolveCliPath(
      process.env.GEMINI_CLI_PATH || (isWindows ? 'gemini.cmd' : 'gemini'),
    );
    const proc = spawn(geminiPath, ['--version'], { shell: true });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 10000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}
