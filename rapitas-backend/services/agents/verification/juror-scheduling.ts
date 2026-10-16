/**
 * JurorScheduling
 *
 * Decides whether the adversarial jury is asked one juror at a time or all
 * at once. Owns only that scheduling; prompts, verdict aggregation and juror
 * health stay in adversarial-diff-review.ts.
 *
 * Why sequential by default: each juror is a `claude --print` process worth
 * ~40% of one core (measured 2026-08-30 on the 4-core host), and three of
 * them started together at every task completion. Serialising trades a few
 * minutes of completion latency for a peak one third as high.
 */

/** `RAPITAS_JURY_PARALLEL=1|on|true` restores the all-at-once panel. Default sequential. */
export function isJuryParallel(): boolean {
  const raw = (process.env.RAPITAS_JURY_PARALLEL ?? '').trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

/**
 * Ask every juror, in order, one after another (default) or concurrently.
 *
 * Never short-circuits: every juror on the panel is always asked, so the
 * majority vote keeps its full panel either way.
 *
 * @param panel - Jurors in panel order. / 陪審の並び
 * @param ask - Asks one juror; its rejection propagates as with Promise.all. / 1 人への問い合わせ
 * @returns Verdicts in panel order. / 並び順どおりの判定
 */
export async function mapJurors<P, V>(panel: P[], ask: (juror: P) => Promise<V>): Promise<V[]> {
  if (isJuryParallel()) return Promise.all(panel.map(ask));
  const verdicts: V[] = [];
  for (const juror of panel) verdicts.push(await ask(juror));
  return verdicts;
}
