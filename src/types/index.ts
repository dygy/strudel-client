// Core application types

export type Theme = 'light' | 'dark';

export interface CanvasSettings {
  width: number;
  height: number;
  backgroundColor: string;
  fullscreen: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  audioCode: string;
  visualCode: string;
  bpm: number;
  volume: number;
  canvasSettings: CanvasSettings;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface StrudelPattern {
  id: string;
  name: string;
  code: string;
  active: boolean;
  muted: boolean;
  volume: number;
  pan: number;
  effects: AudioEffect[];
}

export interface AudioEffect {
  type: 'reverb' | 'delay' | 'filter' | 'distortion';
  params: Record<string, number>;
  active: boolean;
}

export interface HydraPattern {
  id: string;
  name: string;
  code: string;
  active: boolean;
  opacity: number;
  blendMode: string;
}

export interface UserSettings {
  defaultBpm: number;
  defaultVolume: number;
  editorFontSize: number;
  keyBindings: 'default' | 'vim' | 'emacs';
  autoSave: boolean;
  autoSaveInterval: number;
}

export interface AppError {
  type: 'audio' | 'visual' | 'editor' | 'storage' | 'network';
  message: string;
  code?: string;
  stack?: string;
  timestamp: Date;
}

// Re-export visualization types
export type {
  NoteEvent,
  AudioAnalysisData,
  PatternEvent,
  PatternData,
  VisualizationData,
  PianorollOptions,
  ScopeOptions,
  SpectrumOptions,
  WaveformOptions,
  PatternGridOptions,
  VisualizationSettings,
  VisualizationType,
  VisualizationConfig
} from './visualizations';