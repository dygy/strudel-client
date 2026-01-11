import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { languages, supportedLanguages, isRTL } from './languageConfig';

// Only use LanguageDetector in browser environment
if (typeof window !== 'undefined') {
  i18n.use(LanguageDetector);
}

i18n
  .use(initReactI18next)
  // Add the resources backend for lazy loading
  .use(resourcesToBackend((language: string, namespace: string) => 
    import(`./locales/${language}/${namespace}.json`)
  ))
  .init({
    // No resources needed - they'll be loaded dynamically
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'files', 'settings', 'tabs', 'messages', 'welcome', 'auth', 'shortcuts'],
    debug: false,
    
    // Automatically configure supported languages
    supportedLngs: supportedLanguages,
    
    interpolation: {
      escapeValue: false,
    },
    
    // Only configure detection in browser environment
    ...(typeof window !== 'undefined' && {
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
        lookupLocalStorage: 'strudel-language',
      },
    }),
  });

// Set document direction based on language
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    const rtl = isRTL(lng);
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lng;
    
    // Add/remove RTL class for easier CSS targeting
    if (rtl) {
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.classList.remove('rtl');
    }
  }
});

export default i18n;