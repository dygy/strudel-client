// Initialize i18n
import './i18n';

// Export typed translation hook
export { useTranslation } from './useTypedTranslation';

// Export types
export type * from './types';

// Export date formatting utilities
export { formatDateTime, formatDateTimeIntl, useFormattedDate } from './dateFormat';

// Convenience hooks for specific namespaces
export function useSettingsTranslation() {
  return useTranslation('settings');
}

export function useFilesTranslation() {
  return useTranslation('files');
}

export function useCommonTranslation() {
  return useTranslation('common');
}

export function useWelcomeTranslation() {
  return useTranslation('welcome');
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