/**
 * chunk-reload.wiring.test
 *
 * Pins that each error path hands its error to reloadOnceForChunkError, so a
 * missing chunk after a deploy reloads the page instead of leaving
 * 「エラーが発生しました」 on screen (2026-11-21).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

const reloadOnce = vi.fn(() => true);
vi.mock('@/lib/chunk-reload', () => ({ reloadOnceForChunkError: reloadOnce }));

const { ErrorBoundary } = await import('@/components/common/ErrorBoundary');
const { default: RootError } = await import('@/app/error');
const { default: GlobalErrorReporter } = await import('@/components/common/GlobalErrorReporter');

const chunkError = () => {
  const e = new Error('Failed to load chunk /_next/static/chunks/a.js');
  e.name = 'ChunkLoadError';
  return e;
};

function Throws(): never {
  throw chunkError();
}

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ja" messages={{}} onError={() => {}}>
    {ui}
  </NextIntlClientProvider>
);

beforeEach(() => reloadOnce.mockClear());

describe('chunk-load errors reach the reload', () => {
  it('ErrorBoundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(withIntl(<ErrorBoundary>{<Throws />}</ErrorBoundary>));
    expect(reloadOnce).toHaveBeenCalledWith(expect.objectContaining({ name: 'ChunkLoadError' }));
  });

  it('app/error.tsx', () => {
    render(withIntl(<RootError error={chunkError()} reset={() => {}} />));
    expect(reloadOnce).toHaveBeenCalledTimes(1);
  });

  it('unhandled rejections seen by GlobalErrorReporter', () => {
    render(<GlobalErrorReporter />);
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: chunkError() });
    window.dispatchEvent(event);
    expect(reloadOnce).toHaveBeenCalledWith(expect.objectContaining({ name: 'ChunkLoadError' }));
  });
});
