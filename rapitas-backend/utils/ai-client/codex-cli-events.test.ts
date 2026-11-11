/**
 * codex-cli-events.test
 *
 * The JSONL reader for one-shot `codex exec --json` calls: the last agent
 * message is the answer, warning items are not failures, and anything short
 * of a completed turn with an answer fails closed.
 */
import { describe, expect, test } from 'bun:test';
import { describeCodexFailure, parseCodexJsonl } from './codex-cli-events';

const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n');

// Recorded from codex-cli 0.164.0-alpha.9 on 2026-11-11 (prompt: "reply NO_SHELL").
const RECORDED = [
  '{"type":"thread.started","thread_id":"01a1c8eb-8f8d-75f3-a2df-c5ccdf257291"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Code Mode is unavailable because code-mode host is disabled."}}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"I’ll check the requested hostname file with the available shell tool."}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"NO_SHELL"}}',
  '{"type":"turn.completed","usage":{"input_tokens":19897,"cached_input_tokens":18048,"cache_write_input_tokens":0,"output_tokens":63,"reasoning_output_tokens":0}}',
].join('\n');

describe('parseCodexJsonl', () => {
  test('recorded run: last agent message, usage, warning kept but not a failure', () => {
    const s = parseCodexJsonl(RECORDED);
    expect(s.succeeded).toBe(true);
    expect(s.text).toBe('NO_SHELL');
    expect(s.failureMessage).toBeNull();
    expect(s.usage).toEqual({ inputTokens: 19897, cachedInputTokens: 18048, outputTokens: 63 });
    expect(s.warnings).toHaveLength(1);
  });

  test('turn.failed wins over a later answer and carries its message', () => {
    const s = parseCodexJsonl(
      lines(
        { type: 'error', message: "You've hit your usage limit. Try again at 3:05 PM." },
        { type: 'turn.failed', error: { message: "You've hit your usage limit." } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'late' } },
        { type: 'turn.completed', usage: {} },
      ),
    );
    expect(s.succeeded).toBe(false);
    expect(s.failureMessage).toBe("You've hit your usage limit.");
  });

  test('a top-level error without turn.failed is the failure text', () => {
    const s = parseCodexJsonl(lines({ type: 'error', message: 'Not logged in' }));
    expect(s.succeeded).toBe(false);
    expect(s.failureMessage).toBe('Not logged in');
  });

  test('a completed turn without an answer fails closed', () => {
    const s = parseCodexJsonl(lines({ type: 'turn.completed', usage: { input_tokens: 1 } }));
    expect(s.succeeded).toBe(false);
    expect(s.text).toBeNull();
    expect(s.failureMessage).toBeNull();
    expect(describeCodexFailure(s, '')).toBe('Codex CLI returned no answer');
  });

  test('an answer without a completed turn fails closed', () => {
    const s = parseCodexJsonl(
      lines({ type: 'item.completed', item: { type: 'agent_message', text: 'half' } }),
    );
    expect(s.succeeded).toBe(false);
    expect(s.failureMessage).toBeNull();
    expect(describeCodexFailure(s, '')).toBe('Codex CLI did not complete a turn');
  });

  test('blank answers, non-JSON lines and unknown events are ignored', () => {
    const s = parseCodexJsonl(
      [
        'WARN something on stdout',
        '{not json',
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }),
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '  ' } }),
        JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 2 } }),
      ].join('\r\n'),
    );
    // The whitespace message replaces the real one as "last", so no answer.
    expect(s.succeeded).toBe(false);
    expect(s.usage).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 2 });
  });

  test('describeCodexFailure: structured reason > stderr > warning > default', () => {
    const empty = parseCodexJsonl('');
    // The G2 reproduction: stdout empty, the reason only on stderr.
    expect(describeCodexFailure(empty, 'Not logged in. Run codex login.\n')).toBe(
      'Not logged in. Run codex login.',
    );
    const structured = parseCodexJsonl(lines({ type: 'error', message: 'from the stream' }));
    expect(describeCodexFailure(structured, 'from stderr')).toBe('from the stream');
    const warned = parseCodexJsonl(
      lines({ type: 'item.completed', item: { type: 'error', message: 'w' } }),
    );
    expect(describeCodexFailure(warned, 'from stderr')).toBe('from stderr');
    expect(describeCodexFailure(warned, '  ')).toBe('w');
    // A long stderr keeps its end, where the CLI prints the reason.
    const long = `${'x'.repeat(5000)}\nYou've hit your usage limit. Try again at 3:05 PM.`;
    expect(describeCodexFailure(empty, long).endsWith('Try again at 3:05 PM.')).toBe(true);
    expect(describeCodexFailure(empty, long).length).toBe(1000);
  });
});
