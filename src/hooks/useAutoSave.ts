import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

export const useAutoSave = () => {
  const { settings, currentProject, saveProject } = useAppStore();
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!settings.autoSave || !currentProject) {
      return;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = window.setTimeout(() => {
      saveProject();
      console.log('Auto-saved project:', currentProject.name);
    }, settings.autoSaveInterval);

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [settings.autoSave, settings.autoSaveInterval, currentProject, saveProject]);

  // Manual save function
  const manualSave = () => {
    if (currentProject) {
      saveProject();
      
      // Clear auto-save timeout since we just saved manually
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  };

  return { manualSave };
};