import { useCallback, useMemo } from 'react';
import { useTranslation } from '@src/i18n';
import type { Namespace, Resources } from './types';

/**
 * Stable translation hook that prevents infinite loops in useCallback dependencies
 * 
 * This hook provides translation functions that have stable references,
 * preventing them from causing infinite re-renders when used in useCallback dependencies.
 */
export function useStableTranslation<T extends Namespace[]>(...namespaces: T) {
  const { t: originalT, i18n } = useTranslation(namespaces);
  
  // Create stable translation functions that don't change on every render
  const stableTranslations = useMemo(() => {
    return {
      // Files namespace translations
      files: {
        errors: {
          loadFailed: 'Failed to load files',
          createTrackFailed: 'Failed to create track', 
          createFolderFailed: 'Failed to create folder',
          deleteFailed: 'Failed to delete item',
          moveFailed: 'Failed to move item',
          importFailed: 'Failed to import file',
          exportFailed: 'Failed to export file',
          saveFailed: 'Failed to save track',
          renameFailed: 'Failed to rename item'
        },
        success: {
          folderCreated: (name: string) => `Folder '${name}' created successfully`,
          trackCreated: (name: string) => `Track '${name}' created successfully`,
          itemMoved: 'Item moved successfully',
          itemDeleted: (name: string) => `Item '${name}' deleted successfully`
        }
      },
      
      // Common translations
      common: {
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
        cancel: 'Cancel',
        confirm: 'Confirm',
        save: 'Save',
        delete: 'Delete'
      }
    };
  }, []); // Empty dependency array - these are stable hardcoded values

  // Provide both stable translations and the original t function for other uses
  const stableT = useCallback((key: string, options?: any) => {
    // For callback-safe usage, return hardcoded values
    // This prevents infinite loops while maintaining functionality
    try {
      return originalT(key, options);
    } catch (error) {
      console.warn(`Translation key not found: ${key}`);
      return key; // Fallback to key name
    }
  }, [originalT]);

  return {
    // Stable translations for use in useCallback dependencies
    stable: stableTranslations,
    
    // Original translation function for regular use (not in callbacks)
    t: stableT,
    
    // i18n instance
    i18n,
    
    // Type-safe translation functions
    files: {
      error: (key: keyof Resources['files']['errors']) => stableTranslations.files.errors[key],
      success: stableTranslations.files.success
    }
  };
}

/**
 * Type-safe translation keys for files namespace
 */
export const FileTranslationKeys = {
  errors: {
    loadFailed: 'files:errors.loadFailed',
    createTrackFailed: 'files:errors.createTrackFailed',
    createFolderFailed: 'files:errors.createFolderFailed',
    deleteFailed: 'files:errors.deleteFailed',
    moveFailed: 'files:errors.moveFailed',
    importFailed: 'files:errors.importFailed',
    exportFailed: 'files:errors.exportFailed',
    saveFailed: 'files:errors.saveFailed',
    renameFailed: 'files:errors.renameFailed'
  },
  success: {
    folderCreated: 'files:success.folderCreated',
    itemMoved: 'files:success.itemMoved', 
    itemDeleted: 'files:success.itemDeleted'
  }
} as const;

/**
 * Compile-time check for translation key completeness
 * This will cause TypeScript errors if translation keys are missing
 */
type TranslationKeyCheck = {
  [K in keyof Resources['files']['errors']]: string;
} & {
  [K in keyof Resources['files']['success']]: string;
};

// This will cause a compile error if any translation keys are missing
const _translationCheck: TranslationKeyCheck = {
  loadFailed: FileTranslationKeys.errors.loadFailed,
  createTrackFailed: FileTranslationKeys.errors.createTrackFailed,
  createFolderFailed: FileTranslationKeys.errors.createFolderFailed,
  deleteFailed: FileTranslationKeys.errors.deleteFailed,
  moveFailed: FileTranslationKeys.errors.moveFailed,
  importFailed: FileTranslationKeys.errors.importFailed,
  exportFailed: FileTranslationKeys.errors.exportFailed,
  saveFailed: FileTranslationKeys.errors.saveFailed,
  renameFailed: FileTranslationKeys.errors.renameFailed,
  folderCreated: FileTranslationKeys.success.folderCreated,
  itemMoved: FileTranslationKeys.success.itemMoved,
  itemDeleted: FileTranslationKeys.success.itemDeleted
};