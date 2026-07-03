/**
 * terminal-utils tests
 *
 * classifyLine / lineColor / appendCapped had no prior test coverage.
 */
import {
  classifyLine,
  lineColor,
  appendCapped,
  MAX_TERMINAL_LINES,
  MAX_TERMINAL_CHARS,
  type LogLine,
} from '../terminal-utils';

describe('classifyLine', () => {
  test('classifies tool lines (English and Japanese prefixes)', () => {
    expect(classifyLine('[Tool: Read] -> a.ts')).toBe('tool');
    expect(classifyLine('[ツール: Read] -> a.ts')).toBe('tool');
  });

  test('classifies error lines', () => {
    expect(classifyLine('[エラー] failed')).toBe('error');
    expect(classifyLine('[Error] failed')).toBe('error');
    expect(classifyLine('[失敗] failed')).toBe('error');
  });

  test('classifies question lines including the waitingForInput marker', () => {
    expect(classifyLine('[Question] pick one')).toBe('question');
    expect(classifyLine('[質問] pick one')).toBe('question');
    expect(classifyLine('status waitingForInput now')).toBe('question');
  });

  test('classifies system lines (English and Japanese prefixes)', () => {
    expect(classifyLine('[System: init]')).toBe('system');
    expect(classifyLine('[システム] starting')).toBe('system');
  });

  test('defaults to agent for anything else', () => {
    expect(classifyLine('I will now read the file')).toBe('agent');
    expect(classifyLine('')).toBe('agent');
  });
});

describe('lineColor', () => {
  test('maps every LogLine type to its expected Tailwind class', () => {
    expect(lineColor('user')).toBe('text-violet-400');
    expect(lineColor('tool')).toBe('text-cyan-400');
    expect(lineColor('error')).toBe('text-red-400');
    expect(lineColor('question')).toBe('text-amber-400');
    expect(lineColor('system')).toBe('text-zinc-500');
    expect(lineColor('agent')).toBe('text-zinc-300');
  });
});

function makeLine(id: string, text: string): LogLine {
  return { id, type: 'agent', text, ts: 0 };
}

describe('appendCapped', () => {
  test('appends new lines onto existing ones', () => {
    const prev = [makeLine('1', 'a')];
    const result = appendCapped(prev, [makeLine('2', 'b')]);
    expect(result.map((l) => l.id)).toEqual(['1', '2']);
  });

  test('caps the total number of lines at MAX_TERMINAL_LINES, keeping the most recent', () => {
    const prev = Array.from({ length: MAX_TERMINAL_LINES }, (_, i) => makeLine(String(i), 'x'));
    const result = appendCapped(prev, [makeLine('new', 'y')]);
    expect(result).toHaveLength(MAX_TERMINAL_LINES);
    expect(result[result.length - 1].id).toBe('new');
    expect(result[0].id).toBe('1'); // the oldest line ("0") was dropped
  });

  test('caps total characters at MAX_TERMINAL_CHARS, dropping oldest lines first', () => {
    const bigText = 'x'.repeat(MAX_TERMINAL_CHARS);
    const prev = [makeLine('old', 'should be dropped entirely')];
    const result = appendCapped(prev, [makeLine('big', bigText)]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('big');
    expect(result[0].text).toBe(bigText);
  });

  test('truncates a single line from the front when it alone exceeds the char cap', () => {
    const hugeText = 'y'.repeat(MAX_TERMINAL_CHARS + 100);
    const result = appendCapped([], [makeLine('huge', hugeText)]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toHaveLength(MAX_TERMINAL_CHARS);
    expect(result[0].text).toBe(hugeText.slice(-MAX_TERMINAL_CHARS));
  });

  test('empty inputs produce an empty result', () => {
    expect(appendCapped([], [])).toEqual([]);
  });
});
