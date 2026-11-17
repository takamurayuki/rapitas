/**
 * copilot-read-marks
 *
 * When a line of the task consult chat counts as read by ラピ, for the
 * stamp on the user's words. Every turn here is a consult, so the glyph is
 * always 👌 (`stampGlyphFor('consult')`). Not responsible for sending or
 * drawing — see `useCopilotChat` and `MessageBubble`.
 */
import type { CopilotMessage } from './useCopilotChat';

/** The intent of every turn in this chat. / このチャットの意図 */
export const CONSULT_INTENT = 'consult';

type HistoryRow = { id: number; role: string; content: string; createdAt: string };

/**
 * Saved consult history as chat lines. A user line counts as read when her
 * answer follows it; the last one with no saved answer does not.
 *
 * @param rows - `/copilot/chat/:id/history` messages, oldest first / 保存された相談の履歴
 * @returns Chat lines with read marks / 確認の印付きの行
 */
export function toHistoryMessages(rows: readonly HistoryRow[]): CopilotMessage[] {
  return rows.map((m, i) => {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const answered = role === 'user' && rows[i + 1] !== undefined && rows[i + 1].role !== 'user';
    return {
      id: `hist-${m.id}`,
      role,
      content: m.content,
      createdAt: m.createdAt,
      ...(answered ? { readAs: CONSULT_INTENT } : {}),
    };
  });
}

/**
 * Marks one user line as read: her first answer to it has come back.
 *
 * @param messages - The chat / 会話
 * @param id - The user line's id / 発言の id
 * @returns The chat with that line marked / 印を付けた会話
 */
export function markRead(messages: CopilotMessage[], id: string): CopilotMessage[] {
  return messages.map((m) => (m.id === id ? { ...m, readAs: CONSULT_INTENT } : m));
}
