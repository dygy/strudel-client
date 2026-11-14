/**
 * The settings store and i18next stay in step without a timer (fix for the language race found
 * with spec 027: a 10 ms timer copied a stale cached language into the store mid-run, and every
 * later setKey re-applied it).
 */
import { describe, expect, it, vi } from 'vitest';
import { bindLanguageSync, type LanguageSource, type LanguageStore } from '../i18nSettingsSync';

const SUPPORTED = ['en', 'es', 'ru', 'fr'];

function fakeI18n(lng: string | undefined) {
  const listeners: Record<string, Set<(l: string) => void>> = {
    languageChanged: new Set(),
    languageChanging: new Set(),
  };
  const fire = (e: string, l: string) => listeners[e].forEach((f) => f(l));
  const i18n: LanguageSource & { emit(l: string): void; finish(l: string): void; request(l: string): void } = {
    resolvedLanguage: lng,
    language: lng,
    // Like i18next 23: languageChanging at the call, languageChanged when the load finishes.
    changeLanguage: vi.fn(async (l: string) => {
      fire('languageChanging', l);
      i18n.finish(l);
    }),
    on: (e, f) => void listeners[e].add(f),
    off: (e, f) => void listeners[e].delete(f),
    emit: (l) => fire('languageChanged', l),
    request: (l) => fire('languageChanging', l),
    finish: (l) => {
      i18n.resolvedLanguage = l;
      i18n.language = l;
      fire('languageChanged', l);
    },
  };
  return i18n;
}

function fakeStore(language: string) {
  let value = { language, other: 0 };
  const subs = new Set<(v: { language?: string }) => void>();
  const store: LanguageStore & { setOther(n: number): void } = {
    get: () => value,
    setKey: (_k, v) => {
      value = { ...value, language: v };
      subs.forEach((f) => f(value));
    },
    subscribe: (f) => {
      subs.add(f);
      f(value); // nanostores calls a new subscriber at once
      return () => subs.delete(f);
    },
    setOther: (n) => {
      value = { ...value, other: n };
      subs.forEach((f) => f(value));
    },
  };
  return store;
}

describe('bindLanguageSync', () => {
  it('copies i18next’s language into the store at once, with no timer', () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore('en');
      bindLanguageSync(fakeI18n('ru'), store, SUPPORTED);
      expect(store.get().language).toBe('ru'); // before any timer runs
      vi.runAllTimers();
      expect(store.get().language).toBe('ru');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unrelated store change never re-applies a language (the race)', async () => {
    const i18n = fakeI18n('en');
    const store = fakeStore('en');
    bindLanguageSync(i18n, store, SUPPORTED);
    // A test switches i18next to Spanish and back, as ScratchFeelLanguages025 does.
    await i18n.changeLanguage('es');
    await i18n.changeLanguage('en');
    (i18n.changeLanguage as ReturnType<typeof vi.fn>).mockClear();
    store.setOther(1);
    store.setOther(2);
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(store.get().language).toBe('en');
  });

  it('choosing a language in the store switches i18next and caches it', () => {
    const i18n = fakeI18n('en');
    const store = fakeStore('en');
    const storage = { setItem: vi.fn() };
    bindLanguageSync(i18n, store, SUPPORTED, storage);
    store.setKey('language', 'es');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('es');
    expect(storage.setItem).toHaveBeenCalledWith('strudel-language', 'es');
  });

  it('a change made in i18next (language selector) reaches the store', () => {
    const i18n = fakeI18n('en');
    const store = fakeStore('en');
    bindLanguageSync(i18n, store, SUPPORTED);
    i18n.resolvedLanguage = 'ru';
    i18n.emit('ru');
    expect(store.get().language).toBe('ru');
  });

  it('negative pair: an unsupported detected language (en-US, xx) never reaches the store or i18next', () => {
    const i18n = fakeI18n('xx');
    const store = fakeStore('en');
    bindLanguageSync(i18n, store, SUPPORTED);
    expect(store.get().language).toBe('en');
    // At bind the store's supported 'en' is applied over the unsupported 'xx'.
    expect(i18n.changeLanguage).toHaveBeenCalledWith('en');
    (i18n.changeLanguage as ReturnType<typeof vi.fn>).mockClear();
    store.setKey('language', 'xx');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('a failed switch is logged, not thrown, and unbinding stops both directions', async () => {
    const i18n = fakeI18n('en');
    (i18n.changeLanguage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('load failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore('en');
    const unbind = bindLanguageSync(i18n, store, SUPPORTED);
    store.setKey('language', 'es');
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    unbind();
    (i18n.changeLanguage as ReturnType<typeof vi.fn>).mockClear();
    store.setKey('language', 'ru');
    i18n.resolvedLanguage = 'es';
    i18n.emit('es');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(store.get().language).toBe('ru');
  });

  it('a stale load finishing after a newer choice never reaches the store, and i18next goes back to it', () => {
    const i18n = fakeI18n('ru');
    const store = fakeStore('ru');
    bindLanguageSync(i18n, store, SUPPORTED);
    // fr requested (slow load), then ru (loaded) finishes first; then fr's load finishes.
    i18n.request('fr');
    i18n.request('ru');
    i18n.finish('ru');
    (i18n.changeLanguage as ReturnType<typeof vi.fn>).mockClear();
    i18n.finish('fr');
    expect(store.get().language).toBe('ru');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('ru');
    expect(i18n.resolvedLanguage).toBe('ru');
  });

  it('negative pair: the latest request finishing does reach the store', () => {
    const i18n = fakeI18n('ru');
    const store = fakeStore('ru');
    bindLanguageSync(i18n, store, SUPPORTED);
    i18n.request('es');
    i18n.finish('es');
    expect(store.get().language).toBe('es');
  });
});

describe('bindLanguageSync with real i18next', () => {
  it('fr (slow) then ru (fast): the store and i18next end on ru', async () => {
    const { default: i18next } = await import('i18next');
    const { default: resourcesToBackend } = await import('i18next-resources-to-backend');
    const i18n = i18next.createInstance();
    await i18n
      .use(
        resourcesToBackend(async (lng: string) => {
          if (lng === 'fr') await new Promise((r) => setTimeout(r, 30));
          return { hello: lng };
        }),
      )
      .init({ lng: 'en', fallbackLng: 'en', supportedLngs: SUPPORTED, ns: ['common'], defaultNS: 'common' });
    await i18n.loadLanguages(['ru']);
    const store = fakeStore('en');
    bindLanguageSync(i18n as unknown as LanguageSource, store, SUPPORTED);
    void i18n.changeLanguage('fr');
    await i18n.changeLanguage('ru');
    await new Promise((r) => setTimeout(r, 80));
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(store.get().language).toBe('ru');
  });
});
