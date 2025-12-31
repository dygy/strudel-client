import React from 'react';
import { Modal } from './Modal';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText,
  cancelText,
  variant = 'danger'
}: ConfirmModalProps) {
  const { t } = useTranslation('common');
  
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 focus:ring-red-500',
    warning: 'bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-700 dark:hover:bg-yellow-800 focus:ring-yellow-500',
    info: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 focus:ring-blue-500',
  };

  const iconStyles = {
    danger: 'text-red-500 dark:text-red-400',
    warning: 'text-yellow-500 dark:text-yellow-400',
    info: 'text-blue-500 dark:text-blue-400',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          <ExclamationTriangleIcon 
            className={`w-6 h-6 ${iconStyles[variant]}`} 
          />
        </div>
        <div className="flex-1">
          <div className="text-foreground dark:text-foreground/90 leading-relaxed">{message}</div>
        </div>
      </div>
      
      <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-lineHighlight/30">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-lineHighlight hover:bg-lineHighlight/80 dark:hover:bg-lineHighlight text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
        >
          {cancelText || t('cancel')}
        </button>
        <button
          onClick={handleConfirm}
          className={`px-4 py-2 text-white rounded transition-colors focus:outline-none focus:ring-2 ${variantStyles[variant]}`}
        >
          {confirmText || t('confirm')}
        </button>
      </div>
    </Modal>
  );
}