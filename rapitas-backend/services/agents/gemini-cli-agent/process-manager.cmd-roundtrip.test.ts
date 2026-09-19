/**
 * process-manager.cmd-roundtrip.test
 *
 * Real-process, real-`cmd.exe` verification of `buildGeminiSpawnCommand`
 * (task 977). The unit tests in process-manager.spawn.test.ts only assert on
 * the literal escaped string; they cannot prove cmd.exe actually decodes it
 * back to the original argv. This file spawns a mock `.cmd` shim shaped like
 * a real `gemini.cmd` (an `%*`-expanding batch wrapper around a Node script)
 * and confirms the child process receives exactly the argv it was given.
 * Mirrors codex-cli-agent/process-runner-args.cmd-roundtrip.test.ts.
 *
 * Windows-only: requires a live `cmd.exe`. Skipped everywhere else,
 * including this repo's CI (`test-lint.yml` runs backend `bun test` only on
 * `ubuntu-latest`) — so this suite is verified by local execution on
 * Windows, not by CI.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGeminiSpawnCommand } from './process-manager';

const isWindows = process.platform === 'win32';
const describeWindowsOnly = isWindows ? describe : describe.skip;

describeWindowsOnly('buildGeminiSpawnCommand — real cmd.exe round-trip (Windows only)', () => {
  let tmpDir: string;
  let shimPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gemini-cmd-roundtrip-'));
    const echoScriptPath = join(tmpDir, 'echo-argv.js');
    writeFileSync(echoScriptPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');

    // Mirrors the re-parse-triggering structure of a real npm-installed
    // `.cmd` shim: `%*` is expanded into a new command line that cmd.exe
    // parses a second time, which is exactly the scenario
    // `escapeWindowsShellArg`'s `doubleEscapeMetaChars` targets.
    shimPath = join(tmpDir, 'mock-gemini.cmd');
    writeFileSync(shimPath, `@ECHO off\r\nnode "${echoScriptPath}" %*\r\n`);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runRoundtrip(argv: string[]): Promise<string[]> {
    const [command, finalArgs] = buildGeminiSpawnCommand(shimPath, argv);
    return new Promise((resolve, reject) => {
      const child = spawn(command, finalArgs, { shell: true, windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`mock-gemini.cmd exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          reject(new Error(`failed to parse child stdout as JSON: ${stdout} (${String(err)})`));
        }
      });
      child.on('error', reject);
    });
  }

  test.each([
    ['plain flags and values', ['-p', '--output-format', 'json']],
    ['trailing-backslash path', ['--cd', 'C:\\work\\nested\\']],
    ['embedded quote and backslash', ['say "hi\\', 'plain']],
    ['percent (env-var-like) token', ['-m', '%GEMINI_API_KEY%']],
    ['caret escape char itself', ['^literal^caret^']],
    ['ampersand and pipe', ['a&b', 'c|d']],
    ['angle brackets and redirection-like tokens', ['a<b>c']],
    ['parentheses grouping tokens', ['(group)', 'a;b,c']],
    ['empty string argument', ['-p', '', '--flag']],
  ])('round-trips %s through a real cmd.exe + %%*-expanding shim', async (_label, argv) => {
    const received = await runRoundtrip(argv);
    expect(received).toEqual(argv);
  });

  test('the gemini path itself is quoted safely even when it lives under a space-containing directory', async () => {
    const spacedDir = mkdtempSync(join(tmpdir(), 'gemini cmd roundtrip '));
    try {
      const echoScriptPath = join(spacedDir, 'echo-argv.js');
      writeFileSync(
        echoScriptPath,
        'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
      );
      const spacedShimPath = join(spacedDir, 'mock-gemini.cmd');
      writeFileSync(spacedShimPath, `@ECHO off\r\nnode "${echoScriptPath}" %*\r\n`);

      const [command, finalArgs] = buildGeminiSpawnCommand(spacedShimPath, ['-p', '--json']);
      const received = await new Promise<string[]>((resolve, reject) => {
        const child = spawn(command, finalArgs, { shell: true, windowsHide: true });
        let stdout = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`exited with code ${code}: ${stderr}`));
            return;
          }
          resolve(JSON.parse(stdout));
        });
        child.on('error', reject);
      });
      expect(received).toEqual(['-p', '--json']);
    } finally {
      rmSync(spacedDir, { recursive: true, force: true });
    }
  });
});
