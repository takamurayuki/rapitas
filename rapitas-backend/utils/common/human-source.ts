/**
 * human-source
 *
 * Resolves the X-Rapitas-Source header of a human-only route to the label the
 * route records. Not responsible for deciding which sources a route accepts —
 * each route passes its own label table.
 */

/**
 * The label for a human caller, or undefined when the header names no allowed
 * source.
 *
 * NOTE: An own-key lookup, not `labels[key]`. Indexing a plain object with the
 * raw header let inherited keys through — `X-Rapitas-Source: constructor`
 * resolved to Object's constructor (truthy) and passed the human-only guard
 * of release-halt, approve-plan, revise-plan and answer-question
 * (found by halt-release.routes.test.ts; review-hold.routes.ts had already
 * moved to a Map for the same reason).
 *
 * @param raw - Raw header value / ヘッダの生の値
 * @param labels - Allowed sources (lower-case) and their labels / 許可する発行元と記録用ラベル
 * @returns The label, or undefined / ラベル、許可されていなければ undefined
 */
export function humanSourceLabel(
  raw: unknown,
  labels: Readonly<Record<string, string>>,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.toLowerCase();
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;
}
