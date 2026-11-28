/**
 * phase-critic.input.test
 *
 * Unit tests for the critic's pure parts: input assembly and truncation, the
 * lens prompt and parser, verdict aggregation and the enable switch. The
 * ai-client driven behaviour is covered by phase-critic.test.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { aggregateCritiques, SEVERE_THRESHOLD } from './critique-aggregator';
import { buildCriticUserMessage, truncateWithNotice } from './phase-critic.input';
import {
  DEFAULT_MAX_PROMPT_TOKENS,
  estimateTokens,
} from '../../../utils/ai-client/prompt-size-guard';
import type { CriticVerdict } from './phase-critic-types';

// Importing ./phase-critic pulls in the ai-client chain; keep it off a real database.
mock.module('../../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));
const { parseCriticResponse, isPhaseCriticEnabled, lensSystemPrompt } =
  await import('./phase-critic');

const v = (over: Partial<CriticVerdict>): CriticVerdict => ({
  lens: 'l',
  pass: true,
  severity: 0,
  issues: [],
  ...over,
});

describe('live evaluation control fixtures', () => {
  it('keeps the short control intact and actually truncates the long control', async () => {
    const { FIXTURES } = await import('../../../scripts/eval-phase-critic');
    const short = FIXTURES.find((f) => f.name === 'adequate-plan-short')!;
    const full = FIXTURES.find((f) => f.name === 'adequate-plan-full-truncated')!;
    // Mirrors ARTIFACT_MAX_CHARS (phase-critic.input.ts) — asserted by value, not
    // imported, since it is a private module constant. AC1: the truncated
    // flag alone does not prove the fixtures actually straddle the 40000
    // threshold; this pins the underlying .length so a future padding
    // regression (task 911 supervisor measurement 2026-09-09) fails loudly.
    const TRUNCATION_THRESHOLD = 40_000;
    expect(short.content.length).toBeLessThan(TRUNCATION_THRESHOLD);
    expect(full.content.length).toBeGreaterThan(TRUNCATION_THRESHOLD);
    expect(buildCriticUserMessage(short.content, short.context).truncated).toBe(false);
    expect(buildCriticUserMessage(full.content, full.context).truncated).toBe(true);
    expect(short.expectedVerdict).toBe('pass');
    expect(full.expectedVerdict).toBe('unknown');
    expect(full.context).toEqual(short.context);
  });
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

describe('truncateWithNotice', () => {
  it('returns text unchanged when within the limit', () => {
    const r = truncateWithNotice('short', 100);
    expect(r).toEqual({ text: 'short', truncated: false });
  });

  it('preserves both the head and the tail of the original text when over the limit', () => {
    const text = `HEAD${'x'.repeat(20000)}TAIL`;
    const r = truncateWithNotice(text, 16000);
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('HEAD')).toBe(true);
    expect(r.text.endsWith('TAIL')).toBe(true);
    expect(r.text).toContain('中略');
    expect(r.text).toContain('原文はここで終わっていません');
    expect(r.text.length).toBeLessThanOrEqual(16000);
  });

  it('preserves task909real plan tail content (実装者への申し送り事項) at the 60/40 head/tail ratio (premortem item 2)', async () => {
    const { FIXTURES } = await import('../../../scripts/eval-phase-critic');
    const realPlan = FIXTURES.find((f) => f.name === 'real-plan-narrow-mismatch')!.content;
    expect(realPlan.length).toBeGreaterThan(16000);
    const r = truncateWithNotice(realPlan, 16000);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('実装者への申し送り事項');
    expect(r.text).toContain('Windowsパス区切り（バックスラッシュ）とUnix区切り');
  });
});

describe('lensSystemPrompt', () => {
  it('forbids demanding plan-level implementation detail only for the research phase', () => {
    const research = lensSystemPrompt('research', { name: 'completeness', angle: 'x' });
    const plan = lensSystemPrompt('plan', { name: 'feasibility', angle: 'x' });
    expect(research).toContain('research.mdの役割は影響範囲・依存関係・リスクの調査');
    expect(plan).not.toContain('research.mdの役割は影響範囲・依存関係・リスクの調査');
  });

  it('forbids treating an omission marker as a real gap in both phases', () => {
    const research = lensSystemPrompt('research', { name: 'completeness', angle: 'x' });
    const plan = lensSystemPrompt('plan', { name: 'feasibility', angle: 'x' });
    expect(research).toContain('省略は表示上の制約であり、原文の欠落ではない');
    expect(plan).toContain('省略は表示上の制約であり、原文の欠落ではない');
  });
});

describe('buildCriticUserMessage', () => {
  it('with no context, is the artifact alone', () => {
    const { message, truncated } = buildCriticUserMessage('plan body');
    expect(message).toBe('# 批評対象アーティファクト\nplan body');
    expect(truncated).toBe(false);
  });

  it('orders grounding sections before the artifact and labels them as reference-only', () => {
    const { message } = buildCriticUserMessage('plan body', {
      taskBrief: 'title\n\ndesc',
      acceptanceCriteria: ['AC1: 満たすこと', 'AC2: 満たすこと'],
      referenceArtifact: 'research body',
      priorReasons: ['issue 1', 'issue 2'],
    });
    const iTask = message.indexOf('# タスク要求');
    const iAc = message.indexOf('# 受入基準');
    const iRef = message.indexOf('# 先行フェーズ文書');
    const iPrior = message.indexOf('# 前回の批評指摘');
    const iArtifact = message.indexOf('# 批評対象アーティファクト');
    expect(iTask).toBeGreaterThanOrEqual(0);
    expect(iAc).toBeGreaterThan(iTask);
    expect(iRef).toBeGreaterThan(iAc);
    expect(iPrior).toBeGreaterThan(iRef);
    expect(iArtifact).toBeGreaterThan(iPrior);
    expect(message).toContain('- issue 1');
    expect(message).toContain('- AC1: 満たすこと');
    expect(message).toContain('批評対象ではない');
  });

  it('omits the acceptance criteria section when none are given', () => {
    const { message } = buildCriticUserMessage('x', { taskBrief: 'brief' });
    expect(message).not.toContain('# 受入基準');
  });

  it('skips empty/whitespace grounding fields', () => {
    const { message, truncated } = buildCriticUserMessage('x', {
      taskBrief: '  ',
      referenceArtifact: '',
      priorReasons: [],
    });
    expect(message).toBe('# 批評対象アーティファクト\nx');
    expect(truncated).toBe(false);
  });

  it('bounds every section (taskBrief 3k / AC 4k / reference 8k / reasons 8 / artifact 40k) without silently dropping the tail', () => {
    const artifact = `HEAD${'a'.repeat(45_000)}TAIL`;
    const { message, truncated } = buildCriticUserMessage(artifact, {
      taskBrief: 'b'.repeat(5000),
      referenceArtifact: 'c'.repeat(10000),
      priorReasons: Array.from({ length: 12 }, (_, i) => `r${i}`),
    });
    expect(truncated).toBe(true);
    expect(message).not.toContain('b'.repeat(3001));
    expect(message).not.toContain('c'.repeat(8001));
    expect(message).toContain('- r7');
    expect(message).not.toContain('- r8');
    // Task 911: the artifact's tail must survive truncation, not just its head.
    expect(message).toContain('HEAD');
    expect(message).toContain('TAIL');
  });

  it('keeps an artifact of exactly 40,000 chars whole and cuts at 40,001', () => {
    const exact = buildCriticUserMessage('a'.repeat(40_000));
    expect(exact.truncated).toBe(false);
    expect(exact.requirementsOrArtifactTruncated).toBe(false);
    expect(exact.message).toContain('a'.repeat(40_000));
    const over = buildCriticUserMessage('a'.repeat(40_001));
    expect(over.truncated).toBe(true);
    expect(over.requirementsOrArtifactTruncated).toBe(true);
  });

  it('stays under the CLI prompt limit with every section at its cap', () => {
    const { message } = buildCriticUserMessage('あ'.repeat(40_000), {
      taskBrief: 'あ'.repeat(3000),
      acceptanceCriteria: ['あ'.repeat(3998)],
      referenceArtifact: 'あ'.repeat(8000),
      priorReasons: Array.from({ length: 8 }, () => 'あ'.repeat(500)),
    });
    const system = lensSystemPrompt('plan', { name: 'acceptance', angle: 'x' });
    expect(estimateTokens(message + system)).toBeLessThan(DEFAULT_MAX_PROMPT_TOKENS);
  });

  it('prepends the truncation warning banner only when a section was actually truncated', () => {
    const truncatedMsg = buildCriticUserMessage('a'.repeat(45_000)).message;
    const untruncatedMsg = buildCriticUserMessage('short').message;
    expect(truncatedMsg.startsWith('⚠️')).toBe(true);
    expect(untruncatedMsg.startsWith('⚠️')).toBe(false);
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
