/**
 * note-draft
 *
 * Turns one of ラピ's chat replies into a note draft — a title that fits the
 * content and a body tidied into a document — before the client saves it.
 * Not responsible for saving or linking the note: the client does that with
 * the ordinary `PUT /notes/:id` and `POST /notes/:id/links` afterwards.
 *
 * Why (nav70, 2026-11-17): a saved reply used to carry the question, a
 * "## ラピの回答" frame and the question's first line as its title. The user
 * wanted only the answer, under a title of its own, shaped as a document.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import { NOTE_MARKDOWN_FORMAT_RULES } from './note-format-rules';

const logger = createLogger('note-draft');

/** Title used when neither the model nor the body offers a line. */
export const NOTE_DRAFT_FALLBACK_TITLE = 'ラピとの会話';

/** Characters a title keeps before it is cut with an ellipsis. */
export const NOTE_DRAFT_TITLE_MAX = 30;

/** Tier the copilot uses for everyday replies; a rewrite of one reply needs no more. */
const DRAFT_MODEL = 'claude-haiku-4-5-20251001';

/** Room for a long reply rewritten in full (the copilot's own replies stop at 2000). */
const DRAFT_MAX_TOKENS = 4000;

/** A note ready to save. / 保存するノートの下書き */
export interface NoteDraft {
  title: string;
  content: string;
}

/** Thrown when the model gave nothing that can become a note body. */
export class NoteDraftUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteDraftUnavailableError';
  }
}

// NOTE: a delimited reply rather than JSON — the body is multi-line Markdown
// full of quotes and backslashes, which a model escapes unreliably in JSON.
const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
チャットでの自分の回答を、ノートに保存する文書に整えます。

出すもの:
1. タイトル: 内容に合った簡潔な日本語（目安30字以内）。装飾（記号・絵文字・括弧書きの注記）や日付は付けない。
2. 本文: 回答をドキュメントとして整えたもの。

守ること:
1. 回答に無い情報を足さない。会話向けの前置き・相づち・締めの挨拶は落としてよいが、情報は落とさない。
2. 質問文、「## 質問」「## ラピの回答」のような枠、「以下にまとめます」のような前置きは入れない。
3. 回答の見出しが ### や #### なら、## と ### に繰り上げる。
4. 必要に応じて箇条書き・表・段落を整える。短い回答に見出しを無理に付けない。
5. 説明やコードブロックで全体を囲まず、次の形だけで答える:

TITLE: <タイトル>
BODY:
<本文>

${NOTE_MARKDOWN_FORMAT_RULES}`;

/** First non-empty line with leading Markdown markers (#, >, -, *) removed. */
function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s#>*-]+/, '').trim();
    if (line) return line;
  }
  return '';
}

/** Cut by characters (code points), so an emoji is never split in half. */
function shorten(line: string): string {
  const chars = Array.from(line);
  return chars.length > NOTE_DRAFT_TITLE_MAX
    ? `${chars.slice(0, NOTE_DRAFT_TITLE_MAX).join('')}…`
    : line;
}

/** Drop a fence the model may have wrapped the whole reply in despite the prompt. */
function unfence(text: string): string {
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1] : text;
}

/**
 * Reads the model's reply as a draft. A reply without the TITLE/BODY markers
 * is taken as the body, so a model that forgot the format still yields a note.
 *
 * @param reply - the model's raw text / モデルの返答そのもの
 * @returns title (possibly empty) and body / タイトル（空のこともある）と本文
 */
export function parseNoteDraftReply(reply: string): { title: string; content: string } {
  // NOTE: Newlines are normalised before unfence — its pattern matches LF only,
  // so a fenced CRLF reply would otherwise keep the fence and the markers.
  const text = unfence(reply.replace(/\r\n/g, '\n'));
  const match = text.match(/^\s*TITLE:[ \t]*(.*)\n+BODY:[ \t]*\n?([\s\S]*)$/);
  if (!match) return { title: '', content: text.trim() };
  return { title: match[1].trim(), content: match[2].trim() };
}

/**
 * The title a draft is saved under: the model's, else the body's first
 * line, else NOTE_DRAFT_FALLBACK_TITLE. Markdown markers are dropped and
 * an over-long title is cut so the note list stays readable.
 *
 * @param modelTitle - the title the model gave, possibly empty / モデルが付けたタイトル（空のこともある）
 * @param content - the tidied body / 整えた本文
 * @returns the title to save / 保存するタイトル
 */
export function resolveNoteDraftTitle(modelTitle: string, content: string): string {
  const line = firstLine(modelTitle) || firstLine(content);
  return line ? shorten(line) : NOTE_DRAFT_FALLBACK_TITLE;
}

/**
 * Asks the model to turn ラピ's reply into a note draft.
 *
 * @param answer - ラピ's reply, Markdown as-is, non-empty / ラピの回答（Markdown のまま、空でない）
 * @returns title and tidied body / タイトルと整えた本文
 * @throws {NoteDraftUnavailableError} when the model gave no usable body / 本文が得られなかったとき
 * @throws {Error} when the model call itself failed / AI の呼び出し自体が失敗したとき
 */
export async function draftNoteFromReply(answer: string): Promise<NoteDraft> {
  let reply: string;
  try {
    const response = await sendAIMessage({
      provider: 'claude',
      model: DRAFT_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: DRAFT_MAX_TOKENS,
      messages: [{ role: 'user', content: `回答:\n${answer.trim()}` }],
    });
    reply = response.content ?? '';
  } catch (err) {
    // Logged here because the route answers 502 without the cause.
    logger.warn({ err }, 'note draft model call failed');
    throw err;
  }
  const parsed = parseNoteDraftReply(reply);
  if (!parsed.content) {
    logger.info('model answered without a note body');
    throw new NoteDraftUnavailableError('model answered without a note body');
  }
  const title = resolveNoteDraftTitle(parsed.title, parsed.content);
  logger.info(
    { answerLength: answer.length, contentLength: parsed.content.length, titled: !!parsed.title },
    'note drafted from reply',
  );
  return { title, content: `${parsed.content}\n` };
}
