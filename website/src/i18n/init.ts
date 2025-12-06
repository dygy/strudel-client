// Initialize i18n system
import { languages } from './index';
import i18n from './i18n';

// Initialize language on app start
if (typeof window !== 'undefined') {
  // Listen for language changes and update document attributes
  i18n.on('languageChanged', (lng) => {
    const config = languages[lng as keyof typeof languages];
    if (config) {
      document.documentElement.dir = config.rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = lng;
    }
  });
}

export function initializeLanguage() {
  // Language is already initialized by i18n.ts
}