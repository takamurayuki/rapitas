/**
 * command-display.test
 *
 * 2026-11-21: a Codex verifier log for task 1519 was 55k characters against
 * 4k for the Claude Code run of the same task, because every command was
 * logged with its PowerShell wrapper and JSON escapes, twice (start and
 * done), and scripts that embedded a whole verify.md were logged in full.
 */
import { describe, expect, test } from 'bun:test';
import { displayCommand, MAX_COMMAND_DISPLAY_CHARS } from './command-display';

const PS = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"`;

describe('displayCommand', () => {
  test('drops the PowerShell wrapper around a double-quoted command', () => {
    expect(displayCommand(`${PS} -Command "rg --files -g AGENTS.md -g plan.md"`)).toBe(
      'rg --files -g AGENTS.md -g plan.md',
    );
  });

  test('drops the PowerShell wrapper around a single-quoted command', () => {
    expect(displayCommand(`${PS} -Command 'git status --short; git log -5 --oneline'`)).toBe(
      'git status --short; git log -5 --oneline',
    );
  });

  test('drops bash and cmd wrappers', () => {
    expect(displayCommand(`/bin/bash -lc 'ls -la'`)).toBe('ls -la');
    expect(displayCommand(`"C:\\Windows\\System32\\cmd.exe" /d /s /c "npm test"`)).toBe('npm test');
  });

  test('shows the first line of a multi-line script, marked as cut', () => {
    const script = `${PS} -Command '$ErrorActionPreference = '"'"'Stop'"'"'\n$expected = @'"'"'\n# 検証レポート\n'`;
    expect(displayCommand(script)).toBe(`$ErrorActionPreference = 'Stop' …`);
  });

  test('caps a long single line', () => {
    const out = displayCommand(`npm run lint -- ${'x'.repeat(400)}`);
    expect(out.length).toBeLessThanOrEqual(MAX_COMMAND_DISPLAY_CHARS + 2);
    expect(out.endsWith('…')).toBe(true);
  });

  test('leaves a plain command unchanged', () => {
    expect(displayCommand('ls -la')).toBe('ls -la');
    expect(displayCommand('git status')).toBe('git status');
  });
});
