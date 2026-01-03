// Initialize i18n
import './i18n';

// Import and re-export typed translation hook
import { useTranslation as useTypedTranslation } from './useTypedTranslation';
export { useTypedTranslation as useTranslation };

// Export types
export type * from './types';

// Export date formatting utilities
export { formatDateTime, formatDateTimeIntl, useFormattedDate } from './dateFormat';

// Convenience hooks for specific namespaces
export function useSettingsTranslation() {
  return useTypedTranslation('settings');
}

export function useFilesTranslation() {
  return useTypedTranslation('files');
}

export function useCommonTranslation() {
  return useTypedTranslation('common');
}

export function useWelcomeTranslation() {
  return useTypedTranslation('welcome');
}

export function useAuthTranslation() {
  return useTypedTranslation('auth');
}

// Language configuration
export const languages = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  fr: { name: 'French', nativeName: 'Français', rtl: false },
  es: { name: 'Spanish', nativeName: 'Español', rtl: false },
  ru: { name: 'Russian', nativeName: 'Русский', rtl: false },
  he: { name: 'Hebrew', nativeName: 'עברית', rtl: true },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  sr: { name: 'Serbian', nativeName: 'Српски', rtl: false },
};

export type Language = keyof typeof languages;