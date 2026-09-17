/**
 * supervision-events tests
 *
 * Payload contract: valid payloads parse, missing schemaVersion / unknown enums are
 * rejected, and a snapshot can never claim met=true alongside unmet reasons.
 */
import { describe, expect, test } from 'bun:test';
import {
  parseAcceptanceSnapshotPayload,
  parseHeartbeatPayload,
  parseInterventionPayload,
  parseKnowledgeReuseEvalPayload,
  parseObservationGapPayload,
} from './supervision-events';

describe('parseInterventionPayload', () => {
  const valid = {
    schemaVersion: 1,
    taskId: 7,
    sourceKind: 'workflow_transition_user',
    detectedAt: '2026-09-10T00:00:00.000Z',
    note: 'x',
  };

  test('accepts a valid payload', () => {
    expect(parseInterventionPayload(valid)?.taskId).toBe(7);
  });

  test.each([
    ['missing schemaVersion', { ...valid, schemaVersion: undefined }],
    ['unknown sourceKind', { ...valid, sourceKind: 'telepathy' }],
    ['future schemaVersion', { ...valid, schemaVersion: 99 }],
  ])('rejects a payload with %s', (_label, payload) => {
    expect(parseInterventionPayload(payload)).toBeNull();
  });
});

describe('parseObservationGapPayload', () => {
  test('accepts unknown as an evidence-free stop reason', () => {
    const gap = parseObservationGapPayload({
      schemaVersion: 1,
      monitorId: 'backend',
      startAt: '2026-09-10T00:00:00Z',
      endAt: '2026-09-10T01:00:00Z',
      reasonKind: 'unknown',
    });
    expect(gap?.reasonKind).toBe('unknown');
    expect(gap?.recoveredAt).toBe('2026-09-10T01:00:00Z');
  });

  test('rejects an inverted interval', () => {
    expect(
      parseObservationGapPayload({
        schemaVersion: 1,
        startAt: '2026-09-10T02:00:00Z',
        endAt: '2026-09-10T01:00:00Z',
        reasonKind: 'unknown',
      }),
    ).toBeNull();
  });
});

describe('parseHeartbeatPayload', () => {
  test('rejects a non-positive interval', () => {
    expect(
      parseHeartbeatPayload({
        schemaVersion: 1,
        monitorId: 'backend',
        sourceKind: 'backend_timer',
        intervalMs: 0,
      }),
    ).toBeNull();
  });
});

describe('parseKnowledgeReuseEvalPayload', () => {
  test('an empty paired sample is never sufficient even if the producer says so', () => {
    const parsed = parseKnowledgeReuseEvalPayload({
      schemaVersion: 1,
      evalSetVersion: 'v1',
      methodVersion: 'm1',
      pairedN: 0,
      sufficientEvidence: true,
    });
    expect(parsed?.sufficientEvidence).toBe(false);
  });
});

describe('parseAcceptanceSnapshotPayload', () => {
  test('met=true with unmet reasons is read as unmet', () => {
    const parsed = parseAcceptanceSnapshotPayload({
      schemaVersion: 1,
      met: true,
      streakCount: 10,
      reasonCodes: ['snapshot_stale'],
      denominators: { heartbeatCount: 3, nested: { dropped: true } },
    });
    expect(parsed?.met).toBe(false);
    expect(parsed?.denominators).toEqual({ heartbeatCount: 3 });
  });
});
