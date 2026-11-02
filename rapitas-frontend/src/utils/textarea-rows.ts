/**
 * textarea-rows
 *
 * How tall an instruction box should be for the text currently in it.
 *
 * The agent-execution panel has two free-text fields that take natural
 * language — the instruction for the first run and the follow-up afterwards.
 * Both were one-line inputs, which showed about eight characters of what was
 * usually a sentence or three (reported 2026-10-23). They grow now, and they
 * grow the same way.
 */

/** Visible lines before the box stops growing and starts scrolling. */
export const MIN_INSTRUCTION_ROWS = 2;
export const MAX_INSTRUCTION_ROWS = 8;

/**
 * Row count for a growing instruction box.
 *
 * Counts only the newlines actually typed, so a long wrapped line is still
 * one row. That errs small, which scrolls — better than a wall of empty box
 * in a panel this dense.
 *
 * @param value - Current text / 入力中のテキスト
 * @returns Rows, bounded by the two constants above / 行数（上下限つき）
 */
export function instructionRows(value: string): number {
  const lines = value.split('\n').length;
  return Math.min(MAX_INSTRUCTION_ROWS, Math.max(MIN_INSTRUCTION_ROWS, lines));
}
