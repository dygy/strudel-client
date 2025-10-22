# Strudel i18n (Internationalization) System

This directory contains the internationalization system for Strudel, supporting multiple languages with RTL (Right-to-Left) language support.

## Supported Languages

- **English** (en) - Default
- **French** (fr) - Français  
- **Spanish** (es) - Español
- **Russian** (ru) - Русский
- **Hebrew** (he) - עברית (RTL)
- **Arabic** (ar) - العربية (RTL)
- **Serbian** (sr) - Српски

## Usage

### In React Components

```jsx
import { useTranslation } from '../i18n';

function MyComponent() {
  const { t, language, setLanguage, isRTL } = useTranslation();
  
  return (
    <div>
      <h1>{t('settings.title')}</h1>
      <p>Current language: {language}</p>
      {isRTL && <p>This is a right-to-left language</p>}
    </div>
  );
}
```

### Direct Translation Function

```javascript
import { t } from '../i18n';

const message = t('settings.title'); // Returns translated string
const messageInFrench = t('settings.title', 'fr'); // Force specific language
```

### Language Management

```javascript
import { setLanguage, useLanguage, getBrowserLanguage } from '../i18n';

// Set language
setLanguage('fr');

// Get current language in a React component
const language = useLanguage();

// Get browser's preferred language
const browserLang = getBrowserLanguage();
```

## Integration

### 1. Add I18nProvider to your app

```jsx
import { I18nProvider } from '../components/I18nProvider';

function App() {
  return (
    <I18nProvider>
      {/* Your app content */}
    </I18nProvider>
  );
}
```

### 2. Import RTL CSS

Add to your main CSS file:
```css
@import '../i18n/rtl.css';
```

### 3. Initialize in Astro layouts

In your Astro layout files, you can use:
```astro
---
import { getBrowserLanguage } from '../i18n';
const lang = getBrowserLanguage();
---

<html dir="ltr" lang={lang}>
  <!-- Your content -->
</html>
```

## Language Selector Component

The `LanguageSelector` component is already integrated into the Settings tab:

```jsx
import { LanguageSelector } from './components/panel/LanguageSelector';

<LanguageSelector
  currentLanguage={language}
  onChange={(newLanguage) => setLanguage(newLanguage)}
/>
```

## Adding New Translations

1. Add your translation key to the `TranslationKey` type in `i18n/index.ts`
2. Add the translation to all language objects in the `translations` constant
3. Use the new key with `t('your.new.key')`

Example:
```typescript
// Add to translations object
export const translations = {
  en: {
    'myFeature.title': 'My Feature',
    // ... other translations
  },
  fr: {
    'myFeature.title': 'Ma Fonctionnalité',
    // ... other translations
  },
  // ... other languages
};
```

## RTL Language Support

RTL languages (Hebrew, Arabic) are automatically detected and the following happens:

1. `document.documentElement.dir` is set to `'rtl'`
2. `document.documentElement.lang` is set to the language code
3. RTL-specific CSS classes are applied
4. The `isRTL` flag is available in `useTranslation()`

## File Structure

```
i18n/
├── index.ts          # Main i18n system and translations
├── init.ts           # Initialization utilities
├── rtl.css           # RTL language styles
└── README.md         # This documentation
```

## Complete Interface Coverage

The i18n system now covers **all user-facing text** in Strudel:

### Interface Elements Translated
- ✅ **Header/Navigation** - Play/stop buttons, update, shuffle, files toggle, docs link
- ✅ **Panel Tabs** - All 7 tab names (Welcome, Patterns, Sounds, Reference, Console, Files, Settings)
- ✅ **Patterns Tab** - Search, filters, action buttons, status messages
- ✅ **Sounds Tab** - Search, categories, import/export, clear functions
- ✅ **File Manager** - New track, save/load/delete, confirmations
- ✅ **Welcome Tab** - Title, subtitle, navigation links
- ✅ **Console** - Clear/copy buttons, empty states
- ✅ **Reference** - Search and no results messages
- ✅ **Database Operations** - All user-facing messages for sample loading, processing, and errors
- ✅ **Settings** - All settings labels, descriptions, and values

### Total Translation Keys: 64+ keys
All interface elements are fully translated across all 7 supported languages.

## Settings Integration

The language selector is automatically included in the Settings tab. Users can:

1. Open Settings (gear icon in the panel)
2. Select their preferred language from the dropdown
3. The interface immediately updates to the selected language
4. The preference is saved and persists across sessions

## Browser Language Detection

The system automatically detects the user's browser language preference on first visit and sets it as the default if supported. If the browser language is not supported, it falls back to English.

## Persistence

Language preferences are automatically saved to localStorage and restored on subsequent visits using the `@nanostores/persistent` system, which is already integrated with Strudel's settings system.