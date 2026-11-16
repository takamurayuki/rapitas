/**
 * rapi-chat-types
 *
 * Shapes and limits of ラピ's chat conversation spaces (nav39 design §3–§4, §9).
 * A space is a display record of what was said; it is never read by the
 * assistant pipeline. Not responsible for any database access.
 */

/** Spaces per workspace (design §9, Q6). */
export const MAX_SPACES = 100;
/** Messages per space, judged on the count after a PUT is applied (design §4.2). */
export const MAX_MESSAGES_PER_SPACE = 2000;
/** One payload, measured in UTF-8 bytes — never characters (design §3.4). */
export const MAX_PAYLOAD_BYTES = 262_144;
/** One message text, in characters (design §4.2). */
export const MAX_TEXT_LENGTH = 32_000;
/** Items in one PUT (design §4.2). */
export const MAX_PUT_ITEMS = 50;
/** Title length accepted from a client, in characters (design §4.2). */
export const MAX_TITLE_LENGTH = 60;
/** clientKey length (design §4.2). */
export const MAX_CLIENT_KEY_LENGTH = 64;
/** Default / maximum page size of GET messages (design §6.3). */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export const MESSAGE_KINDS = ['text', 'answer', 'change', 'roadmap', 'tidy', 'companion'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Why one PUT item was refused (design §4.2). */
export type RejectCode =
  | 'invalid_role'
  | 'invalid_kind'
  | 'text_too_long'
  | 'payload_too_large'
  | 'invalid_payload'
  | 'message_limit';

/** One stored space row. */
export interface SpaceRow {
  id: number;
  workspaceId: number | null;
  title: string | null;
  titleSource: string;
  clientKey: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One stored message row. */
export interface MessageRow {
  id: number;
  workspaceId: number | null;
  spaceId: number;
  clientId: string;
  role: string;
  kind: string;
  text: string;
  taskId: number | null;
  inHistory: boolean;
  payload: string | null;
  clientCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One item of a PUT after the body-shape check (clientId is known to be valid). */
export interface PutItem {
  clientId: string;
  role: unknown;
  kind: unknown;
  text: unknown;
  taskId?: unknown;
  inHistory?: unknown;
  payload?: unknown;
  clientCreatedAt?: unknown;
  deleted?: unknown;
}

/** A PUT item that passed validation and is ready to write. */
export interface ValidItem {
  clientId: string;
  deleted: boolean;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  taskId: number | null;
  inHistory: boolean;
  payload: string | null;
  clientCreatedAt: Date | null;
}

type Where = Record<string, unknown>;

/**
 * The delegate methods the rapi-chat services use, from a client or a tx.
 *
 * NOTE: Deliberately narrow and structural. The services avoid `upsert` and
 * the unique-keyed operations because the workspace extension emulates them on
 * the BASE client, outside the caller's interactive transaction.
 */
export interface RapiChatTx {
  rapiChatSpace: {
    findFirst(args: { where: Where }): Promise<SpaceRow | null>;
    findMany(args: { where?: Where }): Promise<SpaceRow[]>;
    count(args: { where: Where }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<SpaceRow>;
    updateMany(args: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
  rapiChatMessage: {
    findFirst(args: {
      where: Where;
      orderBy?: Record<string, 'asc' | 'desc'>;
    }): Promise<MessageRow | null>;
    findMany(args: {
      where: Where;
      orderBy?: Record<string, 'asc' | 'desc'>;
      take?: number;
      select?: Record<string, true>;
    }): Promise<MessageRow[]>;
    count(args: { where: Where }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<MessageRow>;
    updateMany(args: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
}

/** A client that can also open an interactive transaction. */
export interface RapiChatDb extends RapiChatTx {
  $transaction<T>(fn: (tx: RapiChatTx) => Promise<T>): Promise<T>;
}
