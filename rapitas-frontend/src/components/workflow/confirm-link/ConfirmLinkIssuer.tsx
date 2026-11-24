'use client';

/**
 * ConfirmLinkIssuer
 *
 * Button and panel that issue an external confirm link for the task's
 * pending A/B question (task 1430): request text, per-resource 「外部公開可」
 * toggles, and the issued URL with its expiry and a copy button. Loads
 * nothing until opened. Not responsible for the public answer page, which
 * the backend renders.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, MessageSquareShare, X } from 'lucide-react';
import { useConfirmLinkIssuer } from './useConfirmLinkIssuer';

/** Props for {@link ConfirmLinkIssuer}. */
export interface ConfirmLinkIssuerProps {
  taskId: number;
}

/**
 * @param props - The task to issue a link for / 対象タスク
 * @returns The issuer button and panel / 発行ボタンとパネル
 */
export function ConfirmLinkIssuer({ taskId }: ConfirmLinkIssuerProps) {
  const t = useTranslations('workflow.confirmLink');
  const state = useConfirmLinkIssuer(taskId);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const openPanel = () => {
    setOpen(true);
    void state.load();
  };

  // NOTE: Only a resolved writeText counts as copied — a denied or missing
  // clipboard used to show 「コピーしました」 for a URL that was never copied.
  const copy = async () => {
    if (!state.issued) return;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(state.issued.url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <MessageSquareShare className="h-4 w-4" aria-hidden />
        {t('openButton')}
      </button>
    );
  }

  const inputId = `confirm-link-message-${taskId}`;
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('description')}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('close')}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {!state.enabled && <p className="text-amber-700 dark:text-amber-400">{t('disabled')}</p>}
      {state.error && (
        <p className="text-red-600 dark:text-red-400">{t('error', { message: state.error })}</p>
      )}

      <div>
        <label
          htmlFor={inputId}
          className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
        >
          {t('messageLabel')}
        </label>
        <textarea
          id={inputId}
          aria-label={t('messageLabel')}
          value={message}
          maxLength={2000}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('messagePlaceholder')}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('resourcesLabel')}
        </legend>
        {state.resources.length === 0 && !state.loading ? (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('resourcesEmpty')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {state.resources.map((r) => (
              <li key={r.id}>
                <label className="inline-flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    aria-label={`${r.title} (${t('externalPublic')})`}
                    checked={r.externalPublic}
                    onChange={(e) => void state.setPublic(r.id, e.target.checked)}
                  />
                  <span>{r.title}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    ({t('externalPublic')})
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <button
        type="button"
        disabled={state.busy || !state.enabled}
        onClick={() => void state.issue(message)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {state.busy ? t('issuing') : t('issueButton')}
      </button>

      {state.issued && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('issuedUrl')}</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={state.issued.url}
              aria-label={t('issuedUrl')}
              className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('expiresAt', { time: new Date(state.issued.expiresAt).toLocaleString() })}
          </p>
          {copyFailed && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('copyFailed')}</p>
          )}
          {state.issued.relative && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('relativeWarning')}</p>
          )}
        </div>
      )}
    </div>
  );
}
