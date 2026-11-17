/**
 * note-draft.test
 *
 * A saved reply used to carry the question, a "## ラピの回答" frame and the
 * question's first line as its title (nav66). nav70 saves only the answer,
 * titled and tidied by the model — these tests hold what reaches the model,
 * how its reply is read, and the title fallbacks when it gives no title.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

type SentRequest = {
  provider: string;
  model?: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
};
let reply: string | Error = '';
let sent: SentRequest[] = [];
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: async (req: SentRequest) => {
    sent.push(req);
    if (reply instanceof Error) throw reply;
    return { content: reply, tokensUsed: 0 };
  },
}));

const {
  draftNoteFromReply,
  parseNoteDraftReply,
  resolveNoteDraftTitle,
  NoteDraftUnavailableError,
  NOTE_DRAFT_FALLBACK_TITLE,
} = await import('./note-draft');
const { NOTE_MARKDOWN_FORMAT_RULES } = await import('./note-format-rules');

beforeEach(() => {
  reply = '';
  sent = [];
});

describe('draftNoteFromReply', () => {
  test('returns the model title and the tidied body', async () => {
    reply = 'TITLE: ログイン不具合の調べ方\nBODY:\n## 手順\n\n- ログを見る\n- 再現手順を書く';
    const draft = await draftNoteFromReply('まずログを見ましょう。\n### 手順\n- ログを見る');
    expect(draft).toEqual({
      title: 'ログイン不具合の調べ方',
      content: '## 手順\n\n- ログを見る\n- 再現手順を書く\n',
    });
  });

  test('sends only the answer, under a prompt quoting the note format rules', async () => {
    reply = 'TITLE: t\nBODY:\n本文';
    await draftNoteFromReply('  答えの本文  ');
    expect(sent).toHaveLength(1);
    expect(sent[0].provider).toBe('claude');
    expect(sent[0].messages).toEqual([{ role: 'user', content: '回答:\n答えの本文' }]);
    expect(sent[0].systemPrompt).toContain(NOTE_MARKDOWN_FORMAT_RULES);
    // The frame the old clients built is named only as something not to write.
    expect(sent[0].systemPrompt).toContain('「## 質問」「## ラピの回答」のような枠');
  });

  test('without a title, the body first line is the title', async () => {
    reply = 'TITLE:\nBODY:\n## 今週の進め方\n本文';
    expect((await draftNoteFromReply('答え')).title).toBe('今週の進め方');
  });

  test('a reply that ignores the format is taken as the body', async () => {
    reply = '## 今週の進め方\n- 月曜に計画';
    expect(await draftNoteFromReply('答え')).toEqual({
      title: '今週の進め方',
      content: '## 今週の進め方\n- 月曜に計画\n',
    });
  });

  test('no body is an error, not an empty note', async () => {
    reply = 'TITLE: タイトルだけ\nBODY:\n   ';
    await expect(draftNoteFromReply('答え')).rejects.toBeInstanceOf(NoteDraftUnavailableError);
  });

  test('a failed model call is passed on', async () => {
    reply = new Error('cli down');
    await expect(draftNoteFromReply('答え')).rejects.toThrow('cli down');
  });
});

describe('parseNoteDraftReply', () => {
  test('drops a fence around the whole reply and keeps fences inside the body', () => {
    const raw = '```\nTITLE: 設定\nBODY:\n```ts\nconst a = 1;\n```\n```';
    expect(parseNoteDraftReply(raw)).toEqual({
      title: '設定',
      content: '```ts\nconst a = 1;\n```',
    });
  });

  test('reads CRLF replies', () => {
    expect(parseNoteDraftReply('TITLE: 件名\r\nBODY:\r\n本文')).toEqual({
      title: '件名',
      content: '本文',
    });
  });

  test('drops a fence around a CRLF reply', () => {
    const raw = '```markdown\r\nTITLE: 件名\r\nBODY:\r\n## 見出し\r\n本文\r\n```';
    expect(parseNoteDraftReply(raw)).toEqual({
      title: '件名',
      content: '## 見出し\n本文',
    });
  });
});

describe('draftNoteFromReply with a fenced CRLF reply', () => {
  test('an empty body inside the fence is still an error', async () => {
    reply = '```markdown\r\nTITLE: タイトルだけ\r\nBODY:\r\n\r\n```';
    await expect(draftNoteFromReply('答え')).rejects.toBeInstanceOf(NoteDraftUnavailableError);
  });
});

describe('resolveNoteDraftTitle', () => {
  test('falls back to ラピとの会話 when nothing has a line', () => {
    expect(resolveNoteDraftTitle('', '  \n# \n')).toBe(NOTE_DRAFT_FALLBACK_TITLE);
    expect(NOTE_DRAFT_FALLBACK_TITLE).toBe('ラピとの会話');
  });

  test('drops Markdown markers and cuts a long title at 30 characters', () => {
    expect(resolveNoteDraftTitle('## 見出し', '')).toBe('見出し');
    expect(resolveNoteDraftTitle('あ'.repeat(40), '')).toBe(`${'あ'.repeat(30)}…`);
    expect(resolveNoteDraftTitle('あ'.repeat(30), '')).toBe('あ'.repeat(30));
  });
});
