/**
 * stream-event-parser — extractToolUses tests (existing processStreamEvent
 * tests stay untouched in stream-event-parser.test.ts).
 */
import { describe, expect, test } from 'bun:test';
import { extractToolUses, processStreamEvent } from './stream-event-parser';

const event = {
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'working' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'git status' } },
      { type: 'tool_use', id: 'tu_2', name: 'Write', input: { file_path: 'a.ts', content: 'x' } },
      { type: 'tool_use', id: 'tu_3', name: 'AskUserQuestion', input: { questions: [] } },
    ],
  },
};

describe('extractToolUses', () => {
  test('returns name and raw input of every non-question tool_use', () => {
    expect(extractToolUses(event)).toEqual([
      { id: 'tu_1', name: 'Bash', input: { command: 'git status' } },
      { id: 'tu_2', name: 'Write', input: { file_path: 'a.ts', content: 'x' } },
    ]);
  });

  test('non-assistant or malformed events yield nothing', () => {
    expect(extractToolUses({ type: 'result', result: 'x' })).toEqual([]);
    expect(extractToolUses({ type: 'assistant' })).toEqual([]);
    expect(extractToolUses({ type: 'assistant', message: { content: 'nope' } })).toEqual([]);
  });

  test('the existing display output is unchanged', () => {
    expect(processStreamEvent(event).output).toBe(
      'working\n[Tool: Bash]\n\n[Tool: Write]\n\n[質問] \n',
    );
  });
});
