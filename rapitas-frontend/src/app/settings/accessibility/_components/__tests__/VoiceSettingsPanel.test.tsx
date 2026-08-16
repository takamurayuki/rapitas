/**
 * VoiceSettingsPanel テスト
 *
 * 音声設定パネルのレンダリングとストア更新（ON/OFF・速度・詳細度）を検証。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceSettingsPanel } from '../VoiceSettingsPanel';
import { useVoiceNarrationStore } from '@/stores/voice-narration-store';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockSpeak = vi.fn();
vi.mock('@/lib/accessibility/speech-narrator', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  isAvailable: () => true,
}));

describe('VoiceSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVoiceNarrationStore.setState({ enabled: true, rate: 1.0, verbosity: 'standard' });
  });

  it('スイッチ・速度スライダ・詳細度3択が描画されること', () => {
    render(<VoiceSettingsPanel />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('スイッチで enabled がトグルされること', () => {
    render(<VoiceSettingsPanel />);
    fireEvent.click(screen.getByRole('switch'));
    expect(useVoiceNarrationStore.getState().enabled).toBe(false);
  });

  it('スライダで rate が更新されること', () => {
    render(<VoiceSettingsPanel />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1.8' } });
    expect(useVoiceNarrationStore.getState().rate).toBe(1.8);
  });

  it('詳細度ボタンで verbosity が更新されること', () => {
    render(<VoiceSettingsPanel />);
    fireEvent.click(screen.getByText('verbosity.detailed'));
    expect(useVoiceNarrationStore.getState().verbosity).toBe('detailed');
  });

  it('テスト再生ボタンで speak が現在の速度で呼ばれること', () => {
    useVoiceNarrationStore.setState({ enabled: true, rate: 1.3, verbosity: 'standard' });
    render(<VoiceSettingsPanel />);
    fireEvent.click(screen.getByText('previewButton'));
    expect(mockSpeak).toHaveBeenCalledWith('previewText', { rate: 1.3 });
  });
});
