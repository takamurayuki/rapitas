/**
 * blocked-retry-resume-stage.test
 *
 * Pins the resume decision table and the fact loader's fail-toward-draft rule (task 1563).
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { decideResumeStage, loadResumeFacts, type ResumeFacts } from './blocked-retry-resume-stage';

const base: ResumeFacts = {
  stage: null,
  dirExists: false,
  hasPr: false,
  prState: null,
  unpushedCommits: null,
};

describe('decideResumeStage', () => {
  test.each([
    ['plan_approved', { dirExists: true }, 'keep_stage', 'plan_approved'],
    ['in_progress', { hasPr: true }, 'keep_stage', 'in_progress'],
    ['plan_created', { dirExists: true }, 'keep_stage', 'plan_created'],
    ['plan_created', { hasPr: true }, 'keep_stage', 'plan_created'],
    ['verify_done', { prState: 'open' }, 'merge_wait', 'verify_done'],
    ['verify_done', { hasPr: true, prState: 'open' }, 'merge_wait', 'verify_done'],
    ['verify_done', { hasPr: true, prState: 'merged' }, 'complete', null],
    ['verify_done', { dirExists: true }, 'keep_stage', 'in_progress'],
    [
      'verify_done',
      { dirExists: true, hasPr: true, prState: 'closed' },
      'keep_stage',
      'in_progress',
    ],
    ['verify_done', { dirExists: true, hasPr: true, prState: null }, 'keep_stage', 'in_progress'],
    ['verify_done', { hasPr: true, prState: 'closed' }, 'leave', null],
    ['verify_done', { hasPr: true, prState: null }, 'leave', null],
    ['verify_done', {}, 'draft', 'draft'],
    ['research_done', {}, 'draft', 'draft'],
    ['research_done', { dirExists: true, hasPr: true }, 'draft', 'draft'],
    ['draft', { dirExists: true }, 'draft', 'draft'],
    ['plan_approved', {}, 'draft', 'draft'],
    ['in_progress', {}, 'draft', 'draft'],
    ['plan_created', {}, 'draft', 'draft'],
    [null, {}, 'draft', 'draft'],
    [null, { dirExists: true }, 'leave', null],
    ['not_a_stage', { dirExists: true }, 'leave', null],
    ['not_a_stage', {}, 'draft', 'draft'],
    ['in_progress', { workUnknown: true }, 'leave', null],
    ['verify_done', { workUnknown: true }, 'leave', null],
    [null, { workUnknown: true }, 'leave', null],
    ['research_done', { workUnknown: true }, 'leave', null],
    ['draft', { workUnknown: true }, 'leave', null],
    ['in_progress', { workUnknown: true, dirExists: true }, 'keep_stage', 'in_progress'],
    [null, { hasPr: true }, 'leave', null],
  ] as const)('%s %j → %s', (stage, patch, kind, resumed) => {
    const d = decideResumeStage({ ...base, stage, ...patch });
    expect(d.kind).toBe(kind);
    expect(d.stage).toBe(resumed);
  });

  test('PR の state は大文字小文字を区別しない', () => {
    expect(decideResumeStage({ ...base, stage: 'verify_done', prState: 'MERGED' }).kind).toBe(
      'complete',
    );
  });
});
