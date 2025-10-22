import React, { useEffect } from 'react';
import { useTranslation } from '@src/i18n';

interface I18nProviderProps {
  children: React.ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { i18n, isRTL, currentLanguage } = useTranslation();

  useEffect(() => {
    // Update document attributes when language changes
    if (typeof document !== 'undefined') {
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
      document.documentElement.lang = currentLanguage;
      
      // Add/remove RTL class for easier CSS targeting
      if (isRTL) {
        document.documentElement.classList.add('rtl');
      } else {
        document.documentElement.classList.remove('rtl');
      }
    }
  }, [currentLanguage, isRTL]);

  return <>{children}</>;
}