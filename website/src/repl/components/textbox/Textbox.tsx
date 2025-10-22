import cx from '@src/cx';
import React from 'react';

interface TextboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange: (value: string) => void;
  className?: string;
}

export function Textbox({ onChange, className, ...inputProps }: TextboxProps) {
  return (
    <input
      className={cx(
        'p-2 bg-background rounded-md  border-foreground text-foreground placeholder-foreground',
        className,
      )}
      onChange={(e) => onChange(e.target.value)}
      {...inputProps}
    />
  );
}