import { useTranslation } from 'react-i18next';
import { languages, type Language } from '@src/i18n';

interface LanguageSelectorProps {
  currentLanguage?: Language;
  onChange?: (language: Language) => void;
}

export function LanguageSelector({ currentLanguage, onChange }: LanguageSelectorProps) {
  const { i18n } = useTranslation();
  const activeLanguage = currentLanguage || i18n.language;

  const handleLanguageChange = (newLanguage: Language) => {
    // Update i18next
    i18n.changeLanguage(newLanguage);
    
    // Also update localStorage directly to ensure persistence
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('strudel-language', newLanguage);
    }
    
    // Call the onChange callback to update settings store
    onChange?.(newLanguage);
  };

  return (
    <select
      className="p-2 bg-background rounded-xl text-foreground border-foreground/50 pe-8"
      value={activeLanguage}
      onChange={(e) => handleLanguageChange(e.target.value as Language)}
    >
      {Object.entries(languages).map(([code, lang]) => (
        <option key={code} className="bg-background" value={code}>
          {lang.nativeName} ({lang.name})
        </option>
      ))}
    </select>
  );
}
