import { describe, expect, it } from 'bun:test';
import {
  filterCliDiagnosticOutput,
  shouldHideRawCliLine,
} from '../../services/agents/cli-output-filter';

describe('cli-output-filter', () => {
  it('hides successful command output and file content from live logs', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'succeeded in 3804ms:',
        '/**',
        ' * Some source file content',
        'import { createLogger } from "../../../config/logger";',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('keeps important errors visible', () => {
    const filtered = filterCliDiagnosticOutput(
      'exited 1 in 1694ms:\nCannot find path C:\\tmp\\node_modules because it does not exist.',
      { provider: 'codex' },
    );

    expect(filtered.display).toContain('exited 1');
    expect(filtered.display).toContain('Cannot find path');
    expect(filtered.important).toBe(true);
  });

  it('summarizes command lines without dumping results', () => {
    const filtered = filterCliDiagnosticOutput(
      'exec "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content src/app.ts"',
      { provider: 'codex' },
    );

    expect(filtered.display).toContain('[Command]');
    expect(filtered.display).toContain('Get-Content');
  });

  it('hides raw code-like lines', () => {
    expect(shouldHideRawCliLine('import { foo } from "./bar";')).toBe(true);
    expect(shouldHideRawCliLine('const value = createThing();')).toBe(true);
    expect(shouldHideRawCliLine("log.error({ err }, 'Failed to convert idea to task');")).toBe(
      true,
    );
    expect(shouldHideRawCliLine("return { error: 'アイデアが見つかりません' };")).toBe(true);
    expect(shouldHideRawCliLine('short human-readable status')).toBe(false);
  });

  it('hides diff lines even when they contain command or error-like words', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        '+import { sendAIMessage, type AIProvider } from "../../utils/ai-client";',
        "+ log.warn({ err: aiErr, ideaId }, 'AI conversion failed, using fallback');",
        "log.error({ err, ideaId }, 'Failed to convert idea to task');",
        '+ <option key={cat.id} value={cat.id}>',
        '+ {cat.name}',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides benign Codex telemetry errors', () => {
    const filtered = filterCliDiagnosticOutput(
      '2026-04-29T10:04:29.536900Z ERROR codex_core::session: failed to record rollout',
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });
});
