import cx from '@src/cx';
import React from 'react';

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  label?: string;
  labelIsHidden?: boolean;
  className?: string;
}

export function ActionButton({ children, label, labelIsHidden, className, ...buttonProps }: ActionButtonProps) {
  return (
    <button className={cx('hover:opacity-50 text-nowrap w-fit', className)} title={label} {...buttonProps}>
      {labelIsHidden !== true && label}
      {children}
    </button>
  );
}