import { persistentMap } from '@nanostores/persistent';
import { useStore } from '@nanostores/react';
import { register } from '@strudel/core';
import { isUdels } from './repl/util';
import type { Language } from './i18n';

// Type definitions for settings
export type AudioEngineTarget = 'webaudio' | 'osc';
export type SoundFilterType = 'user' | 'drums' | 'samples' | 'synths' | 'wavetables' | 'all' | 'importSounds';
export type PanelPosition = 'right' | 'bottom';
export type TogglePanelTrigger = 'click' | 'hover';
export type Keybindings = 'codemirror' | 'vim' | 'emacs' | 'vscode';
export type Theme = string; // Could be more specific if we know all theme names

// User pattern interface
export interface UserPattern {
  id: string;
  code: string;
  created_at?: string;
  // Add other pattern properties as needed
}

export interface UserPatterns {
  [key: string]: UserPattern;
}

// Settings interface
export interface Settings {
  activeFooter: string;
  keybindings: Keybindings;
  isBracketMatchingEnabled: boolean;
  isBracketClosingEnabled: boolean;
  isLineNumbersDisplayed: boolean;
  isActiveLineHighlighted: boolean;
  isAutoCompletionEnabled: boolean;
  isTooltipEnabled: boolean;
  isFlashEnabled: boolean;
  isSyncEnabled: boolean;
  isLineWrappingEnabled: boolean;
  isPatternHighlightingEnabled: boolean;
  isTabIndentationEnabled: boolean;
  isMultiCursorEnabled: boolean;
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  latestCode: string;
  isZen: boolean;
  soundsFilter: SoundFilterType;
  patternFilter: string;
  panelPosition: PanelPosition;
  isPanelPinned: boolean;
  isPanelOpen: boolean;
  togglePanelTrigger: TogglePanelTrigger;
  userPatterns: UserPatterns;
  audioEngineTarget: AudioEngineTarget;
  isButtonRowHidden: boolean;
  isCSSAnimationDisabled: boolean;
  maxPolyphony: number;
  multiChannelOrbits: boolean;
  isFileManagerOpen: boolean;
  language: Language;
}

// Raw settings interface (as stored, with string values for booleans)
export interface RawSettings {
  activeFooter: string;
  keybindings: Keybindings;
  isBracketMatchingEnabled: boolean | string;
  isBracketClosingEnabled: boolean | string;
  isLineNumbersDisplayed: boolean | string;
  isActiveLineHighlighted: boolean | string;
  isAutoCompletionEnabled: boolean | string;
  isTooltipEnabled: boolean | string;
  isFlashEnabled: boolean | string;
  isSyncEnabled: boolean | string;
  isLineWrappingEnabled: boolean | string;
  isPatternHighlightingEnabled: boolean | string;
  isTabIndentationEnabled: boolean | string;
  isMultiCursorEnabled: boolean | string;
  theme: Theme;
  fontFamily: string;
  fontSize: number | string;
  latestCode: string;
  isZen: boolean | string;
  soundsFilter: SoundFilterType;
  patternFilter: string;
  panelPosition: PanelPosition;
  isPanelPinned: boolean | string;
  isPanelOpen: boolean | string;
  togglePanelTrigger: TogglePanelTrigger;
  userPatterns: string; // JSON string
  audioEngineTarget: AudioEngineTarget;
  isButtonRowHidden: boolean | string;
  isCSSAnimationDisabled: boolean | string;
  maxPolyphony: number;
  multiChannelOrbits: boolean | string;
  isFileManagerOpen: boolean | string;
  language: Language;
}

export const audioEngineTargets = {
  webaudio: 'webaudio' as const,
  osc: 'osc' as const,
} satisfies Record<string, AudioEngineTarget>;

export const soundFilterType = {
  USER: 'user' as const,
  DRUMS: 'drums' as const,
  SAMPLES: 'samples' as const,
  SYNTHS: 'synths' as const,
  WAVETABLES: 'wavetables' as const,
  ALL: 'all' as const,
  IMPORT_SOUNDS: 'importSounds' as const,
} satisfies Record<string, SoundFilterType>;

export const defaultSettings: RawSettings = {
  activeFooter: 'intro',
  keybindings: 'codemirror',
  isBracketMatchingEnabled: true,
  isBracketClosingEnabled: true,
  isLineNumbersDisplayed: true,
  isActiveLineHighlighted: true,
  isAutoCompletionEnabled: false,
  isTooltipEnabled: false,
  isFlashEnabled: true,
  isSyncEnabled: false,
  isLineWrappingEnabled: false,
  isPatternHighlightingEnabled: true,
  isTabIndentationEnabled: false,
  isMultiCursorEnabled: false,
  theme: 'strudelTheme',
  fontFamily: 'monospace',
  fontSize: 18,
  latestCode: '',
  isZen: false,
  soundsFilter: soundFilterType.ALL,
  patternFilter: 'community',
  // panelPosition: window.innerWidth > 1000 ? 'right' : 'bottom', //FIX: does not work on astro
  panelPosition: 'right',
  isPanelPinned: false,
  isPanelOpen: true,
  togglePanelTrigger: 'click', //click | hover
  userPatterns: '{}',
  audioEngineTarget: audioEngineTargets.webaudio,
  isButtonRowHidden: false,
  isCSSAnimationDisabled: false,
  maxPolyphony: 128,
  multiChannelOrbits: false,
  isFileManagerOpen: true,
  language: 'en',
};

let search: URLSearchParams | null = null;
if (typeof window !== 'undefined') {
  search = new URLSearchParams(window.location.search);
}

// If running multiple instance in one window, it will use the settings for that instance. else default to normal
const instance = parseInt(search?.get('instance') ?? '0');
const settings_key = `strudel-settings${instance > 0 ? instance : ''}`;

export const settingsMap = persistentMap(settings_key, defaultSettings as any);

/**
 * Parses a boolean-like value to a proper boolean
 * @param booleanlike - Value that might be a boolean or string representation
 * @returns Parsed boolean value
 */
export const parseBoolean = (booleanlike: boolean | string | undefined): boolean => 
  [true, 'true'].includes(booleanlike as boolean | string) ? true : false;

/**
 * Custom hook to get processed settings with proper types
 * @returns Processed settings object with all values properly typed
 */
export function useSettings(): Settings {
  const state = useStore(settingsMap);

  const userPatterns: UserPatterns = JSON.parse(state.userPatterns);
  Object.keys(userPatterns).forEach((key) => {
    const data = userPatterns[key];
    data.id = data.id ?? key;
    userPatterns[key] = data;
  });

  return {
    ...state,
    isZen: parseBoolean(state.isZen),
    isBracketMatchingEnabled: parseBoolean(state.isBracketMatchingEnabled),
    isBracketClosingEnabled: parseBoolean(state.isBracketClosingEnabled),
    isLineNumbersDisplayed: parseBoolean(state.isLineNumbersDisplayed),
    isActiveLineHighlighted: parseBoolean(state.isActiveLineHighlighted),
    isAutoCompletionEnabled: parseBoolean(state.isAutoCompletionEnabled),
    isPatternHighlightingEnabled: parseBoolean(state.isPatternHighlightingEnabled),
    isButtonRowHidden: parseBoolean(state.isButtonRowHidden),
    isCSSAnimationDisabled: parseBoolean(state.isCSSAnimationDisabled),
    isTooltipEnabled: parseBoolean(state.isTooltipEnabled),
    isLineWrappingEnabled: parseBoolean(state.isLineWrappingEnabled),
    isFlashEnabled: parseBoolean(state.isFlashEnabled),
    isSyncEnabled: isUdels() ? true : parseBoolean(state.isSyncEnabled),
    isTabIndentationEnabled: parseBoolean(state.isTabIndentationEnabled),
    isMultiCursorEnabled: parseBoolean(state.isMultiCursorEnabled),
    fontSize: Number(state.fontSize),
    panelPosition: (state.activeFooter !== '' && !isUdels() ? state.panelPosition : 'bottom') as PanelPosition, // <-- keep this 'bottom' where it is!
    isPanelPinned: parseBoolean(state.isPanelPinned),
    isPanelOpen: parseBoolean(state.isPanelOpen),
    userPatterns: userPatterns,
    multiChannelOrbits: parseBoolean(state.multiChannelOrbits),
    isFileManagerOpen: parseBoolean(state.isFileManagerOpen),
    language: (state.language || 'en') as Language,
  };
}

// Settings update functions
export const setActiveFooter = (tab: string): void => settingsMap.setKey('activeFooter', tab);
export const setPanelPinned = (bool: boolean): void => settingsMap.setKey('isPanelPinned', bool as any);
export const setIsPanelOpened = (bool: boolean): void => settingsMap.setKey('isPanelOpen', bool as any);
export const setIsFileManagerOpen = (bool: boolean): void => settingsMap.setKey('isFileManagerOpen', bool as any);
export const setIsZen = (active: boolean): void => settingsMap.setKey('isZen', !!active as any);

/**
 * Creates a pattern setting function that registers with Strudel core
 * @param key - The setting key to register
 * @returns Pattern function
 */
const patternSetting = (key: keyof RawSettings) =>
  register(key, (value: any, pat: any) =>
    pat.onTrigger(() => {
      value = Array.isArray(value) ? value.join(' ') : value;
      if (value !== settingsMap.get()[key]) {
        settingsMap.setKey(key, value);
      }
      return pat;
    }, false),
  );

export const theme = patternSetting('theme');
export const fontFamily = patternSetting('fontFamily');
export const fontSize = patternSetting('fontSize');

export const settingPatterns = { theme, fontFamily, fontSize };