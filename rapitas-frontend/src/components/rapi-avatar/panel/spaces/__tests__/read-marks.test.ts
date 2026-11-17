/**
 * read-marks.test
 *
 * Loaded sentences get their read mark back from what follows them, the
 * same way the mobile app does (`rapiRestoreReadMarks`); nothing is saved.
 */
import { describe, it, expect } from 'vitest';
import { restoreReadMarks } from '../read-marks';
import { toSaved } from '../rapi-spaces-api';

let n = 0;
function row(
  role: string,
  text: string,
  extra: { inHistory?: boolean; kind?: string; taskId?: number } = {},
) {
  return {
    clientId: `c${n++}`,
    role,
    text,
    kind: extra.kind ?? 'text',
    inHistory: extra.inHistory ?? false,
    taskId: extra.taskId ?? null,
  };
}

describe('restoreReadMarks', () => {
  it('reads the intent off the routing note, the card or the reply', () => {
    const rows = [
      row('user', 'a', { inHistory: true }),
      row('system', 'タスク作成として受け取りました — 資料'),
      row('system', '「資料」を起票しました', { taskId: 3 }),
      row('user', 'b', { inHistory: true }),
      row('system', '「要対応」として受け取りました — 一覧'),
      row('user', 'c', { inHistory: true }),
      row('assistant', '', { kind: 'answer' }),
      row('user', 'd', { inHistory: true }),
      row('assistant', 'こんにちは', { inHistory: true }),
    ];
    const marks = restoreReadMarks(rows);
    expect(marks.get(rows[0].clientId)).toBe('create');
    expect(marks.get(rows[3].clientId)).toBe('watch');
    expect(marks.get(rows[5].clientId)).toBe('ask');
    expect(marks.get(rows[7].clientId)).toBe('chat');
  });

  it('marks a web-routed sentence (its card is never saved) once another follows', () => {
    const rows = [
      row('user', 'routed on the web', { inHistory: true }),
      row('user', 'last, nothing saved after it', { inHistory: true }),
    ];
    const marks = restoreReadMarks(rows);
    expect(marks.get(rows[0].clientId)).toBe('chat');
    expect(marks.has(rows[1].clientId)).toBe(false);
  });

  it('leaves failed sends unmarked', () => {
    const rows = [
      row('user', 'x'),
      row('system', '送信に失敗しました'),
      row('user', 'y'),
      row('system', 'タスク作成として受け取りました'),
      row('system', '送信に失敗しました'),
      row('user', 'taken back on the web'),
      row('user', 'z', { inHistory: true }),
    ];
    const marks = restoreReadMarks(rows);
    expect([...marks.keys()]).toEqual([]);
  });

  it('keeps the saved format: a read line saves the same fields as an unread one', () => {
    const base = { id: 1, clientId: 'k', role: 'user' as const, text: 't', inHistory: true };
    const { clientCreatedAt: _a, ...plain } = toSaved(base);
    const { clientCreatedAt: _b, ...read } = toSaved({ ...base, readAs: 'create' });
    expect(read).toEqual(plain);
    expect(Object.keys(read)).not.toContain('readAs');
  });
});
