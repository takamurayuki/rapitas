'use client';

/**
 * CopyReplyButton
 *
 * The small copy icon at the top right of one of ラピ's text replies in the
 * copilot panel. Copies the reply's Markdown source, not the rendered text,
 * so pasting it into a note keeps the formatting. Not responsible for where
 * it sits in the bubble — see `MessageBubble`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';

/** How long the check stays after a copy, in ms. */
const COPIED_MS = 2000;

/**
 * Copies ラピ's reply to the clipboard. Shows a check for a moment on
 * success; on failure shows an error toast and stays a copy icon.
 *
 * @param text - the reply's Markdown source / 返答の Markdown 原文
 * @param className - positioning from the caller / 呼び出し側の配置クラス
 */
export function CopyReplyButton({ text, className = '' }: { text: string; className?: string }) {
  const t = useTranslations('copilot.copyReply');
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      // NOTE: navigator.clipboard is missing outside a secure context; that
      // throws here and is reported as a failure, never as success.
      await navigator.clipboard.writeText(text);
    } catch {
      showToast(t('failed'), 'error');
      return;
    }
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
