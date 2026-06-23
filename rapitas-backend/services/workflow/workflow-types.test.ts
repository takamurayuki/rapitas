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

  it('returns false for null', () => {
    expect(isWorkflowStatus(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isWorkflowStatus(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isWorkflowStatus('')).toBe(false);
  });

  it('returns false for an invalid string', () => {
    expect(isWorkflowStatus('invalid_status')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isWorkflowStatus(42)).toBe(false);
  });

  it('returns false for an object', () => {
    expect(isWorkflowStatus({ status: 'draft' })).toBe(false);
  });
});

describe('isWorkflowMode', () => {
  it.each(WORKFLOW_MODES as readonly string[])('returns true for valid mode: %s', (mode) => {
    expect(isWorkflowMode(mode)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isWorkflowMode(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isWorkflowMode(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isWorkflowMode('')).toBe(false);
  });

  it('returns false for an invalid string', () => {
    expect(isWorkflowMode('heavy')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isWorkflowMode(0)).toBe(false);
  });
});

describe('narrowWorkflowStatus', () => {
  it.each(WORKFLOW_STATUSES as readonly string[])(
    'passes through valid status unchanged: %s',
    (status) => {
      expect(narrowWorkflowStatus(status)).toBe(status);
    },
  );

  it('returns default fallback "draft" for null', () => {
    expect(narrowWorkflowStatus(null)).toBe('draft');
  });

  it('returns default fallback "draft" for undefined', () => {
    expect(narrowWorkflowStatus(undefined)).toBe('draft');
  });

  it('returns default fallback "draft" for empty string', () => {
    expect(narrowWorkflowStatus('')).toBe('draft');
  });

  it('returns default fallback "draft" for an invalid string', () => {
    expect(narrowWorkflowStatus('bad_status')).toBe('draft');
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

  it('returns default fallback "comprehensive" for null', () => {
    expect(narrowWorkflowMode(null)).toBe('comprehensive');
  });

  it('returns default fallback "comprehensive" for undefined', () => {
    expect(narrowWorkflowMode(undefined)).toBe('comprehensive');
  });

  it('returns default fallback "comprehensive" for empty string', () => {
    expect(narrowWorkflowMode('')).toBe('comprehensive');
  });

  it('returns default fallback "comprehensive" for an invalid string', () => {
    expect(narrowWorkflowMode('ultra')).toBe('comprehensive');
  });

  it('uses custom fallback "standard" when provided', () => {
    expect(narrowWorkflowMode(null, 'standard')).toBe('standard');
  });

  it('uses custom fallback "lightweight" when provided', () => {
    expect(narrowWorkflowMode('invalid', 'lightweight')).toBe('lightweight');
  });
});
