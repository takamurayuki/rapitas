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
    // NOTE: the full joined passage now goes into message (the viewer clamps
    // it to ~3 lines visually); detail keeps the merged text for expansion.
    expect(result[0].message).toBe('line1\nline2');
    expect(result[0].detail).toBe('line1\nline2');
    expect(result[1]).toEqual(infoEntry('other'));
  });

  test('a lone short agent-text entry gets no detail', () => {
    const result = groupAgentText([textEntry('short')]);
    expect(result).toHaveLength(1);
    expect(result[0].detail).toBeUndefined();
  });

  test('a lone long agent-text entry (>280 chars) truncates message but keeps full detail', () => {
    const long = 'x'.repeat(300);
    const result = groupAgentText([textEntry(long)]);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe(`${'x'.repeat(280)}...`);
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

// NOTE: 2026-11-26 an implementer finished (1625.9s), then three background
// task notifications woke the CLI for short replies; each wake-up ended with
// its own result line, so the log showed 「実行完了」 four times.
describe('transformLogsToSimple result lines', () => {
  const completedEntries = (logs: string[]) =>
    transformLogsToSimple(logs).filter((e) => e.message.startsWith('実行完了'));

  test('shows one completion for a run woken up again after it finished', () => {
    const logs = [
      '[Result: success (1625.9s) $1.2345]',
      '自己検証が完了しました。',
      '[Result: success (15.6s) $0.0100]',
      'この通知は待機ループが終わったことを知らせるだけです。',
      '[Result: success (4.9s)]',
      '新しい情報はありません。',
      '[Result: success (3.7s)]',
    ];
    const done = completedEntries(logs);
    expect(done).toHaveLength(1);
    expect(done[0].message).toBe('実行完了 - 1650.1s');
  });

  test('puts the single completion after the last reply', () => {
    const logs = ['[Result: success (10.0s)]', '追加の返答です。', '[Result: success (2.0s)]'];
    const result = transformLogsToSimple(logs);
    expect(result[result.length - 1].message).toBe('実行完了 - 12.0s');
  });

  test('keeps a failed result visible next to a completion', () => {
    const logs = ['[Result: error_max_turns (5.0s)]', '[Result: success (1.0s)]'];
    const result = transformLogsToSimple(logs);
    expect(result.some((e) => e.category === 'error')).toBe(true);
    expect(completedEntries(logs)).toHaveLength(1);
  });
});

describe('transformLogsToSimple result lines across runs', () => {
  test('keeps one completion per run when a round holds two runs', () => {
    const logs = [
      '[Claude Code] Starting execution...',
      '[Result: success (10.0s)]',
      '[Result: success (1.0s)]',
      '[Codex] Starting execution...',
      '[Result: completed (20.0s)]',
    ];
    const done = transformLogsToSimple(logs).filter((e) => e.message.startsWith('実行完了'));
    expect(done.map((e) => e.message)).toEqual(['実行完了 - 11.0s', '実行完了 - 20.0s']);
  });
});

// Task 1582: 「実行完了」 appeared while self-verification was still running.
describe('transformLogsToSimple with self-verification (task 1582)', () => {
  const start = '[Claude Code] Starting execution...';
  const wait = '[SelfVerification] waiting runId=94d7787b';
  const done = '[Result: success (88.3s)]';
  const messages = (logs: string[]) => transformLogsToSimple(logs).map((e) => e.message);

  test('before the result only 「自己検証の結果待ちです」 is shown, without 「実行完了」', () => {
    const shown = messages([start, wait, done]);
    expect(shown).toContain('自己検証の結果待ちです');
    expect(shown.some((m) => m.startsWith('実行完了'))).toBe(false);
  });

  test('after the result the verdict with check counts is shown, then 「実行完了」', () => {
    const shown = messages([
      start,
      wait,
      done,
      '[SelfVerification] result runId=94d7787b ok=false unverifiable=false passed=4 failed=2',
    ]);
    const verdict = shown.indexOf('自己検証: 不合格（通過 4 / 失敗 2）');
    const completed = shown.findIndex((m) => m.startsWith('実行完了'));
    expect(shown.indexOf('自己検証の結果待ちです')).toBeGreaterThanOrEqual(0);
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThan(verdict);
    expect(shown[completed]).toBe('実行完了 - 88.3s');
  });

  test.each([
    [
      'ok=true unverifiable=false passed=7 failed=0',
      '自己検証: 合格（通過 7 / 失敗 0）',
      'success',
    ],
    [
      'ok=false unverifiable=true passed=0 failed=0',
      '自己検証: 確認できず（通過 0 / 失敗 0）',
      'warning',
    ],
  ])('renders %s as %s', (fields, message, category) => {
    const entry = transformLogToUserFriendly(`[SelfVerification] result runId=r1 ${fields}`);
    expect(entry.message).toBe(message);
    expect(entry.category).toBe(category);
    expect(entry.iconName).toBe('FlaskConical');
  });

  test('an old log without self-verification markers is unchanged', () => {
    expect(messages([start, 'Reading files', done])).toEqual(
      transformLogsToSimple([start, 'Reading files', done]).map((e) => e.message),
    );
    expect(messages([start, done]).filter((m) => m.startsWith('実行完了'))).toEqual([
      '実行完了 - 88.3s',
    ]);
  });
});
