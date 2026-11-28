/**
 * self-verify-miss-section — the daily report's self-verify miss numbers (task 1602)
 */
import { describe, expect, test } from 'bun:test';
import {
  appendSelfVerifyMissSection,
  formatSelfVerifyMissSection,
} from './self-verify-miss-section';
import type { SelfVerifyMissSummary } from '../workflow/self-verify-miss';

const summary: SelfVerifyMissSummary = {
  passedRuns: 4,
  misses: 3,
  missedRuns: 2,
  rate: 0.5,
  byKind: [
    { key: 'mechanical', kind: 'mechanical', misses: 1, missedRuns: 1, rate: 0.25 },
    { key: 'judgment', kind: 'judgment', misses: 2, missedRuns: 2, rate: 0.5 },
  ],
  byGate: [
    { key: 'ci:Lint Code', kind: 'mechanical', misses: 1, missedRuns: 1, rate: 0.25 },
    { key: 'verify', kind: 'judgment', misses: 2, missedRuns: 2, rate: 0.5 },
  ],
  candidates: [
    { gate: 'ci:Lint Code', status: 'partial', uncoveredSteps: ['Unused files'], misses: 1 },
    { gate: 'ci:Knip (frontend)', status: 'missing', uncoveredSteps: [], misses: 1 },
  ],
};

describe('formatSelfVerifyMissSection', () => {
  test('shows counts and rates by kind and by gate', () => {
    const md = formatSelfVerifyMissSection(summary);
    expect(md).toContain('## 自己検証の見落とし');
    expect(md).toContain('合格した自己検証 4回');
    expect(md).toContain('見落とし 3件');
    expect(md).toContain('50.0%（2/4）');
    expect(md).toContain('| mechanical（機械の検査） | 1 | 1 | 25.0%（1/4） |');
    expect(md).toContain('| judgment（判断） | 2 | 2 | 50.0%（2/4） |');
    expect(md).toContain('| ci:Lint Code | mechanical | 1 | 25.0%（1/4） |');
    expect(md).toContain('| verify | judgment | 2 | 50.0%（2/4） |');
  });

  test('lists the checks to add to the self-verify catalog', () => {
    const md = formatSelfVerifyMissSection(summary);
    expect(md).toContain('### 自己検証に足す候補');
    expect(md).toContain('| ci:Lint Code | 一部だけ覆っている | Unused files |');
    expect(md).toContain('| ci:Knip (frontend) | 一覧にない | — |');
  });

  test('a day with no passing run reads — instead of a rate', () => {
    const md = formatSelfVerifyMissSection({
      passedRuns: 0,
      misses: 0,
      missedRuns: 0,
      rate: null,
      byKind: [
        { key: 'mechanical', kind: 'mechanical', misses: 0, missedRuns: 0, rate: null },
        { key: 'judgment', kind: 'judgment', misses: 0, missedRuns: 0, rate: null },
      ],
      byGate: [],
      candidates: [],
    });
    expect(md).toContain('合格した自己検証 0回');
    expect(md).toContain('割合 —');
    expect(md).not.toContain('NaN');
    expect(md).not.toContain('### 自己検証に足す候補');
  });

  test('an unreadable ledger says so instead of failing the report', () => {
    expect(formatSelfVerifyMissSection(null)).toContain('集計できませんでした');
  });
});

describe('appendSelfVerifyMissSection', () => {
  test('keeps the AI-formatted body and adds the section after it', () => {
    const md = appendSelfVerifyMissSection('AI整形済みレポート', summary);
    expect(md.startsWith('AI整形済みレポート\n\n## 自己検証の見落とし')).toBe(true);
  });
});
