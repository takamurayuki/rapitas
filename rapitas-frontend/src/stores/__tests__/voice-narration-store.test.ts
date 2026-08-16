/**
 * voice-narration-store テスト
 *
 * 既定値（enabled/rate/verbosity）・更新・rateクランプ・persistキー名を検証。
 */
import {
  useVoiceNarrationStore,
  clampVoiceRate,
  VOICE_RATE_MIN,
  VOICE_RATE_MAX,
} from '../voice-narration-store';

describe('voiceNarrationStore', () => {
  beforeEach(() => {
    useVoiceNarrationStore.setState({ enabled: true, rate: 1.0, verbosity: 'standard' });
  });

  it('既定値は enabled=true / rate=1.0 / verbosity=standard であること', () => {
    const state = useVoiceNarrationStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.rate).toBe(1.0);
    expect(state.verbosity).toBe('standard');
  });

  it('setEnabled / setVerbosity で値が更新されること', () => {
    useVoiceNarrationStore.getState().setEnabled(false);
    useVoiceNarrationStore.getState().setVerbosity('detailed');
    const state = useVoiceNarrationStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.verbosity).toBe('detailed');
  });

  it('setRate は 0.5〜2.0 にクランプすること', () => {
    useVoiceNarrationStore.getState().setRate(5);
    expect(useVoiceNarrationStore.getState().rate).toBe(VOICE_RATE_MAX);
    useVoiceNarrationStore.getState().setRate(0);
    expect(useVoiceNarrationStore.getState().rate).toBe(VOICE_RATE_MIN);
    useVoiceNarrationStore.getState().setRate(1.5);
    expect(useVoiceNarrationStore.getState().rate).toBe(1.5);
  });

  it('clampVoiceRate は NaN を 1.0 に戻すこと', () => {
    expect(clampVoiceRate(Number.NaN)).toBe(1.0);
  });

  it('persist キー名が voice-narration-storage であること', () => {
    useVoiceNarrationStore.getState().setRate(1.2);
    const raw = localStorage.getItem('voice-narration-storage');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state.rate).toBe(1.2);
  });
});
