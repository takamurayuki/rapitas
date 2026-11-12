/**
 * capabilities.decisions tests (companion design 2章 / 8章, stage 2 item 4)
 *
 * Plan approval, answering a spec question, resolving a review hold, releasing
 * a halt and revise-plan are human decisions. The screen calls the human-only
 * workflow routes directly with `X-Rapitas-Source: ui`; ラピ only links to that
 * screen. These tests fail if any of those decisions becomes something ラピ
 * can do — as a declared capability, or as code on her paths that reaches the
 * human-only routes or forges the header.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ASSISTANT_CAPABILITIES } from './capabilities';

/** Words that would name one of the five decisions in a capability id. */
const DECISION_WORDS =
  /approve|approval|answer|review-hold|hold|release|halt|revise|plan-revision|override|accept|resume/;

/**
 * What reaching a human-only decision looks like in source: the route paths,
 * the services behind them, and the header that marks a human caller.
 */
const DECISION_CALLS = [
  /approve-plan/,
  /answer-question/,
  /review-hold\/resolve/,
  /release-halt/,
  /revise-plan/,
  /x-rapitas-source/i,
  /\bresolveReviewHold\b/,
  /\breleaseTaskHalt\b/,
  /\bhandleApprovePlan\b/,
  /\bhandleAnswerWorkflowQuestion\b/,
  /\bapplyQuestionAnswerByKind\b/,
  /\bpersistPlanRevision\b/,
  /\bhandleRevisePlan\b/,
];

/** ラピ's code: the assistant services, her routes, the companion services. */
const RAPI_DIRS = ['services/assistant', 'routes/ai', 'services/companion'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts') && !name.includes('.test.')) out.push(path);
  }
  return out;
}

const ROOT = join(import.meta.dir, '..', '..');

describe('ラピ has no decision operations', () => {
  test('no capability id names approving, answering, holds, halts or plan revision', () => {
    const offending = ASSISTANT_CAPABILITIES.map((c) => c.id as string).filter((id) =>
      DECISION_WORDS.test(id),
    );
    expect(offending).toEqual([]);
  });

  test('the companion digest is declared as a read', () => {
    const digest = ASSISTANT_CAPABILITIES.find((c) => c.id === 'companion.digest');
    expect(digest).toMatchObject({ writes: false, requiresConfirmation: false });
  });

  test('none of her code reaches a human-only decision route or sends the human header', () => {
    const files = RAPI_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));
    // The scan must actually look at something, or it proves nothing.
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const re of DECISION_CALLS) {
        if (re.test(text)) hits.push(`${file.slice(ROOT.length + 1)}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
