/**
 * ai-client-stub tests
 *
 * Pins the stub to the real module's export list. bun's mock.module replaces
 * the whole module for the process, so a stub missing one export makes every
 * later importer of that name fail to load (#1286).
 */
import { describe, test, expect } from 'bun:test';
import * as real from '../../../utils/ai-client';
import { aiClientStub } from './ai-client-stub';

describe('aiClientStub', () => {
  test('provides every runtime export of utils/ai-client', () => {
    const missing = Object.keys(real).filter((k) => !(k in aiClientStub()));
    expect(missing).toEqual([]);
  });

  test('overrides replace the default, other exports stay stubbed', async () => {
    const stub = aiClientStub({ sendAIMessage: async () => ({ content: 'x', tokensUsed: 1 }) });
    expect(await stub.sendAIMessage({ messages: [] })).toEqual({ content: 'x', tokensUsed: 1 });
    expect(typeof stub.getDefaultProvider).toBe('function');
  });
});
