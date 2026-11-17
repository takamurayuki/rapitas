/**
 * read-marks
 *
 * Gives loaded lines back the "she has read it" mark. The mark is never
 * saved, so it is read off what follows each sentence in the saved rows —
 * the same rule as rapitas-mobile `rapiRestoreReadMarks`
 * (lib/models/rapi_chat/rapi_read_mark.dart). Not responsible for the glyph
 * (`stampGlyphFor`) or for marking live sentences (`useRapiConversation`).
 */
import { READ_AS_CHAT, SEND_FAILED_NOTES, intentOfRoutingNote } from '@/components/ui/chat';
import type { SavedMessage } from './rapi-spaces-api';

type Row = Pick<SavedMessage, 'clientId' | 'role' | 'kind' | 'text' | 'inHistory' | 'taskId'>;

/** Card kinds the mobile app saves, and the intent each answers. */
const INTENT_BY_KIND: Record<string, string> = {
  answer: 'ask',
  change: 'change',
  criteria: 'change',
  roadmap: 'roadmap',
  tidy: 'tidy',
  companion: 'companion',
};

/** The intent one of her rows shows for its turn, if any. */
function intentOfRow(row: Row): string | null {
  if (row.role === 'system') {
    return intentOfRoutingNote(row.text) ?? (row.taskId != null ? 'create' : null);
  }
  if (row.kind !== 'text') return INTENT_BY_KIND[row.kind] ?? null;
  return row.role === 'assistant' && row.text ? READ_AS_CHAT : null;
}

/**
 * What each saved sentence was read as.
 *
 * A sentence's turn runs to the next sentence. It counts as read when the
 * turn holds no send-failure note and either (a) one of her rows follows
 * (a reply, a card, a note), or (b) it is still in the history and another
 * sentence follows — a send blocks the next one and a failure takes the
 * sentence out of the history, so its turn ended well even though the
 * web's routed cards are never saved. The intent is read off the turn's
 * rows, or falls back to a talk (👌). A last sentence with nothing saved
 * after it gets no mark.
 *
 * @param rows - Saved rows in order, routing notes included / 保存された行（振り分けの案内を含む）
 * @returns clientId of each read sentence → its intent / 確認済みの発言と意図
 */
export function restoreReadMarks(rows: readonly Row[]): Map<string, string> {
  const marks = new Map<string, string>();
  rows.forEach((row, i) => {
    if (row.role !== 'user') return;
    let failed = false;
    let answered = false;
    let followed = false;
    let intent: string | null = null;
    for (const next of rows.slice(i + 1)) {
      if (next.role === 'user') {
        followed = true;
        break;
      }
      if (next.role === 'system' && SEND_FAILED_NOTES.includes(next.text)) failed = true;
      answered = true;
      intent ??= intentOfRow(next);
    }
    if (failed || !(answered || (row.inHistory && followed))) return;
    marks.set(row.clientId, intent ?? READ_AS_CHAT);
  });
  return marks;
}
