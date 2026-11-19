/**
 * DeliverableEligibility
 *
 * Which completed tasks get a deliverable note automatically (design §3.3,
 * Q5 as decided 2026-11-19): a `verify.md` or a `research.md` whose body,
 * without headings and blank lines, is at least DELIVERABLE_MIN_CHARS
 * characters — whatever path completed the task. Pure: no Prisma.
 *
 * The threshold is an adjustable starting value that keeps near-empty files
 * out; it is not a quality bar.
 */

/** Characters a file needs (headings and blank lines excluded). */
export const DELIVERABLE_MIN_CHARS = 200;

/** The kind of deliverable a file makes, and the fixed id it lives under. */
export type DeliverableKind = 'verify' | 'research';

/** Fixed id per kind (§3.3「id を決まった形にする」). */
export function deliverableNoteId(kind: DeliverableKind, taskId: number): string {
  return kind === 'verify' ? `deliverable-task-${taskId}` : `research-task-${taskId}`;
}

/** The note `source` per kind (§3.2). */
export function deliverableSource(kind: DeliverableKind): 'deliverable' | 'research' {
  return kind === 'verify' ? 'deliverable' : 'research';
}

const HEADING = /^\s{0,3}#{1,6}(\s|$)/;

/**
 * Length of a Markdown body without its headings and blank lines, in code
 * points (so Japanese counts per character).
 *
 * @param markdown - The file content / ファイル内容
 * @returns The counted length / 数えた字数
 */
export function meaningfulLength(markdown: string): number {
  let total = 0;
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || HEADING.test(line)) continue;
    total += Array.from(line).length;
  }
  return total;
}

/**
 * Which file, if any, makes this task's deliverable. verify.md (the
 * execution's result) comes first; research.md is used when there is no
 * qualifying verify.md (a research task's result).
 *
 * @param files - verify / research contents when present / 各ファイルの内容
 * @returns The kind to create, or null when neither qualifies / 作成する種類（無ければ null）
 */
export function pickDeliverableKind(files: {
  verify?: string | null;
  research?: string | null;
}): DeliverableKind | null {
  if (files.verify && meaningfulLength(files.verify) >= DELIVERABLE_MIN_CHARS) return 'verify';
  if (files.research && meaningfulLength(files.research) >= DELIVERABLE_MIN_CHARS)
    return 'research';
  return null;
}
