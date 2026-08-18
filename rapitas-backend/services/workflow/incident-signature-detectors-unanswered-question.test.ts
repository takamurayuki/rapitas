/**
 * incident-signature-detectors-unanswered-question.test
 *
 * Boundary tests for detectUnansweredQuestion: the threshold detects at >=
 * (inclusive), and an answered or unknown-start question never fires.
 * No DB, no mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectUnansweredQuestion,
  UNANSWERED_QUESTION_THRESHOLD_MS,
  type UnansweredQuestionInput,
} from './incident-signature-detectors';

describe('detectUnansweredQuestion', () => {
  // Reproduction fixture from the incident that motivated this detector:
  // tasks #578/#579 both entered awaiting_question at 2026-08-13T13:48:35Z
  // (cause=intake_question) and sat unanswered until found on 2026-08-17.
  const RAISED_578 = Date.parse('2026-08-13T13:48:35.000Z');
  const FOUND_578 = Date.parse('2026-08-17T13:48:35.000Z'); // 4 days later

  const base: UnansweredQuestionInput = {
    workflowStatus: 'awaiting_question',
    questionRaisedAtMs: RAISED_578,
    hasAnsweredQuestion: false,
    nowMs: FOUND_578,
  };

  it('detects the #578/#579 shape: 4 days unanswered', () => {
    const result = detectUnansweredQuestion(base);
    expect(result).toEqual({ staleMs: FOUND_578 - RAISED_578 });
    expect(result!.staleMs).toBeGreaterThanOrEqual(UNANSWERED_QUESTION_THRESHOLD_MS);
  });

  it('detects at exactly the threshold (>= boundary)', () => {
    expect(
      detectUnansweredQuestion({
        ...base,
        nowMs: RAISED_578 + UNANSWERED_QUESTION_THRESHOLD_MS,
      }),
    ).toEqual({ staleMs: UNANSWERED_QUESTION_THRESHOLD_MS });
  });

  it('does NOT detect 1ms under the threshold', () => {
    expect(
      detectUnansweredQuestion({
        ...base,
        nowMs: RAISED_578 + UNANSWERED_QUESTION_THRESHOLD_MS - 1,
      }),
    ).toBeNull();
  });

  // 非発火正常系: a freshly raised question is a legitimate wait, not an incident.
  it('does NOT detect a question raised moments ago', () => {
    expect(detectUnansweredQuestion({ ...base, nowMs: RAISED_578 + 60_000 })).toBeNull();
  });

  it.each(['draft', 'in_progress', 'completed', null])(
    'does NOT detect when workflowStatus=%p (not awaiting a question)',
    (wf) => {
      expect(detectUnansweredQuestion({ ...base, workflowStatus: wf })).toBeNull();
    },
  );

  // 受入基準4: an answered task must never re-notify, however stale its status.
  it('does NOT detect when the question was already answered', () => {
    expect(detectUnansweredQuestion({ ...base, hasAnsweredQuestion: true })).toBeNull();
  });

  it('does NOT detect when no awaiting_question transition exists (unknown wait start)', () => {
    expect(detectUnansweredQuestion({ ...base, questionRaisedAtMs: null })).toBeNull();
  });

  it('honors a custom thresholdMs override', () => {
    const custom = { ...base, nowMs: RAISED_578 + 5_000, thresholdMs: 4_000 };
    expect(detectUnansweredQuestion(custom)).toEqual({ staleMs: 5_000 });
    expect(detectUnansweredQuestion({ ...custom, thresholdMs: 6_000 })).toBeNull();
  });
});
