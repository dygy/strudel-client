import React from 'react';
import { Modal } from './Modal';
import { ExclamationTriangleIcon, DocumentIcon, FolderIcon } from '@heroicons/react/24/outline';
import { useTranslation } from '@src/i18n';
import type { ImportConflict } from './ImportConflictModal.types';

interface ImportConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: ImportConflict[];
  onResolve: (resolution: 'overwrite' | 'skip' | 'overwriteAll' | 'skipAll') => void;
  currentIndex: number;
}

export function ImportConflictModal({
  isOpen,
  onClose,
  conflicts,
  onResolve,
  currentIndex
}: ImportConflictModalProps) {
  const { t } = useTranslation(['files', 'common']);

  if (conflicts.length === 0) return null;

  const conflict = conflicts[currentIndex];
  const hasMore = currentIndex < conflicts.length - 1;
  const isMultiple = conflicts.length > 1;

  const getIcon = () => {
    switch (conflict.type) {
      case 'folder':
        return <FolderIcon className="w-8 h-8 text-yellow-500 dark:text-yellow-400" />;
      case 'multitrack':
        return <DocumentIcon className="w-8 h-8 text-blue-500 dark:text-blue-400" />;
      default:
        return <DocumentIcon className="w-8 h-8 text-blue-500 dark:text-blue-400" />;
    }
  };

  const getTypeLabel = () => {
    switch (conflict.type) {
      case 'folder':
        return t('files:folder');
      case 'multitrack':
        return t('files:multitrack');
      default:
        return t('files:track');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('files:importConflict.title')} size="md">
      <div className="space-y-4">
        {/* Warning Header */}
        <div className="flex items-start space-x-3 p-3 bg-yellow-500/10 dark:bg-yellow-500/20 border border-yellow-500/30 rounded">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {t('files:importConflict.message', { 
                type: getTypeLabel().toLowerCase(),
                name: conflict.name 
              })}
            </p>
            {isMultiple && (
              <p className="text-xs text-foreground/70 mt-1">
                {t('files:importConflict.multipleConflicts', { 
                  current: currentIndex + 1, 
                  total: conflicts.length 
                })}
              </p>
            )}
          </div>
        </div>

        {/* Item Details */}
        <div className="space-y-3">
          {/* Existing Item */}
          <div className="p-3 bg-lineHighlight/50 rounded">
            <div className="flex items-center space-x-2 mb-2">
              {getIcon()}
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{t('files:importConflict.existing')}</p>
                <p className="text-xs text-foreground/70">{conflict.path || t('files:rootFolder')}</p>
              </div>
            </div>
            {conflict.existingItem && (
              <div className="text-xs text-foreground/60 space-y-1 ml-10">
                <p>{t('files:created')}: {new Date(conflict.existingItem.created).toLocaleString()}</p>
                <p>{t('files:modified')}: {new Date(conflict.existingItem.modified).toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* New Item */}
          <div className="p-3 bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/30 rounded">
            <div className="flex items-center space-x-2 mb-2">
              {getIcon()}
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{t('files:importConflict.new')}</p>
                <p className="text-xs text-foreground/70">{t('files:importConflict.fromImport')}</p>
              </div>
            </div>
            {conflict.newItem && (
              <div className="text-xs text-foreground/60 space-y-1 ml-10">
                {conflict.newItem.size && (
                  <p>{t('files:size')}: {(conflict.newItem.size / 1024).toFixed(2)} KB</p>
                )}
                {conflict.newItem.stepsCount && (
                  <p>{t('files:steps')}: {conflict.newItem.stepsCount}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col space-y-2 pt-4 border-t border-lineHighlight/30">
          <div className="flex space-x-2">
            <button
              onClick={() => onResolve('overwrite')}
              className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-700 dark:hover:bg-yellow-800 text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              {t('files:importConflict.overwrite')}
            </button>
            <button
              onClick={() => onResolve('skip')}
              className="flex-1 px-4 py-2 bg-lineHighlight hover:bg-lineHighlight/80 text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
            >
              {t('files:importConflict.skip')}
            </button>
          </div>
          
          {isMultiple && (
            <div className="flex space-x-2">
              <button
                onClick={() => onResolve('overwriteAll')}
                className="flex-1 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {t('files:importConflict.overwriteAll')}
              </button>
              <button
                onClick={() => onResolve('skipAll')}
                className="flex-1 px-3 py-1.5 text-sm bg-lineHighlight/60 hover:bg-lineHighlight text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
              >
                {t('files:importConflict.skipAll')}
              </button>
            </div>
          )}
          
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm bg-lineHighlight/40 hover:bg-lineHighlight/60 text-foreground rounded transition-colors focus:outline-none focus:ring-2 focus:ring-lineHighlight"
          >
            {t('common:cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
