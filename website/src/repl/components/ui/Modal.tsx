import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop - theme-aware */}
      <div 
        className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal - theme-aware styling */}
      <div className={`relative bg-background border border-lineHighlight rounded-lg shadow-xl dark:shadow-2xl ${sizeClasses[size]} w-full mx-4`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-lineHighlight">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-lineHighlight rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
            aria-label="Close modal"
          >
            <XMarkIcon className="w-5 h-5 text-foreground" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 text-foreground">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}