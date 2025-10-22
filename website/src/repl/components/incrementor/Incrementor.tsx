import { Textbox } from '../textbox/Textbox';
import cx from '@src/cx';
import React from 'react';

interface IncButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
}

function IncButton({ children, className, ...buttonProps }: IncButtonProps) {
  return (
    <button
      tabIndex={-1}
      className={cx(
        'border border-transparent p-1 text-center hover:text-background text-sm transition-all hover:bg-foreground active:bg-lineBackground disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
        className,
      )}
      type="button"
      {...buttonProps}
    >
      {children}
    </button>
  );
}

interface IncrementorProps extends Omit<React.ComponentProps<typeof Textbox>, 'onChange' | 'value'> {
  onChange: (value: number) => void;
  value: number | string;
  min?: number;
  max?: number;
  className?: string;
  incrementLabel?: string;
  decrementLabel?: string;
}

export function Incrementor({
  onChange,
  value,
  min = -Infinity,
  max = Infinity,
  className,
  incrementLabel = 'next page',
  decrementLabel = 'prev page',
  ...incrementorProps
}: IncrementorProps) {
  const numValue = parseInt(String(value));
  const displayValue = isNaN(numValue) ? '' : numValue;
  
  return (
    <div className={cx('w-fit bg-background relative flex items-center rounded-md', className)}>
      <Textbox
        min={min}
        max={max}
        onChange={(v) => {
          const numV = parseInt(v);
          if (v.length && numV < min) {
            return;
          }
          onChange(isNaN(numV) ? 0 : numV);
        }}
        type="number"
        placeholder=""
        value={displayValue}
        className="w-32 mb-0 mt-0 border-none rounded-r-none bg-transparent appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        {...incrementorProps}
      />
      <div className="flex gap-1 ">
        <IncButton disabled={numValue <= min} onClick={() => onChange(numValue - 1)} aria-label={decrementLabel}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
            <path d="M3.75 7.25a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z" />
          </svg>
        </IncButton>
        <IncButton
          className="rounded-r-md"
          disabled={numValue >= max}
          onClick={() => onChange(numValue + 1)}
          aria-label={incrementLabel}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
            <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
          </svg>
        </IncButton>
      </div>
    </div>
  );
}