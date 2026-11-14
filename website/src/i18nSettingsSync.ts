/**
 * Keeps the settings store's `language` and i18next's active language in step.
 *
 * It replaces a sync that ran from a 10 ms timer after module load and called `changeLanguage` on
 * every store change without checking i18next's own state. The timer could land at any later
 * moment, mid-test under vitest's isolate:false, and copy a stale cached language into the store.
 * After that, any unrelated `setKey` re-applied that language. This version:
 * - syncs i18next → store once, synchronously, at bind time, then on i18next's `languageChanged`;
 * - syncs store → i18next only when the store's language differs from what i18next resolved to;
 * - ignores languages the app doesn't support (a detected `en-US` never reaches the store).
 */

/** The part of i18next this uses. */
export interface LanguageSource {
  resolvedLanguage?: string;
  language?: string;
  changeLanguage(lng: string): Promise<unknown>;
  on(event: 'languageChanged' | 'languageChanging', listener: (lng: string) => void): void;
  off?(event: 'languageChanged' | 'languageChanging', listener: (lng: string) => void): void;
}

/** The part of the settings store this uses. */
export interface LanguageStore {
  get(): { language?: string };
  setKey(key: 'language', value: string): void;
  subscribe(listener: (value: { language?: string }) => void): () => void;
}

/**
 * Bind the store and i18next together. Returns an unbind function.
 * @param i18n - i18next instance
 * @param store - the settings store (nanostores map)
 * @param supported - language codes the app ships
 * @param storage - where i18next caches the choice (`strudel-language`); optional
 */
export function bindLanguageSync(
  i18n: LanguageSource,
  store: LanguageStore,
  supported: readonly string[],
  storage?: Pick<Storage, 'setItem'> | null,
): () => void {
  const isSupported = (lng: string | undefined): lng is string => !!lng && supported.includes(lng);
  const active = () => i18n.resolvedLanguage || i18n.language;

  const toStore = (lng: string | undefined) => {
    if (isSupported(lng) && lng !== store.get().language) store.setKey('language', lng);
  };

  toStore(active());
  // i18next fires languageChanged in the order loads finish, not the order of the calls: pick fr
  // (not loaded yet), then ru (loaded), and fr's late load still fires and switches i18next to fr.
  // `languageChanging` fires at each call, so it tells which choice is the latest; a stale finish
  // never reaches the store and i18next is switched back to the latest choice.
  let latest: string | undefined;
  const onChanging = (lng: string) => {
    latest = lng;
  };
  const onChanged = (lng: string) => {
    if (latest && lng !== latest) {
      i18n.changeLanguage(latest).catch(() => {});
      return;
    }
    toStore(i18n.resolvedLanguage || lng);
  };
  i18n.on('languageChanging', onChanging);
  i18n.on('languageChanged', onChanged);

  const unsubscribe = store.subscribe(({ language }) => {
    if (!isSupported(language) || language === active()) return;
    try {
      storage?.setItem('strudel-language', language);
    } catch {
      // storage blocked: i18next still switches, the choice just isn't cached
    }
    i18n.changeLanguage(language).catch((error: unknown) => {
      console.warn('[settings] could not switch language to', language, error);
    });
  });

  return () => {
    unsubscribe();
    i18n.off?.('languageChanged', onChanged);
    i18n.off?.('languageChanging', onChanging);
  };
}
