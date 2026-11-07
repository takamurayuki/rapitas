/**
 * MobileLinkCard.test (#1421)
 *
 * The card shows the link state, only offers a QR code while the gateway is
 * actually listening, renders the QR as an image (never injected markup), and
 * asks before removing a phone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ja from '../../../../../../messages/ja.json';
import { MobileLinkCard } from '../MobileLinkCard';
import type { MobileLinkStatus, PairingQr } from '../use-mobile-link';

const hook = {
  status: null as MobileLinkStatus | null,
  qr: null as PairingQr | null,
  busy: false,
  error: null as string | null,
  setEnabled: vi.fn(async () => {}),
  showQr: vi.fn(async () => {}),
  revoke: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
};
vi.mock('../use-mobile-link', () => ({ useMobileLink: () => hook }));

const base: MobileLinkStatus = {
  enabled: false,
  listening: false,
  lastError: null,
  desktopId: 'desk',
  desktopName: 'pc',
  port: 3002,
  addresses: ['192.168.1.5'],
  devices: [],
};

const renderCard = () =>
  render(
    <NextIntlClientProvider locale="ja" messages={ja}>
      <MobileLinkCard />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  hook.status = { ...base };
  hook.qr = null;
  hook.error = null;
  hook.setEnabled.mockClear();
  hook.showQr.mockClear();
  hook.revoke.mockClear();
});

describe('MobileLinkCard', () => {
  it('is off by default and offers no QR code', () => {
    renderCard();
    expect(screen.getByTestId('mobile-link-state').textContent).toBe('オフ');
    expect(screen.queryByText('スマホを追加する（QRコードを表示）')).toBeNull();
    fireEvent.click(screen.getByText('オンにする'));
    expect(hook.setEnabled).toHaveBeenCalledWith(true);
  });

  it('offers the QR code only while the gateway is listening', () => {
    hook.status = { ...base, enabled: true, listening: false, lastError: 'EADDRINUSE' };
    const { unmount } = renderCard();
    expect(screen.getByTestId('mobile-link-state').textContent).toContain('EADDRINUSE');
    expect(screen.queryByText('スマホを追加する（QRコードを表示）')).toBeNull();
    unmount();

    hook.status = { ...base, enabled: true, listening: true };
    renderCard();
    fireEvent.click(screen.getByText('スマホを追加する（QRコードを表示）'));
    expect(hook.showQr).toHaveBeenCalled();
    expect(screen.getByText(/192\.168\.1\.5:3002/)).toBeTruthy();
  });

  it('renders the QR as an image, not as injected markup', () => {
    hook.status = { ...base, enabled: true, listening: true };
    hook.qr = {
      uri: 'rapitas://pair?d=x',
      svg: '<svg><script>alert(1)</script></svg>',
      expiresAt: new Date().toISOString(),
    };
    const { container } = renderCard();
    const img = screen.getByAltText('ペアリング用のQRコード') as HTMLImageElement;
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(container.querySelector('script')).toBeNull();
  });

  it('asks before removing a phone', () => {
    hook.status = {
      ...base,
      devices: [
        {
          id: 'd1',
          name: 'iPhone',
          workspaceId: null,
          createdAt: new Date().toISOString(),
          lastSeenAt: null,
        },
      ],
    };
    const confirm = vi.spyOn(window, 'confirm');
    renderCard();

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText('解除'));
    expect(hook.revoke).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByText('解除'));
    expect(hook.revoke).toHaveBeenCalledWith('d1');
    expect(screen.getByText(/まだ接続していません/)).toBeTruthy();
  });
});
