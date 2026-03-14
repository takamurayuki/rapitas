import { formatLogData } from '../useSubtaskLogs';

describe('formatLogData', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatLogData(null)).toBe('');
    expect(formatLogData(undefined)).toBe('');
  });

  it('returns string as-is', () => {
    expect(formatLogData('hello world')).toBe('hello world');
  });

  it('converts primitives to string', () => {
    expect(formatLogData(42)).toBe('42');
    expect(formatLogData(true)).toBe('true');
  });

  it('extracts message field', () => {
    const result = formatLogData({ message: 'Task completed successfully' });
    expect(result).toContain('Task completed successfully');
  });

  it('extracts status field', () => {
    const result = formatLogData({ status: 'running', taskId: 5 });
    expect(result).toContain('ステータス: running');
    expect(result).toContain('taskId: 5');
  });

  it('extracts error field', () => {
    const result = formatLogData({ error: 'Connection timeout' });
    expect(result).toContain('エラー: Connection timeout');
  });

  it('formats complex objects with multiple fields', () => {
    const result = formatLogData({
      message: 'Processing',
      status: 'active',
      type: 'coordination',
      progress: 50,
    });
    expect(result).toContain('Processing');
    expect(result).toContain('ステータス: active');
    expect(result).toContain('タイプ: coordination');
    expect(result).toContain('progress: 50');
  });

  it('skips null/undefined values in object', () => {
    const result = formatLogData({
      message: 'Test',
      nullField: null,
      undefField: undefined,
    });
    expect(result).not.toContain('nullField');
    expect(result).not.toContain('undefField');
  });

  it('stringifies nested objects', () => {
    const result = formatLogData({
      details: { step: 1, name: 'init' },
    });
    expect(result).toContain('details:');
    expect(result).toContain('"step":1');
  });

  it('uses pipe separator between fields', () => {
    const result = formatLogData({ status: 'done', progress: 100 });
    expect(result).toContain(' | ');
  });

  it('falls back to JSON.stringify for empty objects', () => {
    const result = formatLogData({});
    expect(result).toBe('{}');
  });

  it('skips timestamp and level fields', () => {
    const result = formatLogData({
      message: 'Test',
      timestamp: '2026-01-01',
      level: 'info',
    });
    expect(result).not.toContain('timestamp');
    expect(result).not.toContain('level');
  });
});
