vi.mock('@/i18n/config', () => ({
  locales: ['ja', 'en'],
  defaultLocale: 'ja',
}));

import { useLocaleStore } from '../locale-store';

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

  describe('rehydration (onRehydrateStorage / detectLocale)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      localStorage.removeItem('locale-storage');
    });

    it('空のlocaleで復元された場合、navigator.languageから検出したロケールを設定すること', async () => {
      vi.stubGlobal('navigator', { language: 'en-US' });
      localStorage.setItem('locale-storage', JSON.stringify({ state: { locale: '' }, version: 0 }));

      await useLocaleStore.persist.rehydrate();

      expect(useLocaleStore.getState().locale).toBe('en');
    });

    it('navigator.languageがサポート外の場合はdefaultLocaleへフォールバックすること', async () => {
      vi.stubGlobal('navigator', { language: 'fr-FR' });
      localStorage.setItem('locale-storage', JSON.stringify({ state: { locale: '' }, version: 0 }));

      await useLocaleStore.persist.rehydrate();

      expect(useLocaleStore.getState().locale).toBe('ja');
    });

    it('navigatorが存在しない環境ではdefaultLocaleを設定すること', async () => {
      vi.stubGlobal('navigator', undefined);
      localStorage.setItem('locale-storage', JSON.stringify({ state: { locale: '' }, version: 0 }));

      await useLocaleStore.persist.rehydrate();

      expect(useLocaleStore.getState().locale).toBe('ja');
    });

    it('既にlocaleが設定済みの場合はdetectLocaleで上書きしないこと', async () => {
      // navigator.language would map to 'ja' via detectLocale (fallback), but the
      // persisted 'en' must survive rehydration untouched since it's already set.
      vi.stubGlobal('navigator', { language: 'fr-FR' });
      localStorage.setItem(
        'locale-storage',
        JSON.stringify({ state: { locale: 'en' }, version: 0 }),
      );

      await useLocaleStore.persist.rehydrate();

      expect(useLocaleStore.getState().locale).toBe('en');
    });
  });
});
