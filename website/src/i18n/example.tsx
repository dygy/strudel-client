import { useTranslation } from '@src/i18n';

// Example showing different ways to use the typed translation hook

export function TypedTranslationExample() {
  // Single namespace - gives you autocomplete for keys in that namespace
  const { t: tSettings } = useTranslation('settings');
  
  // Multiple namespaces - allows namespace:key syntax
  const { t: tMultiple } = useTranslation(['common', 'files']);
  
  // Default namespace (common)
  const { t: tDefault } = useTranslation();
  
  return (
    <div>
      {/* Single namespace usage - TypeScript will autocomplete these keys */}
      <h1>{tSettings('language')}</h1>
      <p>{tSettings('audioEngine')}</p>
      
      {/* Multiple namespace usage - use namespace:key syntax */}
      <button>{tMultiple('common:play')}</button>
      <span>{tMultiple('files:save')}</span>
      
      {/* Default namespace (common) */}
      <button>{tDefault('close')}</button>
      
      {/* TypeScript will catch these errors: */}
      {/* tSettings('nonExistentKey') // ❌ Error: Key doesn't exist */}
      {/* tMultiple('invalidNamespace:key') // ❌ Error: Invalid namespace */}
    </div>
  );
}

// You can also create namespace-specific hooks for convenience
export function useSettingsTranslation() {
  return useTranslation('settings');
}

export function useFilesTranslation() {
  return useTranslation('files');
}

export function useCommonTranslation() {
  return useTranslation('common');
}

// Example showing RTL support
export function RTLExample() {
  const { t, isRTL, currentLanguage } = useTranslation('common');
  
  return (
    <div className={`p-4 ${isRTL ? 'text-right' : 'text-left'}`}>
      <h2>Current Language: {currentLanguage}</h2>
      <p>Is RTL: {isRTL ? 'Yes' : 'No'}</p>
      <p>Direction: {isRTL ? 'Right-to-Left' : 'Left-to-Right'}</p>
      
      {/* Text will automatically align based on RTL */}
      <div className="mt-4">
        <button className="px-4 py-2 bg-blue-500 text-white rounded">
          {t('play')}
        </button>
        <button className="px-4 py-2 bg-red-500 text-white rounded ml-2">
          {t('stop')}
        </button>
      </div>
    </div>
  );
}