/**
 * Answer Selections
 *
 * Parses the optional per-question selection audit that a structured
 * (`json:options`) answer sends with its text. Split out of
 * workflow-handlers-resume.ts to keep that file under the size limit.
 */

/** One question's audit record: which option (if any) the user picked. */
export interface AnswerSelection {
  questionId: string;
  selectedKey: string | null;
}

/**
 * Whether a `selections` field was sent but cannot be read.
 *
 * NOTE: Selections now drive behaviour, not just the audit — the criteria
 * question's adopt rewrites the criteria and plan-revision routing reads the
 * key. A wrong shape (2026-11-26: `{"criteria":"adopt"}`) used to be dropped
 * silently while the answer returned ok, so the caller must be told instead.
 *
 * @param raw - The `selections` field from the request body / リクエストの selections
 * @returns True when present but unreadable / 送られたが読めない場合 true
 */
export function isMalformedSelections(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (Array.isArray(raw) && raw.length === 0) return false;
  return parseSelections(raw) === undefined;
}

/**
 * Defensively parse the optional `selections` audit payload from a
 * structured (`json:options`) answer. Malformed/absent input yields
 * `undefined` rather than throwing — `selections` is an audit nicety, never
 * required to apply the answer itself (the `answer` string is authoritative).
 *
 * @param raw - The `selections` field from the request body, unvalidated. / 未検証の selections
 * @returns Parsed selections, or undefined when absent/empty/invalid. / パース結果
 */
export function parseSelections(raw: unknown): AnswerSelection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AnswerSelection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.questionId !== 'string' || !o.questionId.trim()) continue;
    out.push({
      questionId: o.questionId,
      selectedKey: typeof o.selectedKey === 'string' ? o.selectedKey : null,
    });
  }
  return out.length > 0 ? out : undefined;
}
