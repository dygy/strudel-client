import React from 'react';
import { useTranslation } from '@src/i18n';

interface SelectInputProps {
  value: string | null | undefined;
  options: Map<string, any>;
  onChange: (value: string) => void;
  onClick?: (event: React.MouseEvent<HTMLSelectElement>) => void;
  isDisabled: boolean;
}

export function SelectInput({ value, options, onChange, onClick, isDisabled }: SelectInputProps) {
  const { t } = useTranslation('common');
  
  return (
    <select
      disabled={isDisabled}
      onClick={onClick}
      className="p-2 bg-background rounded-md text-foreground  border-foreground"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.size == 0 && <option value={value ?? ''}>{`${value ?? t('selectOption')}`}</option>}
      {Array.from(options.keys()).map((id) => (
        <option key={id} className="bg-background" value={id}>
          {options.get(id)}
        </option>
      ))}
    </select>
  );
}