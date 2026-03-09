vi.mock('@/i18n/config', () => ({
  locales: ['ja', 'en'],
  defaultLocale: 'ja',
}));

import { useLocaleStore } from '../localeStore';

describe('localeStore', () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: 'ja' });
  });

  it('should have default locale as "ja"', () => {
    expect(useLocaleStore.getState().locale).toBe('ja');
  });

  it('should set locale to "en"', () => {
    useLocaleStore.getState().setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
  });

  it('should set locale back to "ja"', () => {
    useLocaleStore.getState().setLocale('en');
    useLocaleStore.getState().setLocale('ja');
    expect(useLocaleStore.getState().locale).toBe('ja');
  });
});
