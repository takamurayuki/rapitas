/**
 * execution-log-viewer/log-format-utils tests
 *
 * These pure helpers are distinct from the inline duplicate `formatLogLine`
 * defined for illustration inside
 * components/__tests__/formatLogLine.test.ts — that test file never imports
 * from this module, so isFilePath/formatNestedValue/formatLogLine here are
 * completely untested prior to this file.
 */
import { isFilePath, formatNestedValue, formatLogLine } from '../log-format-utils';

describe('isFilePath', () => {
  test('recognizes absolute Windows paths', () => {
    expect(isFilePath('C:\\Projects\\rapitas\\file.ts')).toBe(true);
  });

  test('recognizes relative paths starting with a slash', () => {
    expect(isFilePath('/src/app.ts')).toBe(true);
  });

  test('recognizes bare filenames by extension', () => {
    expect(isFilePath('Button.tsx')).toBe(true);
    expect(isFilePath('schema.prisma')).toBe(true);
  });

  test('rejects plain text with no path shape or known extension', () => {
    expect(isFilePath('hello world')).toBe(false);
    expect(isFilePath('running')).toBe(false);
  });
});

describe('formatNestedValue', () => {
  test('returns empty string for null/undefined', () => {
    expect(formatNestedValue(null)).toBe('');
    expect(formatNestedValue(undefined)).toBe('');
  });

  test('stringifies scalars as-is', () => {
    expect(formatNestedValue(42)).toBe('42');
    expect(formatNestedValue('plain text')).toBe('plain text');
  });

  test('renders a small object (<=2 scalar fields) inline', () => {
    expect(formatNestedValue({ a: 1, b: 'two' })).toBe('a: 1, b: two');
  });

  test('renders an empty object as {}', () => {
    expect(formatNestedValue({})).toBe('{}');
  });

  test('renders a large object (>2 fields) as indented multi-line text', () => {
    const result = formatNestedValue({ a: 1, b: 2, c: 3 });
    expect(result).toContain('\n');
    expect(result).toContain('a: 1');
    expect(result).toContain('c: 3');
  });

  test('recurses into nested object fields with increasing indentation', () => {
    const result = formatNestedValue({ outer: { inner: 1, inner2: 2, inner3: 3 } });
    expect(result).toContain('outer:');
    expect(result).toContain('inner: 1');
  });

  test('filters out null/undefined fields before deciding inline vs multi-line', () => {
    // 2 non-null fields remain -> should be inline, not multi-line.
    expect(formatNestedValue({ a: 1, b: 2, c: null, d: undefined })).toBe('a: 1, b: 2');
  });
});

describe('formatLogLine', () => {
  test('strips a trailing cost token but leaves shell $ tokens untouched', () => {
    const r = formatLogLine('[Result: completed (2.0s) $0.4602]');
    expect(r.formatted).not.toContain('0.4602');
    const shell = formatLogLine('$ echo $VAR');
    expect(shell.formatted).toBe('$ echo $VAR');
  });

  test('flags a workflow phase-transition marker', () => {
    const r = formatLogLine('[plan] creating implementation plan');
    expect(r.isPhaseTransition).toBe(true);
    expect(r.hasJson).toBe(false);
  });

  test('returns plain text untouched when there is no JSON or phase marker', () => {
    const r = formatLogLine('a normal log line');
    expect(r).toEqual({ formatted: 'a normal log line', hasJson: false });
  });

  test('parses inline JSON, prioritizes known keys, and extracts file paths', () => {
    const r = formatLogLine(
      'Coordinator: {"message":"working","status":"running","file":"src/a.ts"} done',
    );
    expect(r.hasJson).toBe(true);
    expect(r.formatted).toContain('message: working');
    expect(r.formatted).toContain('status: running');
    expect(r.formatted.indexOf('message:')).toBeLessThan(r.formatted.indexOf('file:'));
    expect(r.filePaths).toContain('src/a.ts');
    expect(r.formatted.startsWith('Coordinator:')).toBe(true);
    expect(r.formatted.endsWith('done')).toBe(true);
  });

  test('flags isError when the JSON payload has a truthy error field', () => {
    const r = formatLogLine('{"error":"boom","status":"failed"}');
    expect(r.isError).toBe(true);
  });

  test('does not flag isError when there is no error field', () => {
    const r = formatLogLine('{"status":"running"}');
    expect(r.isError).toBe(false);
  });

  test('falls back to plain text when the braces do not contain valid JSON', () => {
    const r = formatLogLine('some text {not valid json} more text');
    expect(r.hasJson).toBe(false);
    expect(r.formatted).toBe('some text {not valid json} more text');
  });

  test('renders nested object fields via formatNestedValue in the remaining-fields pass', () => {
    const r = formatLogLine('{"message":"m","nested":{"x":1,"y":2,"z":3}}');
    expect(r.hasJson).toBe(true);
    expect(r.formatted).toContain('nested:');
  });
});
