import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import JSON translation files
import enCommon from './locales/en/common.json';
import enFiles from './locales/en/files.json';
import enSettings from './locales/en/settings.json';
import enTabs from './locales/en/tabs.json';
import enMessages from './locales/en/messages.json';
import enWelcome from './locales/en/welcome.json';

import frCommon from './locales/fr/common.json';
import frFiles from './locales/fr/files.json';
import frSettings from './locales/fr/settings.json';
import frTabs from './locales/fr/tabs.json';
import frMessages from './locales/fr/messages.json';
import frWelcome from './locales/fr/welcome.json';

import esCommon from './locales/es/common.json';
import esFiles from './locales/es/files.json';
import esSettings from './locales/es/settings.json';
import esTabs from './locales/es/tabs.json';
import esMessages from './locales/es/messages.json';
import esWelcome from './locales/es/welcome.json';

// Import other language files
import ruCommon from './locales/ru/common.json';
import ruFiles from './locales/ru/files.json';
import ruSettings from './locales/ru/settings.json';
import ruTabs from './locales/ru/tabs.json';
import ruMessages from './locales/ru/messages.json';
import ruWelcome from './locales/ru/welcome.json';

import heCommon from './locales/he/common.json';
import heFiles from './locales/he/files.json';
import heSettings from './locales/he/settings.json';
import heTabs from './locales/he/tabs.json';
import heMessages from './locales/he/messages.json';
import heWelcome from './locales/he/welcome.json';

import arCommon from './locales/ar/common.json';
import arFiles from './locales/ar/files.json';
import arSettings from './locales/ar/settings.json';
import arTabs from './locales/ar/tabs.json';
import arMessages from './locales/ar/messages.json';
import arWelcome from './locales/ar/welcome.json';

import srCommon from './locales/sr/common.json';
import srFiles from './locales/sr/files.json';
import srSettings from './locales/sr/settings.json';
import srTabs from './locales/sr/tabs.json';
import srMessages from './locales/sr/messages.json';
import srWelcome from './locales/sr/welcome.json';

const resources = {
  en: {
    common: enCommon,
    files: enFiles,
    settings: enSettings,
    tabs: enTabs,
    messages: enMessages,
    welcome: enWelcome,
  },
  fr: {
    common: frCommon,
    files: frFiles,
    settings: frSettings,
    tabs: frTabs,
    messages: frMessages,
    welcome: frWelcome,
  },
  es: {
    common: esCommon,
    files: esFiles,
    settings: esSettings,
    tabs: esTabs,
    messages: esMessages,
    welcome: esWelcome,
  },
  ru: {
    common: ruCommon,
    files: ruFiles,
    settings: ruSettings,
    tabs: ruTabs,
    messages: ruMessages,
    welcome: ruWelcome,
  },
  he: {
    common: heCommon,
    files: heFiles,
    settings: heSettings,
    tabs: heTabs,
    messages: heMessages,
    welcome: heWelcome,
  },
  ar: {
    common: arCommon,
    files: arFiles,
    settings: arSettings,
    tabs: arTabs,
    messages: arMessages,
    welcome: arWelcome,
  },
  sr: {
    common: srCommon,
    files: srFiles,
    settings: srSettings,
    tabs: srTabs,
    messages: srMessages,
    welcome: srWelcome,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'files', 'settings', 'tabs', 'messages', 'welcome'],
    debug: false,
    
    interpolation: {
      escapeValue: false,
    },
    
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'strudel-language',
    },
  });

// Language configuration for RTL support
const languages = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  fr: { name: 'French', nativeName: 'Français', rtl: false },
  es: { name: 'Spanish', nativeName: 'Español', rtl: false },
  ru: { name: 'Russian', nativeName: 'Русский', rtl: false },
  he: { name: 'Hebrew', nativeName: 'עברית', rtl: true },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  sr: { name: 'Serbian', nativeName: 'Српски', rtl: false },
};

// Set document direction based on language
i18n.on('languageChanged', (lng) => {
  const config = languages[lng as keyof typeof languages];
  if (typeof document !== 'undefined') {
    document.documentElement.dir = config?.rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lng;
    
    // Add/remove RTL class for easier CSS targeting
    if (config?.rtl) {
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.classList.remove('rtl');
    }
  }
});

export default i18n;