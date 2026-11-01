/**
 * fault-injection-e2e.test
 *
 * Unit test for the pure Markdown renderer in fault-injection-e2e.ts.
 */
import { describe, it, expect } from 'bun:test';
import {
  renderFaultInjectionMarkdown,
  formatBackendFailure,
  createTailBuffer,
  formatScenarioBackendContext,
} from '../fault-injection-e2e';

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

/**
 * The failure this encodes: `Fault Injection E2E` has gone red on most PRs
 * (measured 2026-10-31 — #1301 pass, #1305 pass, #1308 fail/fail, #1311
 * fail/pass on the SAME commit, #1314 fail), always as
 * `task creation failed: HTTP 500: {"error":"タスクの作成に失敗しました"}`,
 * and the CI log never said why the backend returned 500. formatBackendFailure
 * covers only the startup path: readBackendStreams drains the pipe to EOF,
 * which cannot be done while the backend is still running, so a mid-run
 * scenario failure reported the HTTP body and nothing else.
 *
 * So the streams are tapped live into a bounded buffer, and a scenario failure
 * prints its tail. These pin the two pieces that makes that safe: the buffer
 * cannot grow without bound, and the report says when it has nothing.
 */
describe('createTailBuffer', () => {
  it('keeps what it is given while under the cap', () => {
    const buf = createTailBuffer(100);
    buf.append('hello ');
    buf.append('world');
    expect(buf.read()).toBe('hello world');
  });

  // A backend under test can log for minutes. Holding all of it would trade a
  // blind failure for an out-of-memory one.
  it('keeps the TAIL once the cap is passed, because that is where a fatal lands', () => {
    const buf = createTailBuffer(10);
    buf.append('0123456789');
    buf.append('ABCDE');
    expect(buf.read()).toBe('56789ABCDE');
    expect(buf.read().length).toBe(10);
  });

  it('survives a single chunk larger than the whole cap', () => {
    const buf = createTailBuffer(4);
    buf.append('xxxxxxxxxxEND');
    expect(buf.read()).toBe('xEND'.slice(-4));
    expect(buf.read().length).toBe(4);
  });

  it('starts empty', () => {
    expect(createTailBuffer(10).read()).toBe('');
  });
});

describe('formatScenarioBackendContext', () => {
  it('includes both streams so the 500 can be explained', () => {
    const out = formatScenarioBackendContext('POST /tasks 500', 'PrismaClientKnownRequestError');
    expect(out).toContain('PrismaClientKnownRequestError');
    expect(out).toContain('POST /tasks 500');
  });

  // Silence is a finding, not a formatting bug: it means the backend answered
  // 500 without logging, which points somewhere different than a stack trace.
  it('says the backend logged nothing rather than printing empty headings', () => {
    const out = formatScenarioBackendContext('', '  \n ');
    expect(out).toContain('no output captured');
    expect(out).not.toContain('--- backend stderr');
  });

  it('does not claim a health-check failure, which is a different path', () => {
    const out = formatScenarioBackendContext('x', 'y');
    expect(out).not.toContain('health check');
  });
});
