/**
 * concern-bridge.test
 *
 * Unit tests for the pure mapping helpers of the concern<->issue bridge
 * (label parsing + issue content). DB/gh paths are covered by integration.
 */
import { describe, it, expect } from 'bun:test';
import { labelValue, buildIssueContent } from './concern-bridge';

describe('labelValue', () => {
  it('extracts the value after a matching prefix', () => {
    const labels = JSON.stringify(['type:bug', 'priority:high']);
    expect(labelValue(labels, 'type')).toBe('bug');
    expect(labelValue(labels, 'priority')).toBe('high');
  });

  it('returns undefined when the prefix is absent', () => {
    expect(labelValue(JSON.stringify(['enhancement']), 'type')).toBeUndefined();
  });

  it('returns undefined for empty / malformed JSON', () => {
    expect(labelValue('', 'type')).toBeUndefined();
    expect(labelValue('not json', 'type')).toBeUndefined();
  });

  it('only matches the prefix at the start, not mid-string', () => {
    expect(labelValue(JSON.stringify(['subtype:bug']), 'type')).toBeUndefined();
  });

  it('preserves values that themselves contain a colon', () => {
    expect(labelValue(JSON.stringify(['loc:src/a.ts:42']), 'loc')).toBe('src/a.ts:42');
  });
});

describe('buildIssueContent', () => {
  const base = { id: 7, type: 'bug', severity: 'high', detail: 'It breaks', location: null };

  it('maps type and severity to labels', () => {
    const { labels } = buildIssueContent(base);
    expect(labels).toContain('type:bug');
    expect(labels).toContain('priority:high');
  });

  it('appends extra labels', () => {
    const { labels } = buildIssueContent(base, ['needs-triage']);
    expect(labels).toEqual(['type:bug', 'priority:high', 'needs-triage']);
  });

  it('keeps the detail and adds a provenance footer referencing the concern id', () => {
    const { body } = buildIssueContent(base);
    expect(body).toContain('It breaks');
    expect(body).toContain('#7');
  });

  it('includes the location when present', () => {
    const { body } = buildIssueContent({ ...base, location: 'src/auth.ts:42' });
    expect(body).toContain('対象箇所: src/auth.ts:42');
  });

  it('omits the location line when absent', () => {
    const { body } = buildIssueContent(base);
    expect(body).not.toContain('対象箇所');
  });
});
