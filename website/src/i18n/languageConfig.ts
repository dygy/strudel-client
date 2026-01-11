// Language metadata configuration using Vite's import.meta.glob for automatic detection
// This automatically detects available locales at build time

export interface LanguageMetadata {
  name: string;
  nativeName: string;
  rtl: boolean;
}

// Language metadata - only add languages here when you want to support them
// The system will automatically detect which ones have translation files
export const LANGUAGE_METADATA: Record<string, LanguageMetadata> = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  fr: { name: 'French', nativeName: 'Français', rtl: false },
  es: { name: 'Spanish', nativeName: 'Español', rtl: false },
  ru: { name: 'Russian', nativeName: 'Русский', rtl: false },
  he: { name: 'Hebrew', nativeName: 'עברית', rtl: true },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  sr: { name: 'Serbian', nativeName: 'Српски', rtl: false },
  zh: { name: 'Chinese', nativeName: '中文', rtl: false },
  ko: { name: 'Korean', nativeName: '한국어', rtl: false },
  // Add more languages here as needed
  de: { name: 'German', nativeName: 'Deutsch', rtl: false },
  ja: { name: 'Japanese', nativeName: '日本語', rtl: false },
  pt: { name: 'Portuguese', nativeName: 'Português', rtl: false },
  it: { name: 'Italian', nativeName: 'Italiano', rtl: false },
  nl: { name: 'Dutch', nativeName: 'Nederlands', rtl: false },
  pl: { name: 'Polish', nativeName: 'Polski', rtl: false },
  tr: { name: 'Turkish', nativeName: 'Türkçe', rtl: false },
  hi: { name: 'Hindi', nativeName: 'हिन्दी', rtl: false },
  th: { name: 'Thai', nativeName: 'ไทย', rtl: false },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', rtl: false },
  fa: { name: 'Persian', nativeName: 'فارسی', rtl: true },
  ur: { name: 'Urdu', nativeName: 'اردو', rtl: true },
  bn: { name: 'Bengali', nativeName: 'বাংলা', rtl: false },
  id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia', rtl: false },
  ms: { name: 'Malay', nativeName: 'Bahasa Melayu', rtl: false },
  sw: { name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
};

// Automatically detect available languages using Vite's import.meta.glob
function detectAvailableLanguages(): Record<string, LanguageMetadata> {
  // Use Vite's import.meta.glob to get all locale directories at build time
  const localeFiles = import.meta.glob('./locales/*/common.json', { eager: false });
  
  const availableLanguages: Record<string, LanguageMetadata> = {};
  
  // Extract language codes from the file paths
  Object.keys(localeFiles).forEach(path => {
    const match = path.match(/\.\/locales\/([^/]+)\/common\.json$/);
    if (match) {
      const langCode = match[1];
      const metadata = LANGUAGE_METADATA[langCode];
      if (metadata) {
        availableLanguages[langCode] = metadata;
      } else {
        // If we don't have metadata for this language, create a default entry
        console.warn(`No metadata found for language '${langCode}', using defaults`);
        availableLanguages[langCode] = {
          name: langCode.toUpperCase(),
          nativeName: langCode.toUpperCase(),
          rtl: false
        };
      }
    }
  });
  
  // Ensure English is always available as fallback
  if (!availableLanguages.en && LANGUAGE_METADATA.en) {
    availableLanguages.en = LANGUAGE_METADATA.en;
  }
  
  return availableLanguages;
}

// Export the detected languages
export const languages = detectAvailableLanguages();

// Export supported language codes for i18next
export const supportedLanguages = Object.keys(languages);

// Helper function to check if a language is RTL
export function isRTL(languageCode: string): boolean {
  return languages[languageCode]?.rtl || false;
}