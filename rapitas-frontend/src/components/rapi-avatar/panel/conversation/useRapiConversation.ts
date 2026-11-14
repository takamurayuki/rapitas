/**
 * useRapiConversation
 *
 * What happens when you write to ラピ: the sentence joins the thread at
 * once, she works out where it goes, and the answer follows it — a routing
 * note and that mode's card, or, when it is not a request for any of her
 * modes, a reply in words from `/copilot/chat`.
 *
 * Mirrors the mobile app's send flow (rapitas-mobile/lib/providers/
 * rapi_chat/rapi_chat_send.part.dart), so the two clients answer the same
 * sentence the same way. Not responsible for drawing — see `RapiThread`.
 */
import { useCallback, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { PromptDestination } from '../RapiPrompt';
import type { RapiMessage } from './conversation-types';

const logger = createLogger('rapi-conversation');

/**
 * How many lines the thread keeps.
 *
 * A conversation in a panel, not an archive: past this the oldest go, which
 * also bounds how many cards stay mounted.
 */
export const MAX_MESSAGES = 100;

interface Options {
  /** True when `consult` is a destination that exists right now. */
  hasOpenTask: boolean;
  /** Her opening line, the first message in the thread. / 最初の挨拶 */
  greeting: string;
  /** Said when a sentence could not be sent. / 送信失敗の案内 */
  failedText: string;
}

export interface RapiConversation {
  messages: RapiMessage[];
  /** What is in the box. / 入力欄の文 */
  text: string;
  setText: (text: string) => void;
  sending: boolean;
  send: () => Promise<void>;
  cancel: () => void;
  /** Send a sentence to the roadmap instead of where it went. / 計画として考え直す */
  rethinkAsPlan: (sentence: string) => void;
}

type RouteAnswer = { routed?: boolean; intent?: PromptDestination; reason?: string };
type ChatAnswer = { success?: boolean; content?: string; error?: string };

/**
 * @param options - Whether a task is open, and the two lines she says herself
 * @returns The thread, the box and the actions / 会話・入力欄・操作
 */
export function useRapiConversation({
  hasOpenTask,
  greeting,
  failedText,
}: Options): RapiConversation {
  const nextId = useRef(1);
  const [messages, setMessages] = useState<RapiMessage[]>(() => [
    // The greeting is a line she says, not a caption above the thread
    // (asked 2026-11-14). Not history: the model did not say it.
    { id: 0, role: 'assistant', text: greeting, inHistory: false },
  ]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  /** The sentence on its way, so a cancel can hand it back by itself. */
  const pending = useRef<{ userId: number; said: string } | null>(null);
  const latest = useRef(messages);
  latest.current = messages;

  const add = useCallback((line: Omit<RapiMessage, 'id'>): number => {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...line, id }].slice(-MAX_MESSAGES));
    return id;
  }, []);

  /** Take a sent sentence back out of the history and give it back to the box. */
  const unsend = useCallback((userId: number, said: string) => {
    setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, inHistory: false } : m)));
    // Only if nothing new was started meanwhile.
    setText((current) => (current.trim() ? current : said));
  }, []);

  const send = useCallback(async () => {
    const said = text.trim();
    if (!said || sending) return;
    // The history is what was said before this sentence, in order.
    const history = latest.current
      .filter((m) => m.inHistory && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.text }));
    const userId = add({ role: 'user', text: said, inHistory: true });
    // It is in the thread now, so the box empties at once, as in a chat.
    setText('');
    const controller = new AbortController();
    inFlight.current = controller;
    pending.current = { userId, said };
    setSending(true);
    try {
      const routeRes = await fetch(`${API_BASE_URL}/assistant/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: said, hasOpenTask }),
        signal: controller.signal,
      });
      if (!routeRes.ok) throw new Error(`HTTP ${routeRes.status}`);
      const routed = (await routeRes.json()) as RouteAnswer;
      if (routed.routed && routed.intent) {
        add({
          role: 'system',
          text: '',
          intent: routed.intent,
          reason: routed.reason ?? '',
          handedOver: said,
          inHistory: false,
        });
        return;
      }
      // Not a request for any of her modes: talk. This is what the mobile app
      // does with an unrouted sentence, and it replaces "I could not tell".
      const chatRes = await fetch(`${API_BASE_URL}/copilot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: said, taskId: null, conversationHistory: history }),
        signal: controller.signal,
      });
      const reply = (await chatRes.json()) as ChatAnswer;
      if (!chatRes.ok || reply.success !== true || !reply.content) {
        throw new Error(reply.error ?? `HTTP ${chatRes.status}`);
      }
      add({ role: 'assistant', text: reply.content, inHistory: true });
    } catch (err) {
      // Called off by the user: `cancel` has already given the sentence
      // back, and nothing is said about failing.
      if (controller.signal.aborted) return;
      logger.warn({ err }, 'could not answer');
      unsend(userId, said);
      add({ role: 'system', text: failedText, failed: true, inHistory: false });
    } finally {
      // A cancelled request has already unlocked the box; a late `finally`
      // must not stamp on a newer send.
      if (inFlight.current === controller) {
        inFlight.current = null;
        pending.current = null;
        setSending(false);
      }
    }
  }, [add, failedText, hasOpenTask, sending, text, unsend]);

  // Hands the sentence back here rather than in the request's `catch`: a
  // request that ignores the abort would otherwise keep the box locked and
  // the sentence away until it finally answered.
  const cancel = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    if (pending.current) unsend(pending.current.userId, pending.current.said);
    pending.current = null;
    setSending(false);
  }, [unsend]);

  const rethinkAsPlan = useCallback(
    (sentence: string) => {
      add({
        role: 'system',
        text: '',
        intent: 'roadmap',
        reason: '',
        handedOver: sentence,
        inHistory: false,
      });
    },
    [add],
  );

  return { messages, text, setText, sending, send, cancel, rethinkAsPlan };
}
