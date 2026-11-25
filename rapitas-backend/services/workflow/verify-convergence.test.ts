/**
 * verify-convergence.test (jury repair appendix)
 *
 * Task 1547: the bounce reason may now end with an appendix of same-kind
 * counterexamples. Identifiers and criterion numbers inside it are the
 * reviewer's examples, not indictments, so the criteria a reason indicts must
 * be the same with or without the appendix. The main detector suite lives in
 * tests/services/verify-convergence.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { identifyIndictedCriteria } from './verify-convergence';
import { JURY_REPAIR_APPENDIX_MARKER } from './jury-repair-reason';

const CRITERIA = [
  '否定の文を矛盾判定に数えない',
  '`bounce-breakdown.ts` が種類別の件数を返す',
  '受入基準番号を数える',
];
const HEADLINE = '差分レビュー不合格: 受入基準1: [major] 否定の取りこぼし（根拠: a.ts:1）';
const APPENDIX =
  `${JURY_REPAIR_APPENDIX_MARKER}\n- 受入基準1 [input_coverage] 否定の取りこぼし\n` +
  '  - bounce-breakdown.ts の受入基準3 の行でも同じ\n' +
  'この種類全体を直し、反例の表をテストにすること。1件だけ直すのは不可。';

describe('identifyIndictedCriteria — jury repair appendix', () => {
  test('an appendix naming other criteria and their tokens changes nothing', () => {
    expect(identifyIndictedCriteria(`${HEADLINE}${APPENDIX}`, CRITERIA)).toEqual(
      identifyIndictedCriteria(HEADLINE, CRITERIA),
    );
    expect(identifyIndictedCriteria(`${HEADLINE}${APPENDIX}`, CRITERIA)).toEqual([1]);
  });

  test('a reason without an appendix is read as before', () => {
    expect(identifyIndictedCriteria('受入基準2 と 受入基準3 が未達', CRITERIA)).toEqual([2, 3]);
  });
});
