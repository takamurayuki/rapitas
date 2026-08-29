/**
 * shortcut-recorder-section.i18n.test
 *
 * Renders with the real ja catalog (no next-intl mock) so an i18n key that
 * was only added to one locale, or never wired up in page.tsx, fails here
 * instead of surfacing as a raw message key in production (see premortem
 * item 3 in plan.md).
 */
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ShortcutRecorderSection } from '../shortcut-recorder-section';
import { useTranslations } from 'next-intl';
import ja from '../../../../../../messages/ja.json';

const BASE_PROPS = {
  currentShortcut: 'Ctrl+Alt+I',
  modifiers: ['Ctrl', 'Alt'] as const,
  activeKey: 'I',
  isRecording: false,
  isSaving: false,
  message: null,
  newShortcut: 'Ctrl+Alt+I',
  hasChanges: false,
  onToggleRecording: vi.fn(),
  onToggleModifier: vi.fn(),
  onKeyChange: vi.fn(),
  onSave: vi.fn(),
  onReset: vi.fn(),
};

/** Wires title/description from the real `shortcuts.captureShortcuts` keys, like page.tsx does. */
function CaptureSection() {
  const t = useTranslations('shortcuts');
  return (
    <ShortcutRecorderSection
      {...BASE_PROPS}
      modifiers={[...BASE_PROPS.modifiers]}
      title={t('captureShortcuts')}
      description={t('captureDescription')}
    />
  );
}

describe('ShortcutRecorderSection i18n (real ja catalog)', () => {
  it('displays the translated capture-shortcut title and description, not the raw key', () => {
    render(
      <NextIntlClientProvider locale="ja" messages={ja} timeZone="Asia/Tokyo">
        <CaptureSection />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('クイックキャプチャショートカット')).toBeTruthy();
    expect(
      screen.getByText('デスクトップのどこからでもアイデアを素早く入力するポップアップを開きます'),
    ).toBeTruthy();
    expect(screen.queryByText('captureShortcuts')).toBeNull();
    expect(screen.queryByText('captureDescription')).toBeNull();
  });
});
