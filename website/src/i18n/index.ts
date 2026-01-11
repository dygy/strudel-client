// Initialize i18n
import './i18n';

// Import and re-export typed translation hook
import { useTranslation as useTypedTranslation } from './useTypedTranslation';
export { useTypedTranslation as useTranslation };

// Export types
export type * from './types';

// Export date formatting utilities
export { formatDateTime, formatDateTimeIntl, useFormattedDate } from './dateFormat';

// Import language configuration
import { languages, supportedLanguages, isRTL } from './languageConfig';

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

// Export automatically detected languages
export { languages, supportedLanguages, isRTL };

export type Language = keyof typeof languages;

// Re-export language utilities
export { LANGUAGE_METADATA } from './languageConfig';
export type { LanguageMetadata } from './languageConfig';