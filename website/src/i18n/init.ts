// Initialize i18n system
import { initializeLanguage, languages, languageStore } from './index';

// Initialize language on app start
if (typeof window !== 'undefined') {
  // Initialize language from stored preference or browser default
  initializeLanguage();
  
  // Listen for language changes and update document attributes
  languageStore.subscribe((state) => {
    const config = languages[state.language];
    document.documentElement.dir = config.rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = state.language;
  });
}

export { initializeLanguage };