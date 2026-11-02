/**
 * JurorUnknownReason
 *
 * Says why a juror did not judge, and how many seats the panel really had.
 * Pure: no clock, no database, no policy about what to do with the answer.
 *
 * `unknown` currently means four different things — the call threw, it ran
 * past the deadline, the answer would not parse, or the gate was off — and
 * the record keeps none of them apart. Measured 2026-10-24: gemini and
 * chatgpt went from 32 and 135 unknowns in August to 230 and 231 in
 * September, and nothing in the ledger can say which of the four that was.
 *
 * A fifth case leaves no row at all. A juror rested after repeated timeouts
 * is filtered out of the panel before anyone is asked
 * (adversarial-diff-review.ts), so the review records a smaller jury that
 * answered in full rather than a full jury that lost a seat. Counting the
 * planned seats alongside the asked ones is what makes that visible.
 */

/** Why a juror returned no verdict. */
export type UnknownReason =
  /** The provider call threw — unreachable, refused, no credentials. */
  | 'error'
  /** The juror ran past its deadline and the race resolved without it. */
  | 'timeout'
  /** It answered, but no verdict could be read out of the answer. */
  | 'unparsable'
  /** The gate was switched off, or had no diff to look at. */
  | 'disabled';

/** A juror as the timeline records it. */
export interface RecordedJuror {
  label: string;
  verdict: string;
  unknownReason?: UnknownReason;
}

/** One seat on the panel, before anyone is asked. */
export interface PanelSeat {
  label: string;
}

/** What the panel was meant to be, against what it turned out to be. */
export interface PanelSummary {
  /** Seats the panel was built with. / 構成された席数 */
  planned: number;
  /** Seats actually asked, after resting jurors are dropped. / 実際に聞いた席数 */
  asked: number;
  /** Seats that came back with pass or fail. / 判定を返した席数 */
  judged: number;
  /** Labels dropped before being asked. / 聞く前に外された席 */
  rested: string[];
}

/**
 * Compare the panel that was planned with the one that answered.
 *
 * @param input.planned - Every seat the panel was built with / 構成された全席
 * @param input.asked - The seats actually asked / 実際に問い合わせた席
 * @param input.jurors - What came back / 返ってきた判定
 * @returns Seat counts and the labels dropped / 席数と外された席
 */
export function summarisePanel(input: {
  planned: readonly PanelSeat[];
  asked: readonly PanelSeat[];
  jurors: readonly RecordedJuror[];
}): PanelSummary {
  const askedLabels = new Set(input.asked.map((s) => s.label));
  return {
    planned: input.planned.length,
    asked: input.asked.length,
    judged: input.jurors.filter((j) => j.verdict === 'pass' || j.verdict === 'fail').length,
    rested: input.planned.filter((s) => !askedLabels.has(s.label)).map((s) => s.label),
  };
}

/**
 * Count the unknowns by cause.
 *
 * An unknown carrying no reason is counted as `unattributed` rather than
 * folded into a neighbour: the whole point is that every unknown can be
 * accounted for, and a silent default would hide exactly the case this
 * exists to catch. The counts therefore always sum to the number of
 * unknowns.
 *
 * @param jurors - Every juror on the review / レビューの全陪審員
 * @returns Counts by reason; absent keys mean zero / 理由別の件数
 */
export function unknownBreakdown(jurors: readonly RecordedJuror[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of jurors) {
    if (j.verdict !== 'unknown') continue;
    const key = j.unknownReason ?? 'unattributed';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
