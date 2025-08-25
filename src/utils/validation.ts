import type { Project, UserSettings } from '../types/index';

export const validateProjectName = (name: string): string | null => {
  if (!name.trim()) {
    return 'Project name is required';
  }
  if (name.length < 2) {
    return 'Project name must be at least 2 characters';
  }
  if (name.length > 50) {
    return 'Project name must be less than 50 characters';
  }
  return null;
};

export const validateProject = (project: Partial<Project>): string[] => {
  const errors: string[] = [];

  if (!project.name) {
    errors.push('Project name is required');
  } else {
    const nameError = validateProjectName(project.name);
    if (nameError) {
      errors.push(nameError);
    }
  }

  if (project.bpm !== undefined && (project.bpm < 60 || project.bpm > 200)) {
    errors.push('BPM must be between 60 and 200');
  }

  if (project.volume !== undefined && (project.volume < 0 || project.volume > 1)) {
    errors.push('Volume must be between 0 and 1');
  }

  return errors;
};

export const validateSettings = (settings: Partial<UserSettings>): string[] => {
  const errors: string[] = [];

  if (settings.defaultBpm !== undefined && (settings.defaultBpm < 60 || settings.defaultBpm > 200)) {
    errors.push('Default BPM must be between 60 and 200');
  }

  if (settings.defaultVolume !== undefined && (settings.defaultVolume < 0 || settings.defaultVolume > 1)) {
    errors.push('Default volume must be between 0 and 1');
  }

  if (settings.editorFontSize !== undefined && (settings.editorFontSize < 8 || settings.editorFontSize > 32)) {
    errors.push('Editor font size must be between 8 and 32');
  }

  if (settings.autoSaveInterval !== undefined && settings.autoSaveInterval < 5000) {
    errors.push('Auto-save interval must be at least 5 seconds');
  }

  return errors;
};