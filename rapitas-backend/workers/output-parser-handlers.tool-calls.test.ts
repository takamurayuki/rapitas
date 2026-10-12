/**
 * output-parser-handlers — assistant messages carry raw tool_use inputs
 * (`toolCalls`) so the main thread can record operations for task 1218.
 */
import { describe, expect, test } from 'bun:test';
import { processLine, type ToolInfo } from './output-parser-handlers';

describe('processLine — toolCalls', () => {
  test('assistant-message includes name + raw input of each tool_use', () => {
    const posted: Array<Record<string, unknown>> = [];
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'git status' } },
        ],
      },
    });
    processLine(line, new Map<string, ToolInfo>(), { timeoutSeconds: 60 }, (m) => posted.push(m));
    const msg = posted.find((m) => m.type === 'assistant-message');
    expect(msg?.toolCalls).toEqual([{ id: 'tu_1', name: 'Bash', input: { command: 'git status' } }]);
  });
});
