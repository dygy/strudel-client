import React from 'react';
import { Modal } from './Modal';
import { useTranslation } from '@src/i18n';

interface InfoItem {
  label: string;
  value: string;
}

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: InfoItem[];
}

export function InfoModal({ isOpen, onClose, title, items }: InfoModalProps) {
  const { t } = useTranslation('common');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="flex justify-between items-start py-2 border-b border-lineHighlight/30 last:border-b-0">
            <span className="text-foreground/70 dark:text-foreground/60 font-medium min-w-0 flex-shrink-0 mr-4">
              {item.label}:
            </span>
            <span className="text-foreground dark:text-foreground/90 text-right break-all font-mono text-sm">
              {item.value}
            </span>
          </div>
        ))}
      </div>
      
      <div className="flex justify-end mt-6 pt-4 border-t border-lineHighlight/30">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-lineHighlight hover:bg-lineHighlight/80 dark:hover:bg-lineHighlight text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
        >
          {t('close')}
        </button>
      </div>
    </Modal>
  );
}
