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
    i18n.changeLanguage(newLanguage);
    onChange?.(newLanguage);
  };

  return (
    <select
      className="p-2 bg-background rounded-md text-foreground border-foreground"
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