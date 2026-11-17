/**
 * read-stamp
 *
 * The rule behind the "she has read it" stamp: which glyph a turn's intent
 * gets, and which intent an old routing note names. Shared by ラピ's thread
 * and the task consult chat. Not responsible for drawing (`ReceivedStamp`)
 * or for deciding when a line was read (the callers do).
 *
 * NOTE: the same rule lives in rapitas-mobile
 * `lib/models/rapi_chat/rapi_read_mark.dart`. Change both together:
 *   take it on and do it (create, roadmap, change, tidy, companion) -> 🫡
 *   keep an eye on things (watch) -> 👀
 *   answer or talk (ask, consult, chat, anything unknown) -> 👌
 */

/** Glyph for a turn she takes on and carries out. */
export const STAMP_ON_IT = '🫡';
/** Glyph for a watch turn. */
export const STAMP_WATCHING = '👀';
/** Glyph for an answer or a talk, and the fallback. */
export const STAMP_OK = '👌';

/** The intent of a sentence that was not routed anywhere: she talks. */
export const READ_AS_CHAT = 'chat';

const ON_IT = new Set(['create', 'roadmap', 'change', 'tidy', 'companion']);

/**
 * The glyph for a turn's intent.
 *
 * @param intent - Where the sentence was routed; unknown or missing reads as a talk / 発言の意図
 * @returns The glyph / スタンプの字
 */
export function stampGlyphFor(intent: string | undefined | null): string {
  if (intent && ON_IT.has(intent)) return STAMP_ON_IT;
  if (intent === 'watch') return STAMP_WATCHING;
  return STAMP_OK;
}

/**
 * Note labels, both clients, both eras: the mobile app's
 * 「タスク作成として受け取りました」 (still saved), the web's pre-#1543
 * 「「タスクを作る」として受け取りました」 and its English form.
 */
const INTENT_BY_LABEL: Record<string, string> = {
  タスク作成: 'create',
  タスクへの問い合わせ: 'ask',
  見守り: 'watch',
  タスクの変更: 'change',
  計画づくり: 'roadmap',
  タスクについての相談: 'consult',
  タスクの片付け: 'tidy',
  伴走の開始: 'companion',
  伴走の終了: 'companion',
  対話: READ_AS_CHAT,
  要対応: 'watch',
  タスクを作る: 'create',
  タスクを探す: 'ask',
  このタスク: 'consult',
  片付ける: 'tidy',
  計画を立てる: 'roadmap',
  変更する: 'change',
  Talk: READ_AS_CHAT,
  'Needs you': 'watch',
  'Add a task': 'create',
  'Find tasks': 'ask',
  'This task': 'consult',
  'Tidy up': 'tidy',
  'Plan it out': 'roadmap',
  Change: 'change',
};

const ROUTING_NOTE = /^(?:「([^」]+)」|([^「」—]+?))として受け取りました|^Took that as “([^”]+)”/;

/**
 * The intent a routing note ("〇〇として受け取りました") names.
 *
 * @param text - A system line's text / system 行の本文
 * @returns The intent, or null when the line is not a routing note / 意図
 */
export function intentOfRoutingNote(text: string): string | null {
  const m = ROUTING_NOTE.exec(text);
  if (!m) return null;
  const label = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  return INTENT_BY_LABEL[label] ?? null;
}

/**
 * Failure notes the mobile app saves after a send that did not get through
 * (`rapiSendFailedText`, `rapiTimeoutMessage`). A turn holding one is not read.
 */
export const SEND_FAILED_NOTES: readonly string[] = [
  '送信に失敗しました',
  '応答に時間がかかり、タイムアウトしました。デスクトップ側の処理が混んでいるかもしれません。もう一度送ってみてください。',
];
