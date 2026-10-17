/**
 * run-codex-command.test
 *
 * `runCodexCommand` (the availability probe) used to build its own command
 * line with a quoter that handled `"` and nothing else, while the real
 * execution path used `buildSpawnCommand`. This spawns a `.cmd` shim shaped
 * like the installed `codex.cmd` and asserts the probe's arguments arrive at
 * the child intact — including the meta characters the old quoter left live
 * (CodeQL js/incomplete-sanitization, alert #1004).
 *
 * Windows-only: it needs a real cmd.exe. Backend `bun test` runs on
 * ubuntu-latest in CI, so this is verified by local execution on Windows,
 * like `process-runner-args.cmd-roundtrip.test.ts`.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliAgent } from './index';

/** The private probe, reached through the shape it exposes to this test. */
type ProbeAgent = {
  runCodexCommand: (args: string[], timeoutMs?: number) => Promise<{ ok: boolean; stderr: string }>;
};

const describeWindowsOnly = process.platform === 'win32' ? describe : describe.skip;

describeWindowsOnly('runCodexCommand — argv reaches the shim intact (Windows only)', () => {
  let tmpDir: string;
  let previousPath: string | undefined;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'codex-probe-'));
    const echoScriptPath = join(tmpDir, 'echo-argv.js');
    // stderr, because runCodexCommand keeps stderr and discards stdout.
    // Exit 1 so a shim that never ran is not mistaken for a passing probe.
    writeFileSync(
      echoScriptPath,
      'process.stderr.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(1);\n',
    );
    const shimPath = join(tmpDir, 'mock-codex.cmd');
    writeFileSync(shimPath, `@ECHO off\r\nnode "${echoScriptPath}" %*\r\n`);

    previousPath = process.env.CODEX_CLI_PATH;
    process.env.CODEX_CLI_PATH = shimPath;
  });

  afterAll(() => {
    if (previousPath === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = previousPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function probeArgv(args: string[]): Promise<string[]> {
    const agent = new CodexCliAgent('codex-probe', 'codex probe') as unknown as ProbeAgent;
    const { stderr } = await agent.runCodexCommand(args, 20000);
    return JSON.parse(stderr.trim());
  }

  test.each([
    // The call the old hand-rolled quoter existed for: a value with a space.
    // It quoted this one correctly — real quotes also neutralise `&` and `|`.
    ['the real health-check probe', ['debug', 'prompt-input', 'health check']],
    // Its actual hole: quoting was gated on /[\s"]/, so an argument with a
    // meta character but no whitespace went through raw. cmd.exe then read
    // the `&` as a command separator and the shim never saw `b`.
    ['separator, no whitespace', ['debug', 'prompt-input', 'a&b']],
    // Same gate, and `%` expands even inside quotes, so this needs the caret
    // escape rather than quoting.
    ['environment expansion', ['debug', 'prompt-input', '%PATH%']],
  ])('cmd.exe hands the shim exactly the argv: %s', async (_name, args) => {
    expect(await probeArgv(args)).toEqual(args);
  });
});
