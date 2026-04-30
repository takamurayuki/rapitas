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

  it('hides benign Codex arg0 startup warnings', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'WARNING: failed to clean up stale arg0 temp dirs: アクセスが拒否されました。 (os error 5)',
        'WARNING: proceeding, even though we could not update PATH: アクセスが拒否されました。 (os error 5) at path "C:\\Users\\user\\.codex\\tmp\\arg0\\codex-arg0Pn0BPw"',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
  });

  it('hides standalone file path lists from command output', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        'rapitas-backend\\utils\\ai-client\\error-handler.ts',
        '$ rapitas-backend\\pnpm-workspace.yaml',
        'rapitas-frontend\\src\\app\\dashboard\\error.tsx',
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
    expect(shouldHideRawCliLine('rapitas-backend\\services\\system\\error-capture.ts')).toBe(true);
    expect(shouldHideRawCliLine('$ rapitas-backend\\bun.lock')).toBe(true);
  });

  it('hides codex tool labels with code excerpts (調査: { ... })', () => {
    expect(shouldHideRawCliLine('調査: {categories.map((cat) => (')).toBe(true);
    expect(shouldHideRawCliLine('調査: {cat.name}')).toBe(true);
    expect(shouldHideRawCliLine('Investigation: { foo: 1 }')).toBe(true);
    expect(shouldHideRawCliLine('$ } catch (error) {')).toBe(true);
    expect(shouldHideRawCliLine('} catch (error) {')).toBe(true);
    expect(shouldHideRawCliLine('/* error */')).toBe(true);
    expect(shouldHideRawCliLine('}')).toBe(true);
    expect(shouldHideRawCliLine('} else {')).toBe(true);
    // But a labelled error message with important keywords stays visible.
    expect(shouldHideRawCliLine('調査: timeout exceeded after 30s')).toBe(false);
  });

  it('hides grep-style match lines (path:lineno:content)', () => {
    const filtered = filterCliDiagnosticOutput(
      [
        "rapitas-backend\\routes\\foo.ts:42: log.error({ err }, 'Failed to update task');",
        "rapitas-frontend/src/app/page.tsx:88: return { error: 'not found' };",
      ].join('\n'),
      { provider: 'codex' },
    );

    expect(filtered.display).toBe('');
    expect(filtered.important).toBe(false);
    expect(
      shouldHideRawCliLine('$ rapitas-backend\\bun.lock:8: "@anthropic-ai/sdk": "^0.52.0",'),
    ).toBe(true);
    expect(shouldHideRawCliLine('rapitas-backend\\bun.lock:623: "pino": ["pino@10.3.1"')).toBe(
      true,
    );
    expect(
      shouldHideRawCliLine(
        '調査: rapitas-backend\\bun.lock:537: "levn": ["levn@0.4.1", "", { "depende...',
      ),
    ).toBe(true);
    expect(shouldHideRawCliLine('rapitas-frontend/src/app/page.tsx:42: const x = 1;')).toBe(true);
    // Plain prose mentioning a colon and number must NOT match.
    expect(shouldHideRawCliLine('Result code is 42: success')).toBe(false);
  });
});
