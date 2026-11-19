'use client';

/**
 * CopyReplyButton
 *
 * The small copy icon at the top right of one of ラピ's text replies in the
 * copilot panel. Copies the reply's Markdown source, not the rendered text,
 * so pasting it into a note keeps the formatting. Not responsible for where
 * it sits in the bubble — see `MessageBubble`.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';

/** How long the check stays after a copy, in ms. */
const COPIED_MS = 2000;

/**
 * Copies ラピ's reply to the clipboard. Shows a check for a moment on
 * success; on failure stays a copy icon. The icon change is the only
 * feedback: no toast either way, to match the mobile app (nav74 fix 4).
 *
 * @param text - the reply's Markdown source / 返答の Markdown 原文
 * @param className - positioning from the caller / 呼び出し側の配置クラス
 */
export function CopyReplyButton({ text, className = '' }: { text: string; className?: string }) {
  const t = useTranslations('copilot.copyReply');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // NOTE: The clipboard write can settle after unmount; without this the
  // success path would start a fresh 2s timer the cleanup can no longer stop.
  const mounted = useRef(false);

  // NOTE: A layout effect, not useEffect: its cleanup runs in the unmount
  // commit itself. A passive cleanup runs later, and a write settling in
  // between would still see mounted === true (nav74 re-review 5).
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const copy = async () => {
    try {
      // NOTE: navigator.clipboard is missing outside a secure context; that
      // throws here and is reported as a failure, never as success.
      await navigator.clipboard.writeText(text);
    } catch {
      if (!mounted.current) return;
      // NOTE: A failure inside the 2s check window of an earlier success must
      // not leave the check and "copied" label up. Removed the error toast —
      // feedback is the icon change only, so a failure just stays a copy icon.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setCopied(false);
      return;
    }
    if (!mounted.current) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t('copied') : t('copy')}
      title={copied ? t('copied') : t('copy')}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-md transition-colors ${copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'} ${className}`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
