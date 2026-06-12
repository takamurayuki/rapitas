/**
 * log-format-parser.test
 *
 * Unit tests for the multi-format log parser (pino / generic json / text),
 * including the warn+ filter and the text fallback for non-JSON lines.
 */
import { describe, it, expect } from 'bun:test';
import { parseLogEntries } from './log-format-parser';

describe('parseLogEntries — pino', () => {
  it('parses numeric levels and keeps only warn+', () => {
    const content = [
      JSON.stringify({ level: 30, name: 'a', msg: 'info' }),
      JSON.stringify({ level: 40, name: 'a', msg: 'a warning' }),
      JSON.stringify({ level: 50, name: 'a', msg: 'an error', err: { stack: 'at x()' } }),
    ].join('\n');
    const out = parseLogEntries(content, 'pino');
    expect(out).toHaveLength(2);
    expect(out[0].level).toBe(40);
    expect(out[1].stack).toBe('at x()');
  });

  it('prefers err.message and reads time', () => {
    const content = JSON.stringify({
      level: 50,
      name: 'a',
      msg: 'generic',
      err: { message: 'real cause' },
      time: 1700000000000,
    });
    const out = parseLogEntries(content, 'pino');
    expect(out[0].msg).toBe('real cause');
    expect(out[0].time).toBe(1700000000000);
  });
});

describe('parseLogEntries — generic json', () => {
  it('infers level/message from alternative keys and string levels', () => {
    const content = [
      JSON.stringify({ severity: 'ERROR', message: 'db down', logger: 'svc' }),
      JSON.stringify({ level: 'info', message: 'ignored' }),
      JSON.stringify({ lvl: 'warning', text: 'disk low' }),
    ].join('\n');
    const out = parseLogEntries(content, 'json');
    expect(out).toHaveLength(2);
    expect(out[0].msg).toBe('db down');
    expect(out[0].name).toBe('svc');
    expect(out[1].level).toBe(40);
  });

  it('falls back to text parsing for non-JSON lines', () => {
    const out = parseLogEntries('2024-01-01 ERROR something broke', 'json');
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe(50);
  });

  it('parses ISO timestamps', () => {
    const out = parseLogEntries(
      JSON.stringify({ level: 'error', message: 'x', timestamp: '2024-01-15T03:00:00Z' }),
      'json',
    );
    expect(out[0].time).toBe(Date.parse('2024-01-15T03:00:00Z'));
  });
});

describe('parseLogEntries — text', () => {
  it('extracts level by keyword and ignores non-matching lines', () => {
    const content = [
      'just some info line',
      '[2024] WARN cache miss',
      'ERROR: connection refused',
      'FATAL kernel panic',
    ].join('\n');
    const out = parseLogEntries(content, 'text');
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.level)).toEqual([40, 50, 60]);
  });
});
