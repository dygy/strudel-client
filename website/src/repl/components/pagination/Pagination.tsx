import { Incrementor } from '../incrementor/Incrementor';
import React from 'react';

interface PaginationProps extends Omit<React.ComponentProps<typeof Incrementor>, 'onChange' | 'value'> {
  currPage: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ currPage, onPageChange, className, ...incrementorProps }: PaginationProps) {
  return <Incrementor min={1} value={currPage} onChange={onPageChange} className={className} {...incrementorProps} />;
}