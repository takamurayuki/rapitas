'use client';
/**
 * MobileLinkCard
 *
 * Settings card for using Rapitas from a phone (#1421): turn the LAN link on,
 * show a one-time QR code the phone app scans, and list / remove paired
 * phones. The QR is rendered from the backend's SVG as an <img> data URI so no
 * markup from the response is ever injected into the page.
 */
import { useTranslations } from 'next-intl';
import { Smartphone } from 'lucide-react';
import { useMobileLink } from './use-mobile-link';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MobileLinkCard() {
  const t = useTranslations('settings.mobileLinkCard');
  const link = useMobileLink();
  const s = link.status;

  const state = !s?.enabled
    ? t('stateOff')
    : s.listening
      ? t('stateListening', { port: s.port })
      : t('stateFailed', { error: s.lastError ?? '' });

  return (
    <section className="rounded-xl border border-slate-200 p-5 dark:border-slate-700">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Smartphone className="h-5 w-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t('description')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium" data-testid="mobile-link-state">
          {state}
        </p>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          disabled={link.busy || !s}
          onClick={() => void link.setEnabled(!s?.enabled)}
        >
          {s?.enabled ? t('disable') : t('enable')}
        </button>
      </div>

      {s?.enabled && s.listening && (
        <div className="mt-4">
          {link.qr ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm">{t('qrHelp')}</p>
              {/* NOTE: next/image cannot optimise a short-lived data: URI; a plain img is correct here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qr.svg)}`}
                alt={t('qrAlt')}
                className="h-56 w-56 rounded-lg bg-white p-2"
              />
              <p className="text-xs text-slate-500">
                {t('qrExpires', { time: formatTime(link.qr.expiresAt) })}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={link.busy}
              onClick={() => void link.showQr()}
            >
              {t('showQr')}
            </button>
          )}
          {s.addresses.length > 0 && (
            <p className="mt-2 font-mono text-xs text-slate-500">
              {t('addresses', { addresses: s.addresses.map((a) => `${a}:${s.port}`).join(', ') })}
            </p>
          )}
        </div>
      )}

      {s && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">{t('devicesTitle')}</h3>
          {s.devices.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">{t('noDevices')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
              {s.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{device.name}</p>
                    <p className="text-xs text-slate-500">
                      {t('pairedAt', { time: formatTime(device.createdAt) })}
                      {' · '}
                      {device.lastSeenAt
                        ? t('lastSeen', { time: formatTime(device.lastSeenAt) })
                        : t('neverSeen')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950"
                    disabled={link.busy}
                    onClick={() => {
                      if (window.confirm(t('revokeConfirm', { name: device.name }))) {
                        void link.revoke(device.id);
                      }
                    }}
                  >
                    {t('revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {link.error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {t('errorPrefix', { error: link.error })}
        </p>
      )}
    </section>
  );
}
