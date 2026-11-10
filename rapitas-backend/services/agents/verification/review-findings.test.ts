/**
 * review-findings.test
 *
 * The severity + evidence gate of the jury's structured findings, and how a
 * juror reply and the panel vote come out of it (integration policy: only an
 * evidenced blocker/major fails; minor and ungrounded findings are recorded
 * but never bounce the work).
 */
import { describe, expect, test } from 'bun:test';
import {
  parseFindings,
  formatFindingReason,
  findingSeverityScore,
  capFindingsForStorage,
  MAX_STORED_FINDINGS,
} from './review-findings';
import { parseReviewVerdict, aggregateJuryVerdicts } from './adversarial-diff-review-verdict';

describe('parseFindings', () => {
  test('returns null when the reply has no findings array (old shape)', () => {
    expect(parseFindings(undefined)).toBeNull();
    expect(parseFindings('x')).toBeNull();
  });

  test('an evidenced blocker/major gates; a minor never does', () => {
    const f = parseFindings([
      { severity: 'blocker', summary: 'a', evidence: 'src/a.ts:1' },
      { severity: 'major', summary: 'b', evidence: '+ x = 1' },
      { severity: 'minor', summary: 'c', evidence: 'src/c.ts:3' },
    ])!;
    expect(f.map((x) => x.gating)).toEqual([true, true, false]);
  });

  test('a blocker without evidence is kept as 要確認, not gating', () => {
    const [f] = parseFindings([{ severity: 'blocker', summary: 'guess' }])!;
    expect(f.gating).toBe(false);
    expect(f.needsCheck).toBe(true);
    expect(f.evidence).toBeUndefined();
  });

  test('placeholder evidence ("なし", "-", "N/A") counts as no evidence', () => {
    const f = parseFindings([
      { severity: 'major', summary: 'a', evidence: 'なし' },
      { severity: 'major', summary: 'b', evidence: '-' },
      { severity: 'major', summary: 'c', evidence: 'N/A' },
    ])!;
    expect(f.every((x) => !x.gating && x.needsCheck)).toBe(true);
  });

  test('要確認:/管轄外: notes never gate even with evidence and a high severity', () => {
    const f = parseFindings([
      { severity: 'blocker', summary: '要確認: 差分外の呼び出し元', evidence: 'a.ts:1' },
      { severity: 'major', summary: '管轄外: 受入基準2 は実測系', evidence: 'x' },
    ])!;
    expect(f.some((x) => x.gating)).toBe(false);
    expect(f.some((x) => x.needsCheck)).toBe(false);
  });

  test('normalises numbered criteria to 受入基準N and drops items without a summary', () => {
    const f = parseFindings([
      { severity: 'major', criterion: '2', summary: 's', evidence: 'e' },
      { severity: 'major', criterion: 'AC3', summary: 's', evidence: 'e' },
      { severity: 'major', evidence: 'e' },
    ])!;
    expect(f.map((x) => x.criterion)).toEqual(['受入基準2', '受入基準3']);
  });

  test('maps unknown severities to minor and critical/high to blocker/major', () => {
    const f = parseFindings([
      { severity: 'critical', summary: 'a', evidence: 'e' },
      { severity: 'HIGH', summary: 'b', evidence: 'e' },
      { severity: 'nit', summary: 'c', evidence: 'e' },
    ])!;
    expect(f.map((x) => x.severity)).toEqual(['blocker', 'major', 'minor']);
  });
});

describe('formatFindingReason', () => {
  test('keeps the 受入基準N: prefix the non-convergence detector reads', () => {
    expect(
      formatFindingReason({
        severity: 'major',
        criterion: '受入基準2',
        summary: '未実装',
        evidence: 'a.ts:3',
        gating: true,
      }),
    ).toBe('受入基準2: [major] 未実装（根拠: a.ts:3）');
  });

  test('marks an unevidenced finding as 要確認', () => {
    expect(formatFindingReason({ severity: 'major', summary: 'x', gating: false })).toContain(
      '要確認',
    );
  });

  test('severity scores order blocker > major > minor', () => {
    expect(findingSeverityScore('blocker')).toBeGreaterThan(findingSeverityScore('major'));
    expect(findingSeverityScore('major')).toBeGreaterThan(findingSeverityScore('minor'));
  });
});

describe('severity gate on a juror reply', () => {
  test('a "fail" that only lists minor findings is a pass, findings kept', () => {
    const r = parseReviewVerdict(
      JSON.stringify({
        verdict: 'fail',
        severity: 60,
        findings: [{ severity: 'minor', summary: '命名', evidence: 'a.ts:1' }],
      }),
    );
    expect(r.verdict).toBe('pass');
    expect(r.severity).toBe(0);
    expect(r.findings).toHaveLength(1);
  });

  test('a "fail" whose only serious finding has no evidence is a pass (要確認 recorded)', () => {
    const r = parseReviewVerdict(
      JSON.stringify({
        verdict: 'fail',
        findings: [{ severity: 'blocker', summary: 'たぶん壊れる' }],
      }),
    );
    expect(r.verdict).toBe('pass');
    expect(r.findings?.[0].needsCheck).toBe(true);
  });

  test('a "pass" that cites an evidenced blocker is a fail — the verdict follows the findings', () => {
    const r = parseReviewVerdict(
      JSON.stringify({
        verdict: 'pass',
        findings: [{ severity: 'blocker', summary: 'SQL injection', evidence: 'db.ts:9' }],
      }),
    );
    expect(r.verdict).toBe('fail');
    expect(r.severity).toBe(90);
  });

  test('repair feedback (reasons) on fail carries only the gating findings', () => {
    const r = parseReviewVerdict(
      JSON.stringify({
        verdict: 'fail',
        findings: [
          { severity: 'major', summary: 'bug', evidence: 'a.ts:1' },
          { severity: 'minor', summary: 'nit', evidence: 'a.ts:2' },
        ],
      }),
    );
    expect(r.reasons).toEqual(['[major] bug（根拠: a.ts:1）']);
    expect(r.findings).toHaveLength(2);
  });
});

describe('panel vote with structured findings', () => {
  const reply = (findings: unknown[]) =>
    parseReviewVerdict(JSON.stringify({ verdict: 'fail', findings }));

  test('PASS keeps every juror finding (minor → 記録のみ), tagged with its juror', () => {
    const minorOnly = reply([{ severity: 'minor', summary: 'nit', evidence: 'a.ts:1' }]);
    const clean = parseReviewVerdict('{"verdict":"pass","findings":[]}');
    const agg = aggregateJuryVerdicts([
      { provider: 'claude', model: 'opus', ...minorOnly },
      { provider: 'claude', model: 'sonnet', ...clean },
    ]);
    expect(agg.verdict).toBe('pass');
    expect(agg.reasons).toEqual([]);
    expect(agg.findings).toEqual([expect.objectContaining({ summary: 'nit', juror: 'opus' })]);
  });

  test('a tie fails only when one side cited an evidenced serious defect', () => {
    const serious = reply([{ severity: 'major', summary: 'bug', evidence: 'a.ts:1' }]);
    const clean = parseReviewVerdict('{"verdict":"pass","findings":[]}');
    const agg = aggregateJuryVerdicts([
      { provider: 'claude', model: 'opus', ...serious },
      { provider: 'claude', model: 'sonnet', ...clean },
    ]);
    expect(agg.verdict).toBe('fail');

    const ungrounded = reply([{ severity: 'major', summary: 'maybe' }]);
    const agg2 = aggregateJuryVerdicts([
      { provider: 'claude', model: 'opus', ...ungrounded },
      { provider: 'claude', model: 'sonnet', ...clean },
    ]);
    expect(agg2.verdict).toBe('pass');
  });
});

describe('findings beyond the storage cap still decide the verdict', () => {
  const minors = Array.from({ length: 12 }, (_, i) => ({
    severity: 'minor',
    summary: `nit ${i}`,
    evidence: `src/n${i}.ts:1`,
  }));
  const blocker = { severity: 'blocker', summary: 'data loss', evidence: 'src/db.ts:9' };

  test('12 minor + 1 evidenced blocker (13th) is a FAIL — G2 review item 3 reproduction', () => {
    const v = parseReviewVerdict(
      JSON.stringify({ verdict: 'pass', findings: [...minors, blocker] }),
    );
    expect(v.verdict).toBe('fail');
    expect(v.severity).toBe(90);
    expect(v.reasons.some((r) => r.includes('data loss'))).toBe(true);
    // Storage is bounded, but the deciding finding is the one kept first.
    expect(v.findings).toHaveLength(MAX_STORED_FINDINGS);
    expect(v.findings![0]).toMatchObject({ summary: 'data loss', gating: true });
  });

  test('parseFindings itself no longer drops the 13th finding', () => {
    expect(parseFindings([...minors, blocker])).toHaveLength(13);
  });

  test('the panel fails on it too', () => {
    const j = parseReviewVerdict(
      JSON.stringify({ verdict: 'pass', findings: [...minors, blocker] }),
    );
    const agg = aggregateJuryVerdicts([
      { provider: 'claude', model: 'opus', ...j },
      {
        provider: 'claude',
        model: 'sonnet',
        ...parseReviewVerdict('{"verdict":"pass","findings":[]}'),
      },
    ]);
    // 1 fail vs 1 pass → tie → fail, and the blocker survives into the panel record.
    expect(agg.verdict).toBe('fail');
    expect(agg.findings!.some((f) => f.summary === 'data loss' && f.gating)).toBe(true);
  });

  test('capFindingsForStorage keeps gating → 要確認 → rest, original order within rank', () => {
    const f = parseFindings([
      ...minors,
      { severity: 'major', summary: 'unproven' },
      { severity: 'major', summary: 'm1', evidence: 'a.ts:1' },
      blocker,
    ])!;
    const kept = capFindingsForStorage(f, 4);
    expect(kept.map((x) => x.summary)).toEqual(['data loss', 'm1', 'unproven', 'nit 0']);
    expect(capFindingsForStorage(undefined)).toEqual([]);
    expect(capFindingsForStorage(f.slice(0, 3))).toHaveLength(3);
  });
});
