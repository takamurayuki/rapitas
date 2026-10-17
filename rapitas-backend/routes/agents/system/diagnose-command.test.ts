/**
 * diagnose-command.test
 *
 * Covers `buildClaudeProbeSpawn` (CodeQL js/indirect-command-line-injection,
 * alert #783). The diagnose route reads its CLI path from the
 * `CLAUDE_CODE_PATH` environment variable and used to paste it straight into
 * a `cmd.exe /c` command line, so these tests pin the quoting rather than the
 * formatting: a path carrying a command separator must come back inert, and
 * the caret depth must follow the target's kind.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeProbeSpawn } from './diagnose-command';

describe('buildClaudeProbeSpawn', () => {
  test('hands back argv untouched off Windows, so the caller can spawn without a shell', () => {
    const args = ['--dangerously-skip-permissions', '-p', 'Say hello'];
    expect(buildClaudeProbeSpawn('/usr/local/bin/claude', args, false)).toEqual([
      '/usr/local/bin/claude',
      args,
    ]);
  });

  test('a command separator in CLAUDE_CODE_PATH stays inside real quotes', () => {
    // The whole point of alert #783: `claude.exe & calc` reached the command
    // line raw, and cmd.exe read the `&` as "now run calc".
    const [command, finalArgs] = buildClaudeProbeSpawn('C:\\bin\\claude.exe & calc', [], true);
    expect(finalArgs).toEqual([]);
    expect(command.trim()).toBe('"C:\\bin\\claude.exe & calc"');
    // Not merely "contains the path" — the `&` must not sit outside a quote.
    expect(command.replace(/"[^"]*"/g, '')).not.toContain('&');
  });

  test('a path with spaces keeps real quotes so cmd.exe reads one command name', () => {
    const [command] = buildClaudeProbeSpawn('C:\\Program Files\\claude.exe', ['--version'], true);
    expect(command.startsWith('"C:\\Program Files\\claude.exe"')).toBe(true);
  });

  test('a native .exe target gets one caret layer, a .cmd shim gets two', () => {
    const [nativeCommand] = buildClaudeProbeSpawn('claude.exe', ['a&b'], true);
    const [shimCommand] = buildClaudeProbeSpawn('claude.cmd', ['a&b'], true);
    // One parse on the way in vs. two (the shim's `%*` re-expansion). Undoing
    // a single cmd.exe parse of the shim form must land on the native form.
    const argsOf = (command: string) => command.slice(command.indexOf(' ') + 1);
    expect(argsOf(shimCommand).replace(/\^(.)/g, '$1')).toBe(argsOf(nativeCommand));
    expect(argsOf(shimCommand)).not.toBe(argsOf(nativeCommand));
  });

  test('a bare name is escaped as a shim, since PATHEXT usually resolves it to one', () => {
    const [bareCommand] = buildClaudeProbeSpawn('claude', ['a&b'], true);
    const [shimCommand] = buildClaudeProbeSpawn('claude.cmd', ['a&b'], true);
    const argsOf = (command: string) => command.slice(command.indexOf(' ') + 1);
    expect(argsOf(bareCommand)).toBe(argsOf(shimCommand));
  });
});

const describeWindowsOnly = process.platform === 'win32' ? describe : describe.skip;

/**
 * Windows-only: proves cmd.exe decodes the escaped line back to the original
 * argv. Backend `bun test` runs on ubuntu-latest in CI, so this suite is
 * verified locally on Windows — the same arrangement as
 * `process-runner-args.cmd-roundtrip.test.ts`.
 */
describeWindowsOnly('buildClaudeProbeSpawn — real cmd.exe round-trip (Windows only)', () => {
  let tmpDir: string;
  let shimPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'claude-probe-roundtrip-'));
    const echoScriptPath = join(tmpDir, 'echo-argv.js');
    writeFileSync(echoScriptPath, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    // `%*` re-expansion, like the npm-installed claude.cmd shim.
    shimPath = join(tmpDir, 'mock-claude.cmd');
    writeFileSync(shimPath, `@ECHO off\r\nnode "${echoScriptPath}" %*\r\n`);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function runRoundtrip(argv: string[]): Promise<string[]> {
    const [command, finalArgs] = buildClaudeProbeSpawn(shimPath, argv, true);
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
          reject(new Error(`mock-claude.cmd exited with code ${code}: ${stderr}`));
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
    ['the real diagnose probe', ['--dangerously-skip-permissions', '-p', 'Say hello']],
    ['meta characters', ['-p', 'a & b | c > d ^ e']],
    ['quotes and percent', ['-p', 'say "hi" 100%']],
  ])('cmd.exe gives the child back exactly the argv: %s', async (_name, argv) => {
    expect(await runRoundtrip(argv)).toEqual(argv);
  });
});
