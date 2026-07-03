/**
 * stream-event-parser テスト
 *
 * processStreamEvent's per-event-type branches (assistant text / tool_use /
 * AskUserQuestion, system init, result) and its defensive handling of
 * missing/malformed fields. Pure — no mocking needed.
 */
import { describe, test, expect } from 'bun:test';
import { processStreamEvent } from './stream-event-parser';

describe('processStreamEvent — assistant events', () => {
  test('extracts plain text blocks into output', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    });
    expect(r.output).toBe('hello world');
    expect(r.isQuestion).toBe(false);
  });

  test('concatenates multiple text blocks in order', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'part1 ' },
          { type: 'text', text: 'part2' },
        ],
      },
    });
    expect(r.output).toBe('part1 part2');
  });

  test('a generic tool_use block appends a [Tool: name] marker', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
    });
    expect(r.output).toContain('[Tool: Bash]');
    expect(r.isQuestion).toBe(false);
  });

  test('an AskUserQuestion tool_use sets isQuestion and extracts the first question text', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Which approach?' }, { question: 'ignored' }] },
          },
        ],
      },
    });
    expect(r.isQuestion).toBe(true);
    expect(r.questionText).toBe('Which approach?');
    expect(r.output).toContain('[質問] Which approach?');
  });

  test('AskUserQuestion with no questions array still sets isQuestion but leaves questionText empty', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] },
    });
    expect(r.isQuestion).toBe(true);
    expect(r.questionText).toBe('');
  });

  test('missing message → empty output, no crash', () => {
    const r = processStreamEvent({ type: 'assistant' });
    expect(r.output).toBe('');
  });

  test('message.content that is not an array is ignored', () => {
    const r = processStreamEvent({ type: 'assistant', message: { content: 'not-an-array' } });
    expect(r.output).toBe('');
  });

  test('non-object blocks inside content are skipped without crashing', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: { content: ['a string block', 42, null, { type: 'text', text: 'ok' }] },
    });
    expect(r.output).toBe('ok');
  });

  test('a text block with an empty string is not appended (falsy check)', () => {
    const r = processStreamEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '' },
          { type: 'text', text: 'kept' },
        ],
      },
    });
    expect(r.output).toBe('kept');
  });
});

describe('processStreamEvent — system events', () => {
  test('subtype=init with a session_id extracts sessionId', () => {
    const r = processStreamEvent({ type: 'system', subtype: 'init', session_id: 'abc-123' });
    expect(r.sessionId).toBe('abc-123');
  });

  test('subtype other than init does not set sessionId', () => {
    const r = processStreamEvent({ type: 'system', subtype: 'other', session_id: 'abc-123' });
    expect(r.sessionId).toBeUndefined();
  });

  test('init subtype but no session_id → sessionId stays undefined', () => {
    const r = processStreamEvent({ type: 'system', subtype: 'init' });
    expect(r.sessionId).toBeUndefined();
  });
});

describe('processStreamEvent — result events', () => {
  test('a string result is appended with a completion marker', () => {
    const r = processStreamEvent({ type: 'result', result: 'All done.' });
    expect(r.output).toContain('[Result: completed]');
    expect(r.output).toContain('All done.');
  });

  test('a non-string result is ignored', () => {
    const r = processStreamEvent({ type: 'result', result: { nested: true } });
    expect(r.output).toBe('');
  });
});

describe('processStreamEvent — unknown event types', () => {
  test('an unrecognized type produces empty, non-crashing output', () => {
    const r = processStreamEvent({ type: 'ping' });
    expect(r.output).toBe('');
    expect(r.isQuestion).toBe(false);
    expect(r.sessionId).toBeUndefined();
  });
});
