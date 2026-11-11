/**
 * codex-cli-runner
 *
 * Spawns one short-lived auxiliary Codex CLI process under the same
 * containment as the auxiliary Claude CLI (prepareAuxCli: cgroup / Job Object
 * and the ownership ledger, plus the shared process tracker), feeds stdin and
 * collects stdout/stderr under a wall-clock cap. Not responsible for the
 * arguments, the environment or reading the output (codex-cli-provider.ts).
 */
import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '../../config/logger';
import {
  escapeWindowsShellArg,
  escapeWindowsShellArgForTarget,
} from '../common/windows-shell-escape';
import { auxCliCleanup, trackAuxCliChild } from './aux-cli-cleanup';
import { prepareAuxCli } from './aux-cli-launch';
import { launcherDeadlineMs } from './claude-cli-timeouts';
import { CodexCliUnavailableError } from './cli-errors';

const log = createLogger('ai-client:codex-cli-runner');

/** What the process left behind. */
export interface CodexProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Build the platform-specific spawn command (UTF-8 code page on Windows).
 *
 * NOTE: Same escaping rule as the Codex agent runner and the Claude provider:
 * a `.cmd` shim re-parses `%*`, so args are escaped per target kind.
 *
 * @param codexPath - Resolved CLI path / CLI のパス
 * @param args - CLI arguments / 引数
 * @param isWindows - Platform switch (injectable for tests) / Windows か
 * @returns Command and args for spawn / spawn に渡すコマンドと引数
 */
export function buildCodexSpawnCommand(
  codexPath: string,
  args: string[],
  isWindows = process.platform === 'win32',
): [string, string[]] {
  if (!isWindows) return [codexPath, args];
  const argsString = args.map((arg) => escapeWindowsShellArgForTarget(codexPath, arg)).join(' ');
  return [`chcp 65001 >NUL 2>&1 && ${escapeWindowsShellArg(codexPath, false)} ${argsString}`, []];
}

/**
 * Run the Codex CLI once and collect its output. Resolves for any exit code;
 * rejects only when the process could not run to completion.
 *
 * @param p.codexPath - Resolved CLI path / CLI のパス
 * @param p.args - CLI arguments / 引数
 * @param p.cwd - Working directory (an empty temp dir for calls) / 作業ディレクトリ
 * @param p.env - Spawn environment, already sanitised / 起動時の環境変数
 * @param p.stdin - Text written to stdin / 標準入力
 * @param p.timeoutMs - Wall-clock cap / 上限時間
 * @returns Exit code and captured output / 終了コードと出力
 * @throws {CodexCliUnavailableError} On spawn failure, timeout or unresolved cleanup / 起動失敗・時間切れ
 */
export async function runCodexProcess(p: {
  codexPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  timeoutMs: number;
}): Promise<CodexProcessResult> {
  auxCliCleanup.assertReady();
  const [command, spawnArgs] = buildCodexSpawnCommand(p.codexPath, p.args);
  let launch: Awaited<ReturnType<typeof prepareAuxCli>>;
  try {
    launch = await prepareAuxCli(command, p.cwd, p.env, spawnArgs, launcherDeadlineMs(p.timeoutMs));
  } catch (error) {
    throw new CodexCliUnavailableError(
      `Codex CLI launch unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(
        launch?.command ?? command,
        launch?.args ?? spawnArgs,
        launch?.options ?? {
          cwd: p.cwd,
          shell: true,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: p.env,
        },
      );
    } catch (error) {
      void (launch ? launch.stop() : Promise.resolve())
        .catch((cleanupError) => log.error({ cleanupError }, 'Auxiliary launch cleanup unresolved'))
        .finally(() =>
          reject(
            new CodexCliUnavailableError(
              `Codex CLI spawn failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
        );
      return;
    }
    const untrack = trackAuxCliChild(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const confirmed = launch?.attach(child) ?? Promise.resolve();
    const cleanup = async (stop: boolean) => {
      if (launch) {
        if (stop) await launch.stop();
        else await launch.finish();
        untrack();
      } else if (stop) auxCliCleanup.stop(child);
      else untrack();
    };
    const fail = async (message: string, stop: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await cleanup(stop);
      } catch (error) {
        log.error({ error, pid: child.pid }, 'Auxiliary Codex CLI cleanup unresolved');
        message += `; cleanup unresolved: ${error instanceof Error ? error.message : String(error)}`;
      }
      reject(new CodexCliUnavailableError(message));
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (!settled) stdout += d;
    });
    child.stderr?.on('data', (d: string) => {
      if (!settled) stderr += d;
    });
    const timer = setTimeout(() => {
      void fail(`Codex CLI timed out after ${p.timeoutMs}ms`, true);
    }, p.timeoutMs);
    child.on('error', (err) => {
      void fail(`Codex CLI spawn failed: ${err.message}`, Boolean(launch));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        await cleanup(false);
      } catch (error) {
        reject(
          new CodexCliUnavailableError(
            `Codex CLI cleanup unresolved: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });
    child.stdin?.on('error', (err) => log.warn({ err }, 'Codex CLI stdin error'));
    void confirmed.then(
      () => {
        if (!settled) child.stdin?.end(Buffer.from(p.stdin, 'utf8'));
      },
      (error) =>
        fail(
          `Codex CLI ownership failed: ${error instanceof Error ? error.message : String(error)}`,
          true,
        ),
    );
  });
}
