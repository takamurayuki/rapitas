/**
 * fault-injection-e2e.test
 *
 * Unit test for the pure Markdown renderer in fault-injection-e2e.ts.
 */
import { describe, it, expect } from 'bun:test';
import { renderFaultInjectionMarkdown, formatBackendFailure } from '../fault-injection-e2e';

describe('renderFaultInjectionMarkdown', () => {
  it('renders a PASSED badge when every scenario passed', () => {
    const md = renderFaultInjectionMarkdown([
      { name: 'a', passed: true, detail: 'ok' },
      { name: 'b', passed: true, detail: 'ok' },
    ]);
    expect(md).toContain('✅ PASSED');
    expect(md).toContain('| a | ✅ | ok |');
  });

  it('renders a FAILED badge when any scenario failed', () => {
    const md = renderFaultInjectionMarkdown([
      { name: 'a', passed: true, detail: 'ok' },
      { name: 'b', passed: false, detail: 'boom' },
    ]);
    expect(md).toContain('❌ FAILED');
    expect(md).toContain('| b | ❌ | boom |');
  });

  it('renders a FAILED badge for an empty result set', () => {
    const md = renderFaultInjectionMarkdown([]);
    expect(md).toContain('❌ FAILED');
  });
});

/** Built from a char code so no heredoc/escaping layer can mangle it. */
const NEWLINE = String.fromCharCode(10);

describe('formatBackendFailure', () => {
  it('includes both streams so the cause is visible in the CI log', () => {
    // The whole reason this exists: the first real run of this job (PR #919,
    // 2026-10-15) reported only "failed health check after 30062ms" and
    // discarded the child's piped output, so the require() that actually killed
    // the backend was invisible.
    const out = formatBackendFailure(30062, 'listening on 3211', 'Cannot find module');
    expect(out).toContain('30062');
    expect(out).toContain('listening on 3211');
    expect(out).toContain('Cannot find module');
  });

  it('says so explicitly when the child produced no output at all', () => {
    // Silence is a finding, not an absence of one: it means the process died
    // before it logged anything. A reader must not mistake it for a truncation.
    const out = formatBackendFailure(1000, '', '   ');
    expect(out).toMatch(/no output|出力なし/);
  });

  it('keeps the TAIL of a long stream, where the fatal error lands', () => {
    const many = Array.from({ length: 400 }, (_, i) => `line${i}`).join(NEWLINE);
    const out = formatBackendFailure(1000, many, '');
    expect(out).toContain('line399');
    expect(out).not.toContain(`line0${NEWLINE}`);
  });
});
