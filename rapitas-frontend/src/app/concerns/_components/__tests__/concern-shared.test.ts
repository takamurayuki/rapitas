import { describe, it, expect } from 'vitest';
import { Bug, Wrench, ShieldAlert, Gauge, CircleDot } from 'lucide-react';
import {
  TYPE_META,
  TYPE_ORDER,
  TYPE_LABEL_KEY,
  SEVERITY_META,
  SEVERITY_ORDER,
  SEVERITY_LABEL_KEY,
  SEVERITY_HINT_KEY,
  SOURCE_ORDER,
  SOURCE_LABEL_KEY,
  STATUS_TABS,
  type ConcernType,
  type ConcernSeverity,
} from '../concern-shared';

describe('TYPE_META', () => {
  it('maps each concern type to its icon', () => {
    expect(TYPE_META.bug.icon).toBe(Bug);
    expect(TYPE_META.refactor.icon).toBe(Wrench);
    expect(TYPE_META.security.icon).toBe(ShieldAlert);
    expect(TYPE_META.perf.icon).toBe(Gauge);
    expect(TYPE_META.other.icon).toBe(CircleDot);
  });

  it('has a non-empty badge className for every type', () => {
    for (const type of TYPE_ORDER) {
      expect(TYPE_META[type].badge.length).toBeGreaterThan(0);
    }
  });
});

describe('TYPE_ORDER / TYPE_LABEL_KEY', () => {
  it('lists all five concern types', () => {
    expect(TYPE_ORDER).toEqual(['bug', 'refactor', 'security', 'perf', 'other']);
  });

  it('has a label key for every type in TYPE_ORDER', () => {
    for (const type of TYPE_ORDER) {
      expect(TYPE_LABEL_KEY[type as ConcernType]).toBeTruthy();
    }
  });
});

describe('SEVERITY_META', () => {
  it('has a badge and active className for every severity', () => {
    for (const severity of SEVERITY_ORDER) {
      expect(SEVERITY_META[severity].badge.length).toBeGreaterThan(0);
      expect(SEVERITY_META[severity].active.length).toBeGreaterThan(0);
    }
  });
});

describe('SEVERITY_ORDER / SEVERITY_LABEL_KEY / SEVERITY_HINT_KEY', () => {
  it('lists severities from most to least urgent', () => {
    expect(SEVERITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('has a label key and hint key for every severity', () => {
    for (const severity of SEVERITY_ORDER) {
      expect(SEVERITY_LABEL_KEY[severity as ConcernSeverity]).toBeTruthy();
      expect(SEVERITY_HINT_KEY[severity as ConcernSeverity]).toBeTruthy();
    }
  });
});

describe('SOURCE_ORDER / SOURCE_LABEL_KEY', () => {
  it('lists all known sources including the unknown fallback', () => {
    expect(SOURCE_ORDER).toEqual([
      'agent',
      'user',
      'vuln_scan',
      'vuln_scan_audit',
      'ci_watch',
      'loop_review',
      'code_review',
      'github_issue',
      'idea_reclassified',
      'verification-triage',
      'log_health',
      'unknown',
    ]);
  });

  it('has a label key for every source in SOURCE_ORDER', () => {
    for (const source of SOURCE_ORDER) {
      expect(SOURCE_LABEL_KEY[source]).toBeTruthy();
    }
  });

  it('has no orphan label keys outside SOURCE_ORDER', () => {
    expect(Object.keys(SOURCE_LABEL_KEY).sort()).toEqual([...SOURCE_ORDER].sort());
  });
});

describe('STATUS_TABS', () => {
  it('includes open, task_created, and all tabs in that order', () => {
    expect(STATUS_TABS.map((t) => t.value)).toEqual(['open', 'task_created', 'all']);
  });

  it('gives every tab a non-empty labelKey', () => {
    for (const tab of STATUS_TABS) {
      expect(tab.labelKey.length).toBeGreaterThan(0);
    }
  });
});
