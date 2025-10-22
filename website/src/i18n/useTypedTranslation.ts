import { useTranslation as useI18nTranslation } from 'react-i18next';
import type {
    Namespace,
    TranslationFunction,
    MultiNamespaceTranslationFunction
} from './types';

// Language configuration (duplicated to avoid circular imports)
const languages = {
    en: { name: 'English', nativeName: 'English', rtl: false },
    fr: { name: 'French', nativeName: 'Français', rtl: false },
    es: { name: 'Spanish', nativeName: 'Español', rtl: false },
    ru: { name: 'Russian', nativeName: 'Русский', rtl: false },
    he: { name: 'Hebrew', nativeName: 'עברית', rtl: true },
    ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
    sr: { name: 'Serbian', nativeName: 'Српски', rtl: false },
};

// Extended return type with RTL support
interface TranslationResult<T> {
    t: T;
    i18n: ReturnType<typeof useI18nTranslation>['i18n'];
    ready: boolean;
    currentLanguage: keyof typeof languages;
    isRTL: boolean;
    changeLanguage: (lng: string) => Promise<any>;
}

// Single namespace overload
export function useTranslation<T extends Namespace>(
    namespace: T
): TranslationResult<TranslationFunction<T>>;

// Multiple namespaces overload
export function useTranslation<T extends Namespace[]>(
    namespaces: T
): TranslationResult<MultiNamespaceTranslationFunction<T>>;

// Default namespace overload
export function useTranslation(): TranslationResult<TranslationFunction<'common'>>;

// Implementation
export function useTranslation<T extends Namespace | Namespace[]>(
    namespaces?: T
): any {
    const { t: originalT, i18n, ready } = useI18nTranslation(namespaces as any);

    const currentLanguage = i18n.language as keyof typeof languages;
    const isRTL = languages[currentLanguage]?.rtl || false;

    const typedT = (key: string) => {
        // Handle namespace:key format for multiple namespaces
        if (typeof key === 'string' && key.includes(':')) {
            const [namespace, translationKey] = key.split(':');
            return originalT(translationKey, { ns: namespace });
        }

        // Handle single namespace
        return originalT(key);
    };

    return {
        t: typedT,
        i18n,
        ready,
        currentLanguage,
        isRTL,
        changeLanguage: i18n.changeLanguage,
    };
}

// Re-export the original hook for cases where we don't need typing
export { useTranslation as useTranslationOriginal } from 'react-i18next';