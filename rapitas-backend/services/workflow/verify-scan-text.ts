/**
 * verify-scan-text
 *
 * Pure text helpers shared by the verify.md honesty gate and the repeat-
 * evidence detector: which regions of a report count as the verifier's own
 * evidence, and which rows are its non-passing checklist findings. No
 * verdict logic lives here.
 */

/**
 * Remove regions that must NOT feed the self-contradiction scan:
 * (a) marker-delimited repair-feedback blocks appended by verify-self-repair —
 *     they quote the PREVIOUS rejection (with failure wording), and re-scanning
 *     them made a past contradiction permanent (task 494's repair loop);
 * (b) ```text fenced blocks — the verifier is instructed to put deliberate-RED
 *     (false-positive verification) log excerpts there, which legitimately
 *     contain failure lines for a CORRECT implementation;
 * (c) the "残課題 / フォローアップ" (unresolved concerns) section — by design
 *     (see workflow-context-builder.ts's prompt) this section documents ALREADY
 *     -explained caveats and pre-existing/false-positive findings from OTHER
 *     tools (e.g. an automated scope-checker's own ❌ markers), not the
 *     verifier's own pass/fail verdict on THIS task. Task 504: an honest,
 *     fully-passing verify.md was blocked because this section discussed a
 *     scope-check's ❌ result across two lines, one of which forward-referenced
 *     the other ("scope ❌ 4件は §残課題 で扱う") without itself containing a
 *     dismissal word on the same line.
 * Other fence types are intentionally kept scannable: genuine test output
 * evidence is usually pasted in bare ``` fences and must stay detectable.
 * Section requirements and verdict-phrase checks still see the full
 * (un-stripped) `content` — only the contradiction scan uses this output.
 *
 * @param content - verify.md body / verify.md 本文
 * @returns Content with non-evidence regions removed / 走査対象本文
 */
export function stripNonEvidenceRegions(content: string): string {
  return content
    .replace(/<!--\s*repair-feedback:start\s*-->[\s\S]*?<!--\s*repair-feedback:end\s*-->/gi, '')
    .replace(/```text[^\S\n]*\n[\s\S]*?\n[ \t]*```/gi, '')
    .replace(/(^|\n)#{1,4}\s*残課題[^\n]*\n[\s\S]*?(?=\n#{1,4}\s|$)/i, '$1');
}

/**
 * The verifier's own non-passing findings: every ⚠️ / ❌ row outside the
 * overall-verdict lines, headings and blockquotes. Used to fingerprint a
 * partial verdict so the repair loop can tell "same findings again" from
 * "a different set" (task 973 handed back the identical ⚠️ set ten rounds
 * running; the generic 'partial verdict' reason hid that).
 *
 * @param content - verify.md body (unstripped) / verify.md 本文
 * @returns Non-passing rows in document order / 未達行
 */
export function collectNonpassingRows(content: string): string[] {
  const rows: string[] = [];
  for (const raw of stripNonEvidenceRegions(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#|^>/.test(line)) continue;
    if (!/⚠️?|❌/.test(line)) continue;
    // The verdict itself (summary line or 全体判定 cell) is not a finding.
    if (/全体判定|overall|検証結果サマリ/i.test(line)) continue;
    if (/^[|*\s-]*(?:⚠️?\s*(?:一部失敗|Partial\b)|❌\s*(?:検証失敗|Fail(?:ed)?\b))/i.test(line)) {
      continue;
    }
    rows.push(line);
  }
  return rows;
}
