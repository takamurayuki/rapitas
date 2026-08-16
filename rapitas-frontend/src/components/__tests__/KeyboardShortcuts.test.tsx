/**
 * KeyboardShortcuts テスト
 *
 * Alt修飾子の厳密マッチ（Ctrl+Alt+S で stallRecovery イベント発火 / Alt無しでは
 * 非発火）と、既存の alt:false ショートカットの回帰（Alt押下時は非発火）を検証。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import KeyboardShortcuts from '../common/KeyboardShortcuts';
import { useShortcutStore, DEFAULT_SHORTCUTS } from '@/stores/shortcut-store';
import { OPEN_STALL_RECOVERY_EVENT } from '@/components/accessibility/stall-recovery-panel/stall-recovery.types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockOpenModal = vi.fn();
vi.mock('@/stores/note-store', () => ({
  useNoteStore: {
    getState: () => ({
      modalState: { isOpen: false, activeTab: 'note' },
      openModal: mockOpenModal,
      setModalTab: vi.fn(),
    }),
  },
}));

// パネル本体は独立してテストするため、ここでは描画を無効化する
vi.mock('@/components/accessibility/stall-recovery-panel/StallRecoveryPanel', () => ({
  default: () => null,
}));

describe('KeyboardShortcuts (alt matcher)', () => {
  let openStallRecoveryFired: number;
  const countListener = () => {
    openStallRecoveryFired++;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    openStallRecoveryFired = 0;
    useShortcutStore.setState({ shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })) });
    window.addEventListener(OPEN_STALL_RECOVERY_EVENT, countListener);
  });

  afterEach(() => {
    window.removeEventListener(OPEN_STALL_RECOVERY_EVENT, countListener);
  });

  it('Ctrl+Alt+S で openStallRecovery イベントが発火すること', () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true, altKey: true });
    expect(openStallRecoveryFired).toBe(1);
  });

  it('Alt 無しの Ctrl+S では発火しないこと', () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true, altKey: false });
    expect(openStallRecoveryFired).toBe(0);
  });

  it('既存ショートカット（Ctrl+E, alt:false）は従来どおり発火すること', () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    expect(mockOpenModal).toHaveBeenCalledWith('ai');
  });

  it('既存ショートカットは Alt 押下時には発火しなくなること（厳密マッチ）', () => {
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, altKey: true });
    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it('入力欄フォーカス中は発火しないこと', () => {
    render(
      <>
        <input data-testid="text-input" />
        <KeyboardShortcuts />
      </>,
    );
    const input = document.querySelector('input') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 's', ctrlKey: true, altKey: true });
    expect(openStallRecoveryFired).toBe(0);
  });
});
