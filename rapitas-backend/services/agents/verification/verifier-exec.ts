/**
 * verifier-exec
 *
 * Low-level subprocess execution primitives (spawn-based, async, timeout-guarded)
 * and output/timeout constants shared by every verification check.
 * Contains no check-specific logic. Extracted from automated-verifier.ts
 * (file-size split).
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/** Code extensions worth linting / typechecking. */
export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Per-command timeout (ms). Lint/typecheck on a large project can be slow. */
const CMD_TIMEOUT_MS = 180_000;
/** Test suites routinely run much longer than lint/tsc. */
export const TEST_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
/** Cap how much raw output we keep in the report. */
export const MAX_DETAIL_CHARS = 2_000;

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a shell command asynchronously, capturing output. Never rejects — a
 * non-zero exit (lint/tsc found problems) is a normal, expected outcome.
 */
export function runCmd(
  command: string,
  cwd: string,
  timeoutMs: number = CMD_TIMEOUT_MS,
): Promise<CmdResult> {
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(124); // timeout
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += d.toString();
    });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 0));
  });
}

/** Runs a git command in a directory, returning stdout (or '' on failure). */
export async function git(cwd: string, args: string): Promise<string> {
  const res = await runCmd(`git ${args}`, cwd);
  return res.code === 0 ? res.stdout : '';
}

/**
 * Resolves a runnable local CLI binary in a project's node_modules/.bin, or
 * null. Tries the shim variants different package managers create on Windows
 * (npm → .cmd, bun → .exe) so verification works regardless of how deps were
 * installed.
 */
export function resolveBin(projectRoot: string, workdir: string, name: string): string | null {
  const candidates =
    process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
  for (const root of [projectRoot, workdir]) {
    const binDir = join(root, 'node_modules', '.bin');
    for (const candidate of candidates) {
      const p = join(binDir, candidate);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
