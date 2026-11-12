/**
 * snapshot-limits
 *
 * Pure validation of conversation-space input: the PUT body's overall shape,
 * each message item, the payload envelope, and the automatic title (design
 * §3.4, §4.2, §7.1). Not responsible for anything that needs the database
 * (the message-count limit is judged inside the PUT transaction).
 */
import {
  MAX_CLIENT_KEY_LENGTH,
  MAX_PAYLOAD_BYTES,
  MAX_PUT_ITEMS,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  MESSAGE_KINDS,
  MESSAGE_ROLES,
  type MessageKind,
  type MessageRole,
  type PutItem,
  type RejectCode,
  type ValidItem,
} from './rapi-chat-types';

/** Characters a title keeps before the ellipsis (design §7.1: 20 → 19 + 「…」). */
const TITLE_GRAPHEMES = 20;

// NOTE: tsconfig's lib predates Intl.Segmenter (ES2022 Intl), but Bun ships it;
// this narrow type is all autoTitle needs.
const GraphemeSegmenter = (
  Intl as unknown as {
    Segmenter: new (
      locale: string,
      opts: { granularity: 'grapheme' },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }
).Segmenter;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check the PUT body as a whole. Only faults that cannot be pinned on one item
 * are reported here — they become a 400 (design §4.2).
 *
 * @param body - Raw request body / 受け取った本文
 * @returns The items, or the reason the body is malformed / 項目一覧か、形の誤り
 */
export function parsePutBody(
  body: unknown,
): { ok: true; items: PutItem[] } | { ok: false; error: string } {
  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { ok: false, error: 'messages_not_array' };
  }
  const raw = body.messages as unknown[];
  if (raw.length > MAX_PUT_ITEMS) return { ok: false, error: 'too_many_items' };
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, error: 'item_not_object' };
    const id = item.clientId;
    // A missing or empty clientId cannot be named in `rejected`, so it fails the whole body.
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'missing_client_id' };
    if (seen.has(id)) return { ok: false, error: 'duplicate_client_id' };
    seen.add(id);
  }
  return { ok: true, items: raw as PutItem[] };
}

/**
 * Validate a payload envelope `{"v":<positive int>,"kind":<kind>,...}`.
 *
 * @param payload - Payload string / スナップショット文字列
 * @param kind - The row's kind column / 行の kind
 * @returns The refusal code, or null when it is acceptable / 断る理由（問題なければ null）
 */
export function checkPayload(payload: string, kind: MessageKind): RejectCode | null {
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) return 'payload_too_large';
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return 'invalid_payload';
  }
  if (!isRecord(parsed)) return 'invalid_payload';
  const v = parsed.v;
  // Number.isInteger(1.0) is true in JS, so the literal text is checked too:
  // the design refuses a fractional spelling such as `1.0` (§3.4).
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return 'invalid_payload';
  // Only the top-level `v` counts: a nested `"v":1` must not vouch for it.
  const raw = topLevelRawValue(payload, 'v');
  if (raw === null || !/^[1-9]\d*$/.test(raw)) return 'invalid_payload';
  if (parsed.kind !== kind) return 'invalid_payload';
  return null;
}

/** Index just past the JSON string literal that opens at `start` (a `"`). */
function skipString(json: string, start: number): number {
  let i = start + 1;
  while (i < json.length) {
    const c = json[i];
    if (c === '\\') i += 2;
    else if (c === '"') return i + 1;
    else i += 1;
  }
  return i;
}

/** Index just past the JSON value that starts at `start` (whitespace already skipped). */
function skipValue(json: string, start: number): number {
  const c = json[start];
  if (c === '"') return skipString(json, start);
  if (c === '{' || c === '[') {
    let depth = 0;
    let i = start;
    while (i < json.length) {
      const ch = json[i];
      if (ch === '"') {
        i = skipString(json, i);
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    return i;
  }
  let i = start;
  while (i < json.length && !/[\s,}\]]/.test(json[i])) i += 1;
  return i;
}

/**
 * The literal spelling of a top-level key's value in a JSON object text, as
 * written (e.g. `1`, `1.0`, `"1"`). When the key repeats, the last one wins,
 * matching JSON.parse. Assumes `json` already parsed as an object.
 *
 * @param json - JSON object text / JSON オブジェクトの文字列
 * @param key - Top-level key / トップレベルのキー
 * @returns The raw value text, or null when the key is absent / 値の表記（無ければ null）
 */
export function topLevelRawValue(json: string, key: string): string | null {
  const ws = /\s/;
  let i = 0;
  const skipWs = () => {
    while (i < json.length && ws.test(json[i])) i += 1;
  };
  skipWs();
  if (json[i] !== '{') return null;
  i += 1;
  let found: string | null = null;
  for (;;) {
    skipWs();
    if (i >= json.length || json[i] === '}') return found;
    if (json[i] !== '"') return found;
    const keyEnd = skipString(json, i);
    const name = JSON.parse(json.slice(i, keyEnd)) as string;
    i = keyEnd;
    skipWs();
    i += 1; // ':'
    skipWs();
    const valueEnd = skipValue(json, i);
    if (name === key) found = json.slice(i, valueEnd);
    i = valueEnd;
    skipWs();
    if (json[i] === ',') i += 1;
  }
}

/**
 * Validate one PUT item.
 *
 * @param item - An item that passed the body-shape check / 形の検査を通った項目
 * @returns The item ready to write, or its refusal code / 書き込める項目か、断る理由
 */
export function validateItem(
  item: PutItem,
): { ok: true; item: ValidItem } | { ok: false; code: RejectCode } {
  const deleted = item.deleted === true;
  if (deleted) {
    return {
      ok: true,
      item: {
        clientId: item.clientId,
        deleted: true,
        role: 'user',
        kind: 'text',
        text: '',
        taskId: null,
        inHistory: false,
        payload: null,
        clientCreatedAt: null,
      },
    };
  }
  if (!MESSAGE_ROLES.includes(item.role as MessageRole)) return { ok: false, code: 'invalid_role' };
  const kind = item.kind === undefined ? 'text' : item.kind;
  if (!MESSAGE_KINDS.includes(kind as MessageKind)) return { ok: false, code: 'invalid_kind' };
  const text = item.text === undefined || item.text === null ? '' : item.text;
  if (typeof text !== 'string') return { ok: false, code: 'invalid_payload' };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, code: 'text_too_long' };

  const payload = item.payload === undefined ? null : item.payload;
  if (kind === 'text') {
    if (payload !== null) return { ok: false, code: 'invalid_payload' };
  } else {
    if (typeof payload !== 'string') return { ok: false, code: 'invalid_payload' };
    const code = checkPayload(payload, kind as MessageKind);
    if (code) return { ok: false, code };
  }

  const taskId =
    typeof item.taskId === 'number' && Number.isInteger(item.taskId) ? item.taskId : null;
  let clientCreatedAt: Date | null = null;
  if (typeof item.clientCreatedAt === 'string') {
    const d = new Date(item.clientCreatedAt);
    clientCreatedAt = Number.isNaN(d.getTime()) ? null : d;
  }
  return {
    ok: true,
    item: {
      clientId: item.clientId,
      deleted: false,
      role: item.role as MessageRole,
      kind: kind as MessageKind,
      text,
      taskId,
      inHistory: item.inHistory === true,
      payload,
      clientCreatedAt,
    },
  };
}

/**
 * The automatic title for a space, from its first user message (design §7.1).
 *
 * @param text - The first user message's text / 最初の user 発言の本文
 * @returns The title, or null when nothing is left after normalising / タイトル（空なら null）
 */
export function autoTitle(text: string): string | null {
  const normalised = text.trim().replace(/\s+/g, ' ');
  if (normalised.length === 0) return null;
  const graphemes = Array.from(
    new GraphemeSegmenter('ja', { granularity: 'grapheme' }).segment(normalised),
    (s) => s.segment,
  );
  if (graphemes.length <= TITLE_GRAPHEMES) return normalised;
  return `${graphemes.slice(0, TITLE_GRAPHEMES - 1).join('')}…`;
}

/**
 * Validate the POST body `{title?, clientKey?}`.
 *
 * @param body - Raw request body / 受け取った本文
 * @returns The fields, or null when the body is malformed / 項目（不正なら null）
 */
export function parseCreateBody(
  body: unknown,
): { title: string | null; clientKey: string | null } | null {
  if (body === undefined || body === null || body === '') return { title: null, clientKey: null };
  if (!isRecord(body)) return null;
  const { title, clientKey } = body;
  if (title !== undefined && title !== null) {
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) return null;
  }
  if (clientKey !== undefined && clientKey !== null) {
    if (
      typeof clientKey !== 'string' ||
      clientKey.length < 1 ||
      clientKey.length > MAX_CLIENT_KEY_LENGTH
    )
      return null;
  }
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return {
    title: trimmed.length > 0 ? trimmed : null,
    clientKey: typeof clientKey === 'string' ? clientKey : null,
  };
}
