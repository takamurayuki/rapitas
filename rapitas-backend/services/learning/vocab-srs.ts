/**
 * vocab-srs
 *
 * Pure spaced-repetition scheduler (SM-2-lite) for vocabulary cards.
 * Computes the next review state from the current state and a grade;
 * holds no database access so the schedule math is unit-testable.
 */

/** Review grade the learner gives after flipping a card. */
export type VocabGrade = 'again' | 'good' | 'easy';

/** SRS state carried on each card. */
export interface VocabSrsState {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

/** Next state plus when the card is due again. */
export interface VocabSrsResult extends VocabSrsState {
  dueAt: Date;
}

// NOTE: Floor from SM-2 — below ~1.3 the interval growth collapses and a card
// gets reviewed forever; SM-2's own experiments settled on this bound.
const MIN_EASE = 1.3;
// A forgotten card comes back within the same session rather than tomorrow.
const AGAIN_RETRY_MINUTES = 10;

/**
 * Compute the next SRS state for a reviewed card (SM-2-lite).
 *
 * - again: forgotten — reset repetitions, retry in 10 minutes, ease -0.2
 * - good:  remembered — interval 1d → 3d → interval×ease
 * - easy:  trivially remembered — like good ×1.3 bonus, ease +0.15
 *
 * @param state - Current SRS fields from the card / 現在のSRS状態
 * @param grade - Learner's self-assessment / 学習者の自己評価
 * @param now - Review timestamp (injectable for tests) / 復習時刻
 * @returns Next SRS fields and due date / 次回のSRS状態と期日
 */
export function computeNextReview(
  state: VocabSrsState,
  grade: VocabGrade,
  now: Date = new Date(),
): VocabSrsResult {
  if (grade === 'again') {
    return {
      intervalDays: 0,
      easeFactor: Math.max(MIN_EASE, state.easeFactor - 0.2),
      repetitions: 0,
      // Only count a lapse when the card had actually been learned before.
      lapses: state.repetitions > 0 ? state.lapses + 1 : state.lapses,
      dueAt: new Date(now.getTime() + AGAIN_RETRY_MINUTES * 60_000),
    };
  }

  const easeFactor =
    grade === 'easy' ? state.easeFactor + 0.15 : Math.max(MIN_EASE, state.easeFactor);
  const repetitions = state.repetitions + 1;

  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 3;
  else intervalDays = state.intervalDays * easeFactor;
  if (grade === 'easy') intervalDays *= 1.3;
  intervalDays = Math.round(intervalDays * 100) / 100;

  return {
    intervalDays,
    easeFactor,
    repetitions,
    lapses: state.lapses,
    dueAt: new Date(now.getTime() + intervalDays * 24 * 60 * 60_000),
  };
}
