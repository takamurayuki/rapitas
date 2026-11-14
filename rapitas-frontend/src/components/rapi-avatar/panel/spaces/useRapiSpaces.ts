/**
 * useRapiSpaces
 *
 * Which of ラピ's conversation spaces is open, the list to switch between,
 * and saving each line to the space it was said in.
 *
 * Spaces are the mobile app's (`/rapi-chat/spaces`), so the desktop and the
 * phone read and write the same history (asked 2026-11-14). A new
 * conversation has no space until its first saved line, as on mobile — an
 * opened-and-abandoned panel must not leave an empty 「新しい会話」 behind.
 *
 * Not responsible for the thread itself: `useRapiConversation` holds the
 * lines, and the panel joins the two.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import type { RapiMessage } from '../conversation';
import {
  createSpace,
  fetchMessages,
  fetchSpaces,
  fromSaved,
  putMessages,
  type RapiSpaceSummary,
} from './rapi-spaces-api';

const logger = createLogger('rapi-spaces');

/** Where the open space is remembered, per browser. */
export const OPEN_SPACE_KEY = 'rapitas.rapiAvatar.space';

/**
 * One conversation as the saving sees it.
 *
 * Lines are written to the generation they were said in, not to whichever
 * space is open when the write runs — an answer that arrives after a switch
 * still belongs to the conversation it answered.
 */
interface Generation {
  id: number | null;
}

export interface RapiSpaces {
  spaces: RapiSpaceSummary[];
  /** The open space, or null for a new conversation not yet saved. / 開いている会話 */
  currentId: number | null;
  /** Its title, or null while it has none. / タイトル */
  currentTitle: string | null;
  /** Set when the last save or load failed. / 失敗の種類 */
  problem: 'load' | 'save' | 'limit' | null;
  /** Re-read the list (on opening the switcher). / 一覧の再取得 */
  refresh: () => Promise<void>;
  /** Open a saved space; its lines, or null if it could not be read. / 会話を開く */
  open: (id: number) => Promise<Omit<RapiMessage, 'id'>[] | null>;
  /** Start a new, unsaved conversation. / 新しい会話 */
  startNew: () => void;
  /** Save lines to the conversation they were said in. / 行を保存する */
  save: (lines: RapiMessage[]) => void;
  /** The space remembered from last time, opened on mount. / 前回の会話 */
  restore: () => Promise<Omit<RapiMessage, 'id'>[] | null>;
}

function remember(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(OPEN_SPACE_KEY);
    else window.localStorage.setItem(OPEN_SPACE_KEY, String(id));
  } catch {
    // Storage blocked: the panel opens on a new conversation next time.
  }
}

function remembered(): number | null {
  try {
    const raw = window.localStorage.getItem(OPEN_SPACE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function newKey(): string {
  const c = globalThis.crypto;
  return c && typeof c.randomUUID === 'function'
    ? c.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @returns The spaces, the open one, and how to switch and save / 会話スペースの状態と操作
 */
export function useRapiSpaces(): RapiSpaces {
  const [spaces, setSpaces] = useState<RapiSpaceSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [problem, setProblem] = useState<RapiSpaces['problem']>(null);
  const generation = useRef<Generation>({ id: null });
  /** Saves run one after another, so a space is created once. */
  const queue = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    try {
      setSpaces(await fetchSpaces());
    } catch (err) {
      logger.warn({ err }, 'could not list spaces');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setTitle = useCallback((id: number, title: string | null) => {
    setSpaces((prev) => {
      const now = new Date().toISOString();
      const found = prev.find((s) => s.id === id);
      const updated: RapiSpaceSummary = found
        ? { ...found, title, lastMessageAt: now }
        : { id, title, messageCount: 0, lastMessageAt: now, createdAt: now };
      // Newest activity first, as the server lists them.
      return [updated, ...prev.filter((s) => s.id !== id)];
    });
  }, []);

  const save = useCallback(
    (lines: RapiMessage[]) => {
      const gen = generation.current;
      queue.current = queue.current.then(async () => {
        try {
          if (gen.id === null) {
            const created = await createSpace(newKey());
            if (created === 'limit') {
              setProblem('limit');
              return;
            }
            gen.id = created.id;
            // Only the conversation still open adopts the new space.
            if (generation.current === gen) {
              setCurrentId(created.id);
              remember(created.id);
            }
          }
          const { title } = await putMessages(gen.id, lines);
          setTitle(gen.id, title);
          setProblem(null);
        } catch (err) {
          logger.warn({ err }, 'could not save to the space');
          setProblem('save');
        }
      });
    },
    [setTitle],
  );

  const open = useCallback(async (id: number) => {
    // Lines still to be saved for the conversation being left go to it, not here.
    generation.current = { id };
    setCurrentId(id);
    remember(id);
    try {
      const rows = await fetchMessages(id);
      if (rows === null) {
        // Deleted on the other client: fall back to a new conversation.
        generation.current = { id: null };
        setCurrentId(null);
        remember(null);
        setSpaces((prev) => prev.filter((s) => s.id !== id));
        return [];
      }
      setProblem(null);
      return rows.map(fromSaved);
    } catch (err) {
      logger.warn({ err }, 'could not load the space');
      setProblem('load');
      return null;
    }
  }, []);

  const startNew = useCallback(() => {
    generation.current = { id: null };
    setCurrentId(null);
    setProblem(null);
    remember(null);
  }, []);

  const restore = useCallback(async () => {
    const id = remembered();
    return id === null ? null : open(id);
  }, [open]);

  const currentTitle = spaces.find((s) => s.id === currentId)?.title ?? null;

  return { spaces, currentId, currentTitle, problem, refresh, open, startNew, save, restore };
}
