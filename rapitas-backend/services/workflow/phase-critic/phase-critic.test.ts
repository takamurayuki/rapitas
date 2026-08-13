/**
 * phase-critic.test
 *
 * Unit tests for the pure critique aggregation and the tolerant lens parser.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { aggregateCritiques, SEVERE_THRESHOLD } from './critique-aggregator';
import { parseCriticResponse, isPhaseCriticEnabled, buildCriticUserMessage } from './phase-critic';
import type { CriticVerdict } from './phase-critic-types';

const v = (over: Partial<CriticVerdict>): CriticVerdict => ({
  lens: 'l',
  pass: true,
  severity: 0,
  issues: [],
  ...over,
});

describe('aggregateCritiques', () => {
  it('returns unknown with no verdicts (fail-open)', () => {
    expect(aggregateCritiques([])).toEqual({ verdict: 'unknown', severity: 0, reasons: [] });
  });

  it('passes when all lenses pass', () => {
    expect(aggregateCritiques([v({}), v({}), v({})]).verdict).toBe('pass');
  });

  it('fails when a majority of lenses fail', () => {
    const r = aggregateCritiques([
      v({ lens: 'a', pass: false, severity: 40, issues: ['x'] }),
      v({ lens: 'b', pass: false, severity: 30, issues: ['y'] }),
      v({ pass: true }),
    ]);
    expect(r.verdict).toBe('fail');
    expect(r.reasons).toContain('[a] x');
    expect(r.reasons).toContain('[b] y');
  });

  it('fails on a single severe lens even without a majority', () => {
    const r = aggregateCritiques([
      v({ lens: 'sec', pass: false, severity: SEVERE_THRESHOLD, issues: ['leak'] }),
      v({ pass: true }),
      v({ pass: true }),
    ]);
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(SEVERE_THRESHOLD);
  });

  it('does not fail on a single minor lens', () => {
    const r = aggregateCritiques([v({ pass: false, severity: 20, issues: ['nit'] }), v({}), v({})]);
    expect(r.verdict).toBe('pass');
  });

  it('de-duplicates issues across lenses', () => {
    const r = aggregateCritiques([
      v({ lens: 'a', pass: false, severity: 90, issues: ['dup', 'dup'] }),
    ]);
    expect(r.reasons.filter((x) => x === '[a] dup')).toHaveLength(1);
  });
});

describe('parseCriticResponse', () => {
  it('parses a clean JSON verdict', () => {
    const r = parseCriticResponse('{"pass":false,"severity":70,"issues":["a","b"]}', 'risk');
    expect(r).toEqual({ lens: 'risk', pass: false, severity: 70, issues: ['a', 'b'] });
  });

  it('extracts JSON embedded in prose', () => {
    const r = parseCriticResponse('結果: {"pass":true,"severity":0,"issues":[]} 以上', 'x');
    expect(r.pass).toBe(true);
  });

  it('defaults to pass when no JSON is present (no false block)', () => {
    expect(parseCriticResponse('no json here', 'x').pass).toBe(true);
  });

  it('treats anything but explicit false as pass', () => {
    expect(parseCriticResponse('{"severity":0}', 'x').pass).toBe(true);
  });

  it('clamps severity into 0..100', () => {
    expect(parseCriticResponse('{"pass":false,"severity":999,"issues":["x"]}', 'x').severity).toBe(
      100,
    );
  });
});

describe('buildCriticUserMessage', () => {
  it('with no context, is the artifact alone', () => {
    const msg = buildCriticUserMessage('plan body');
    expect(msg).toBe('# 批評対象アーティファクト\nplan body');
  });

  it('orders grounding sections before the artifact and labels them as reference-only', () => {
    const msg = buildCriticUserMessage('plan body', {
      taskBrief: 'title\n\ndesc',
      referenceArtifact: 'research body',
      priorReasons: ['issue 1', 'issue 2'],
    });
    const iTask = msg.indexOf('# タスク要求');
    const iRef = msg.indexOf('# 先行フェーズ文書');
    const iPrior = msg.indexOf('# 前回の批評指摘');
    const iArtifact = msg.indexOf('# 批評対象アーティファクト');
    expect(iTask).toBeGreaterThanOrEqual(0);
    expect(iRef).toBeGreaterThan(iTask);
    expect(iPrior).toBeGreaterThan(iRef);
    expect(iArtifact).toBeGreaterThan(iPrior);
    expect(msg).toContain('- issue 1');
    expect(msg).toContain('批評対象ではない');
  });

  it('skips empty/whitespace grounding fields', () => {
    const msg = buildCriticUserMessage('x', {
      taskBrief: '  ',
      referenceArtifact: '',
      priorReasons: [],
    });
    expect(msg).toBe('# 批評対象アーティファクト\nx');
  });

  it('bounds every section (taskBrief 3k / reference 8k / reasons 8 / artifact 16k)', () => {
    const msg = buildCriticUserMessage('a'.repeat(20000), {
      taskBrief: 'b'.repeat(5000),
      referenceArtifact: 'c'.repeat(10000),
      priorReasons: Array.from({ length: 12 }, (_, i) => `r${i}`),
    });
    expect(msg).not.toContain('b'.repeat(3001));
    expect(msg).not.toContain('c'.repeat(8001));
    expect(msg).not.toContain('a'.repeat(16001));
    expect(msg).toContain('- r7');
    expect(msg).not.toContain('- r8');
  });
});

describe('isPhaseCriticEnabled', () => {
  const original = process.env.RAPITAS_PHASE_CRITIC;
  afterEach(() => {
    if (original === undefined) delete process.env.RAPITAS_PHASE_CRITIC;
    else process.env.RAPITAS_PHASE_CRITIC = original;
  });

  it('is ON by default (R7 — premortem/critic gate is standing)', () => {
    delete process.env.RAPITAS_PHASE_CRITIC;
    expect(isPhaseCriticEnabled()).toBe(true);
  });

  it('stays on for truthy values', () => {
    for (const val of ['1', 'true', 'on', 'yes']) {
      process.env.RAPITAS_PHASE_CRITIC = val;
      expect(isPhaseCriticEnabled()).toBe(true);
    }
  });

  it('opts out for 0 / false / off', () => {
    for (const val of ['0', 'false', 'off']) {
      process.env.RAPITAS_PHASE_CRITIC = val;
      expect(isPhaseCriticEnabled()).toBe(false);
    }
  });
});
