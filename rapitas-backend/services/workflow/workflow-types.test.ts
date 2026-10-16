/**
 * workflow-types.test
 *
 * Unit tests for the type guards and narrowing functions exported from
 * workflow-types. Covers all valid values, null/undefined, empty string,
 * invalid strings, and custom fallback behaviour.
 */

import { describe, it, expect } from 'bun:test';
import { WORKFLOW_STATUSES, WORKFLOW_MODES } from './workflow-types';
import {
  isWorkflowStatus,
  isWorkflowMode,
  narrowWorkflowStatus,
  narrowWorkflowMode,
} from './workflow-types.guards.generated';

describe('isWorkflowStatus', () => {
  it.each(WORKFLOW_STATUSES as readonly string[])('returns true for valid status: %s', (status) => {
    expect(isWorkflowStatus(status)).toBe(true);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty string', value: '' },
    { name: 'an invalid string', value: 'invalid_status' },
    { name: 'a number', value: 42 },
    { name: 'an object', value: { status: 'draft' } },
  ])('returns false for $name', ({ value }) => {
    expect(isWorkflowStatus(value)).toBe(false);
  });
});

describe('isWorkflowMode', () => {
  it.each(WORKFLOW_MODES as readonly string[])('returns true for valid mode: %s', (mode) => {
    expect(isWorkflowMode(mode)).toBe(true);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty string', value: '' },
    { name: 'an invalid string', value: 'heavy' },
    { name: 'a number', value: 0 },
  ])('returns false for $name', ({ value }) => {
    expect(isWorkflowMode(value)).toBe(false);
  });
});

describe('narrowWorkflowStatus', () => {
  it.each(WORKFLOW_STATUSES as readonly string[])(
    'passes through valid status unchanged: %s',
    (status) => {
      expect(narrowWorkflowStatus(status)).toBe(status);
    },
  );

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty string', value: '' },
    { name: 'an invalid string', value: 'bad_status' },
  ])('returns default fallback "draft" for $name', ({ value }) => {
    expect(narrowWorkflowStatus(value)).toBe('draft');
  });

  it('uses a custom fallback when provided', () => {
    expect(narrowWorkflowStatus(null, 'in_progress')).toBe('in_progress');
  });

  it('uses a custom fallback for invalid string', () => {
    expect(narrowWorkflowStatus('bogus', 'research_done')).toBe('research_done');
  });
});

describe('narrowWorkflowMode', () => {
  it.each(WORKFLOW_MODES as readonly string[])(
    'passes through valid mode unchanged: %s',
    (mode) => {
      expect(narrowWorkflowMode(mode)).toBe(mode);
    },
  );

  it.each([
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty string', value: '' },
    { name: 'an invalid string', value: 'ultra' },
  ])('returns default fallback "comprehensive" for $name', ({ value }) => {
    expect(narrowWorkflowMode(value)).toBe('comprehensive');
  });

  it('uses custom fallback "standard" when provided', () => {
    expect(narrowWorkflowMode(null, 'standard')).toBe('standard');
  });

  it('uses custom fallback "lightweight" when provided', () => {
    expect(narrowWorkflowMode('invalid', 'lightweight')).toBe('lightweight');
  });
});
