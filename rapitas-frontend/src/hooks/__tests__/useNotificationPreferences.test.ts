import { renderHook, act } from '@testing-library/react';
import { useNotificationPreferences } from '../feature/useNotificationPreferences';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const STORAGE_KEY = 'rapitas:notification-preferences';

describe('useNotificationPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return default preferences when no stored value', () => {
    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual({
      enabled: true,
      sound: true,
      desktop: false,
    });
  });

  it('should load preferences from localStorage', () => {
    const stored = { enabled: false, sound: false, desktop: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual(stored);
  });

  it('should merge partial stored preferences with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound: false }));

    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual({
      enabled: true,
      sound: false,
      desktop: false,
    });
  });

  it('should handle corrupted localStorage data', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-json');

    const { result } = renderHook(() => useNotificationPreferences());
    expect(result.current.preferences).toEqual({
      enabled: true,
      sound: true,
      desktop: false,
    });
  });

  it('should update a single preference and persist', () => {
    const { result } = renderHook(() => useNotificationPreferences());

    act(() => {
      result.current.updatePreference('sound', false);
    });

    expect(result.current.preferences.sound).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sound).toBe(false);
  });

  it('should update enabled preference', () => {
    const { result } = renderHook(() => useNotificationPreferences());

    act(() => {
      result.current.updatePreference('enabled', false);
    });

    expect(result.current.preferences.enabled).toBe(false);
  });

  it('should reset preferences to defaults', () => {
    const { result } = renderHook(() => useNotificationPreferences());

    act(() => {
      result.current.updatePreference('sound', false);
      result.current.updatePreference('desktop', true);
    });

    act(() => {
      result.current.resetPreferences();
    });

    expect(result.current.preferences).toEqual({
      enabled: true,
      sound: true,
      desktop: false,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      enabled: true,
      sound: true,
      desktop: false,
    });
  });
});
