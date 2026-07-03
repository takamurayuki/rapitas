/**
 * log-transformers tests
 *
 * translateStatus / splitLogsIntoLines / groupAgentText are not directly
 * exercised by the pre-existing log-message-transformer.test.ts (which only
 * covers transformLogToUserFriendly/transformLogsToSimple end-to-end), so
 * this file targets those three exports directly plus a couple of
 * transform edge cases (custom translator, dedupe-by-detail) not already
 * covered.
 */
import {
  translateStatus,
  splitLogsIntoLines,
  groupAgentText,
  transformLogToUserFriendly,
  transformLogsToSimple,
} from '../log-transformers';
import type { UserFriendlyLogEntry } from '../log-pattern-rules';

describe('translateStatus', () => {
  test('maps known statuses to Japanese labels by default', () => {
    expect(translateStatus('running')).toBe('実行中');
    expect(translateStatus('completed')).toBe('完了');
    expect(translateStatus('failed')).toBe('失敗');
    expect(translateStatus('in-progress')).toBe('進行中');
    expect(translateStatus('in_progress')).toBe('進行中');
    expect(translateStatus('done')).toBe('完了');
  });

  test('is case-insensitive on the input status', () => {
    expect(translateStatus('RUNNING')).toBe('実行中');
  });

  test('returns the raw status unchanged when unknown', () => {
    expect(translateStatus('some-unmapped-status')).toBe('some-unmapped-status');
  });

  test('uses a custom translator when supplied', () => {
    const t = (key: string) => `<${key}>`;
    expect(translateStatus('running', t)).toBe('<statusLabels.running>');
  });
});

describe('splitLogsIntoLines', () => {
  test('splits multi-line entries and keeps single-line entries as-is', () => {
    const result = splitLogsIntoLines(['a\nb\nc', 'd']);
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  test('drops empty lines produced by splitting', () => {
    const result = splitLogsIntoLines(['a\n\nb']);
    expect(result).toEqual(['a', 'b']);
  });

  test('drops empty-string entries entirely', () => {
    const result = splitLogsIntoLines(['', 'a', '']);
    expect(result).toEqual(['a']);
  });

  test('returns an empty array for an empty input array', () => {
    expect(splitLogsIntoLines([])).toEqual([]);
  });
});

describe('groupAgentText', () => {
  function textEntry(message: string): UserFriendlyLogEntry {
    return { category: 'agent-text', message };
  }
  function infoEntry(message: string): UserFriendlyLogEntry {
    return { category: 'info', message };
  }

  test('passes through non agent-text entries unchanged', () => {
    const entries = [infoEntry('a'), infoEntry('b')];
    expect(groupAgentText(entries)).toEqual(entries);
  });

  test('groups consecutive agent-text entries into a single entry with joined detail', () => {
    const entries = [textEntry('line1'), textEntry('line2'), infoEntry('other')];
    const result = groupAgentText(entries);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('agent-text');
    expect(result[0].message).toBe('line1');
    expect(result[0].detail).toBe('line1\nline2');
    expect(result[1]).toEqual(infoEntry('other'));
  });

  test('a lone short agent-text entry gets no detail', () => {
    const result = groupAgentText([textEntry('short')]);
    expect(result).toHaveLength(1);
    expect(result[0].detail).toBeUndefined();
  });

  test('a lone long agent-text entry (>120 chars) truncates message but keeps full detail', () => {
    const long = 'x'.repeat(150);
    const result = groupAgentText([textEntry(long)]);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe(`${'x'.repeat(120)}...`);
    expect(result[0].detail).toBe(long);
  });

  test('flushes a trailing agent-text buffer at the end of the array', () => {
    const result = groupAgentText([infoEntry('first'), textEntry('trailing')]);
    expect(result).toHaveLength(2);
    expect(result[1].category).toBe('agent-text');
  });

  test('empty input produces empty output', () => {
    expect(groupAgentText([])).toEqual([]);
  });
});

describe('transformLogToUserFriendly with a custom translator', () => {
  test('forwards the translator into the pattern table', () => {
    const t = (key: string) => `[[${key}]]`;
    const result = transformLogToUserFriendly('Error: boom', t);
    expect(result.message).toBe('[[errorOccurred]]');
  });
});

describe('transformLogsToSimple dedupe', () => {
  test('keeps consecutive same-category entries distinct when their content differs', () => {
    const logs = ['file_edit a.ts', 'file_edit b.ts'];
    const result = transformLogsToSimple(logs);
    expect(result).toHaveLength(2);
    expect(result[0].detail).toBe('a.ts');
    expect(result[1].detail).toBe('b.ts');
  });
});
