/**
 * fault-injection-e2e.test
 *
 * Unit test for the pure Markdown renderer in fault-injection-e2e.ts.
 */
import { describe, it, expect } from 'bun:test';
import { renderFaultInjectionMarkdown } from '../fault-injection-e2e';

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
