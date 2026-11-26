/**
 * supervisor-agreement-selection
 *
 * Restores which option an operator chose from the free text of an answer, by
 * key first and label second. Pure: no I/O. Not responsible for locating the
 * answer text or for scoring the choice.
 */
import type { ParsedQuestion } from '../services/workflow/question-options-parser';

/** Reasons a choice cannot be restored from the body. */
export type RestoreReason =
  | 'no_selection'
  | 'selection_not_in_options'
  | 'ambiguous_label'
  | 'selection_ambiguous';

export type BodyRestored = { key: string; source: 'key' | 'label' } | { reason: RestoreReason };

// Characters that may follow an option key: the key is then a word of its own.
const KEY_DELIMITERS = /^(?:$|[:：（(\s.。、])/;

/** The `## <id>:` section of the answer, or null when the question has none. */
function sectionOf(lines: string[], id: string): string[] | null {
  const start = lines.findIndex((l) => l.startsWith(`## ${id}:`) || l.startsWith(`## ${id}：`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** The line that carries the choice, with the id and 選択 prefixes removed once each. */
function chosenText(
  q: ParsedQuestion,
  body: string,
  multi: boolean,
): { text: string; keyAllowed: boolean } | null {
  const lines = body.split('\n').map((l) => l.trim());
  const section = sectionOf(lines, q.id);
  const content = (section ?? lines).filter((l) => l !== '' && !l.startsWith('## '));
  const idPrefix = new RegExp(`^${q.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*`);
  // Several questions sharing one unsectioned text: only a line naming this id is ours.
  const line = multi && !section ? content.find((l) => idPrefix.test(l)) : content[0];
  if (line === undefined) return null;
  return {
    text: line
      .replace(idPrefix, '')
      .replace(/^選択\s*[:：]\s*/, '')
      .trim(),
    // 複数質問では節見出しだけでkeyを対応づけず、選択行にも質問idを要求する。
    keyAllowed: !multi || idPrefix.test(line),
  };
}

function matchByKey(q: ParsedQuestion, text: string) {
  const hits = q.options.filter(
    (o) => text.startsWith(o.key) && KEY_DELIMITERS.test(text.slice(o.key.length)),
  );
  // Keys that are prefixes of one another: the longest one is the one written.
  const longest = Math.max(0, ...hits.map((o) => o.key.length));
  return hits.filter((o) => o.key.length === longest);
}

function matchByLabel(q: ParsedQuestion, text: string) {
  const sentence = text.split(/。|（影響:/)[0].trim();
  const beforeImpact = text.split('（影響:')[0].trim();
  const hits = q.options.filter(
    (o) => o.label !== '' && (sentence.startsWith(o.label) || beforeImpact === o.label),
  );
  const longest = Math.max(0, ...hits.map((o) => o.label.length));
  return hits.filter((o) => o.label.length === longest);
}

/**
 * Restore the chosen option of one question from the answer body.
 *
 * @param q - The question as it was asked. / 回答前の質問
 * @param body - The appended answer text. / 追記された回答本文
 * @param multi - True when the question block holds several questions. / 質問が複数か
 * @returns The restored key and how it was found, or why it cannot be restored. / 復元結果
 */
export function restoreFromBody(q: ParsedQuestion, body: string, multi: boolean): BodyRestored {
  const chosen = chosenText(q, body, multi);
  if (chosen === null || chosen.text === '') return { reason: 'no_selection' };
  const { text, keyAllowed } = chosen;
  const byKey = keyAllowed ? matchByKey(q, text) : [];
  const byLabel = matchByLabel(q, text);
  if (byLabel.length > 1) return { reason: 'ambiguous_label' };
  const keyHit = byKey.length === 1 ? byKey[0] : undefined;
  const labelHit = byLabel.length === 1 ? byLabel[0] : undefined;
  if (keyHit && labelHit && keyHit.key !== labelHit.key) return { reason: 'selection_ambiguous' };
  if (keyHit) return { key: keyHit.key, source: 'key' };
  if (labelHit) return { key: labelHit.key, source: 'label' };
  return { reason: 'selection_not_in_options' };
}
