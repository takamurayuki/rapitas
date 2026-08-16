/**
 * speech-narrator テスト
 *
 * getVoices が空の環境（WebView2等）で isAvailable()===false となり、
 * speak が発話せず false を返す（テキスト経路へのフォールバック前提）ことを検証。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAvailable, speak, stop } from '../speech-narrator';

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  constructor(text: string) {
    this.text = text;
  }
}

function installSpeechSynthesis(voices: unknown[]) {
  const synth = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

describe('speech-narrator', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speechSynthesis 自体が無い環境では isAvailable が false であること', () => {
    // jsdom には speechSynthesis が無い
    expect(isAvailable()).toBe(false);
  });

  it('getVoices が空配列なら isAvailable が false、speak も false を返すこと', () => {
    const synth = installSpeechSynthesis([]);
    expect(isAvailable()).toBe(false);
    expect(speak('テスト')).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('音声がある場合 speak は前の発話を cancel してから発話し true を返すこと', () => {
    const synth = installSpeechSynthesis([{ name: 'voice1' }]);
    expect(isAvailable()).toBe(true);
    expect(speak('こんにちは', { rate: 1.5 })).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe('こんにちは');
    expect(utterance.rate).toBe(1.5);
  });

  it('rate は 0.5〜2.0 にクランプされること', () => {
    const synth = installSpeechSynthesis([{ name: 'voice1' }]);
    speak('a', { rate: 10 });
    speak('b', { rate: 0.1 });
    const first = synth.speak.mock.calls[0][0] as FakeUtterance;
    const second = synth.speak.mock.calls[1][0] as FakeUtterance;
    expect(first.rate).toBe(2.0);
    expect(second.rate).toBe(0.5);
  });

  it('空文字は発話しないこと', () => {
    const synth = installSpeechSynthesis([{ name: 'voice1' }]);
    expect(speak('')).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('stop は speechSynthesis 不在でも例外を投げないこと', () => {
    expect(() => stop()).not.toThrow();
    const synth = installSpeechSynthesis([{ name: 'voice1' }]);
    stop();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });
});
