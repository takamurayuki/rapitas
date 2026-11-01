// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * agent-api-key-router.id-validation.test
 *
 * Proves POST/DELETE /agents/:id/api-key refuse an id that names no row, and
 * that they refuse it BEFORE the secret store is touched.
 *
 * This route was missed by #1349's first six passes. The id arrived as
 * `const { id } = context.params as { id: string }`, and that type assertion
 * stopped require-validated-id-param from resolving where the value came from,
 * so all seven coercions in the file looked like reads of something else. The
 * rule now unwraps assertions; this file holds the route down from the other
 * side.
 *
 * The assertions are on the collaborators, not the status code: writing an API
 * key onto the wrong agent is the harm, and a 400 that had already written one
 * would pass a status-only check. The secret store matters most — a row update
 * can be read back and corrected, a key written into the wrong account cannot.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockDb = {
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
};

const mockSaveAgentApiKey = mock(() => 'keychain:agent-5');
const mockDeleteStoredSecret = mock(() => undefined);
const mockLogAgentConfigChange = mock(() => Promise.resolve());

mock.module('../../../config', () => ({
  prisma: mockDb,
  getProjectRoot: () => '/tmp/rapitas-test',
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

// NOTE: every export mirrored — bun's mock.module replaces the whole module, so
// a missing one makes this file stop with a single error and its tests vanish.
mock.module('../../../utils/common/encryption', () => ({
  maskApiKey: (value: string) => value,
  isEncryptionKeyConfigured: () => true,
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));

mock.module('../../../utils/common/secret-store', () => ({
  saveAgentApiKey: mockSaveAgentApiKey,
  deleteStoredSecret: mockDeleteStoredSecret,
  saveSecret: mock(() => 'keychain:x'),
  readSecret: mock(() => null),
  isSecretRef: () => false,
}));

mock.module('../../../utils/agent/agent-audit-log', () => ({
  logAgentConfigChange: mockLogAgentConfigChange,
}));

const { agentApiKeyRouter } = await import('./agent-api-key-router');

const BASE = 'http://localhost/agents';

// NOTE(#1357): deliberately low-entropy and obviously fake. A realistic-looking
// literal here ('sk-' + digits) tripped gitleaks' generic-api-key rule on
// entropy alone and failed the Secret scanning gate — the value never needed to
// look real, since the point is that it is never written anywhere.
const DUMMY_KEY = 'test-api-key';

/** Restores the "agent 5 is real and already holds a key" world. */
function resetMocks() {
  mockDb.aIAgentConfig.findUnique.mockReset();
  // A row the prefix NAMES. Left at null, every case would stop at a 404 and
  // the test would pass without the dangerous path being walked at all.
  mockDb.aIAgentConfig.findUnique.mockResolvedValue({
    id: 5,
    apiKeyEncrypted: 'keychain:agent-5',
  });
  mockDb.aIAgentConfig.update.mockReset();
  mockDb.aIAgentConfig.update.mockResolvedValue({});
  mockSaveAgentApiKey.mockClear();
  mockDeleteStoredSecret.mockClear();
  mockLogAgentConfigChange.mockClear();
}

// Each of these resolves to agent 5, or to no agent at all.
const TRUNCATING_IDS: [string, string][] = [
  ['a trailing suffix', '5abc'],
  ['exponent notation', '5e2'],
  ['hex notation', '0x5'],
  ['a decimal', '5.9'],
  ['zero', '0'],
  ['a negative number', '-3'],
  ['a number past MAX_SAFE_INTEGER', '99999999999999999999'],
];

describe('POST /agents/:id/api-key — an id that names no agent', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) before writing a key anywhere', async (_label, raw) => {
    const res = await agentApiKeyRouter.handle(
      new Request(`${BASE}/${raw}/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: DUMMY_KEY }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    // The secret store is never reached.
    expect(mockSaveAgentApiKey).not.toHaveBeenCalled();
    // Nor is the database, in either direction.
    expect(mockDb.aIAgentConfig.findUnique).not.toHaveBeenCalled();
    expect(mockDb.aIAgentConfig.update).not.toHaveBeenCalled();
    expect(mockLogAgentConfigChange).not.toHaveBeenCalled();
  });
});

describe('DELETE /agents/:id/api-key — an id that names no agent', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) before deleting a secret', async (_label, raw) => {
    const res = await agentApiKeyRouter.handle(
      new Request(`${BASE}/${raw}/api-key`, { method: 'DELETE' }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockDeleteStoredSecret).not.toHaveBeenCalled();
    expect(mockDb.aIAgentConfig.findUnique).not.toHaveBeenCalled();
    expect(mockDb.aIAgentConfig.update).not.toHaveBeenCalled();
    expect(mockLogAgentConfigChange).not.toHaveBeenCalled();
  });
});

describe('a valid id still reaches the secret store', () => {
  beforeEach(resetMocks);

  // Over-correction guard: refusing everything would satisfy both blocks above.
  it('stores the key against the agent the id names', async () => {
    const res = await agentApiKeyRouter.handle(
      new Request(`${BASE}/5/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: DUMMY_KEY }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSaveAgentApiKey).toHaveBeenCalledWith(5, DUMMY_KEY);
    expect(mockDb.aIAgentConfig.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { apiKeyEncrypted: 'keychain:agent-5' },
    });
  });

  it('deletes the stored secret of the agent the id names', async () => {
    const res = await agentApiKeyRouter.handle(
      new Request(`${BASE}/5/api-key`, { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(mockDeleteStoredSecret).toHaveBeenCalledWith('keychain:agent-5');
    expect(mockDb.aIAgentConfig.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { apiKeyEncrypted: null },
    });
  });
});
