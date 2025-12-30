/*
useReplContext.tsx - React context for Strudel REPL functionality
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { code2hash, getPerformanceTimeSeconds, logger, silence } from '@strudel/core';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import {
  getAudioContextCurrentTime,
  webaudioOutput,
  resetGlobalEffects,
  resetLoadedSounds,
  initAudioOnFirstClick,
  resetDefaults,
} from '@strudel/webaudio';
import { setVersionDefaultsFrom } from './util';
import { StrudelMirror, defaultSettings } from '@strudel/codemirror';
import { clearHydra } from '@strudel/hydra';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { parseBoolean, settingsMap, useSettings } from '../settings';
import {
  setActivePattern,
  setLatestCode,
  createPatternID,
  userPattern,
  getViewingPatternData,
  setViewingPatternData,
  type PatternData,
} from '../user_pattern_utils';
import { superdirtOutput } from '@strudel/osc/superdirtoutput.js';
import { audioEngineTargets } from '../settings';
import { useStore } from '@nanostores/react';
import { prebake } from './prebake';
import { getRandomTune, initCode, loadModules, shareCode } from './util';
import { DEFAULT_TRACK_CODE } from '../constants/defaultCode';
import './Repl.css';
import { setInterval, clearInterval } from 'worker-timers';
import { getMetadata } from '../metadata_parser';

// Type definitions
interface ReplState {
  started?: boolean;
  isDirty?: boolean;
  error?: any;
  activeCode?: string;
  pending?: boolean;
  code?: string;
}

interface Module {
  packageName: string;
  [key: string]: any;
}

interface ReplContext {
  started?: boolean;
  pending?: boolean;
  isDirty?: boolean;
  activeCode?: string;
  handleTogglePlay: () => Promise<void>;
  handleUpdate: (patternData: Partial<PatternData> & { code: string }, reset?: boolean) => Promise<void>;
  handleShuffle: () => Promise<void>;
  handleShare: () => Promise<void>;
  handleEvaluate: () => void;
  init: () => void;
  error?: any;
  editorRef: MutableRefObject<any>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
}

let modulesLoading: Promise<Module[]> | undefined;
let presets: Promise<void> | undefined;
let drawContext: CanvasRenderingContext2D | undefined;
let clearCanvas: (() => void) | undefined;
let audioReady: Promise<void> | undefined;

if (typeof window !== 'undefined') {
  const { maxPolyphony, audioDeviceName, multiChannelOrbits } = settingsMap.get();
  audioReady = initAudioOnFirstClick({
    maxPolyphony,
    audioDeviceName,
    multiChannelOrbits: parseBoolean(multiChannelOrbits),
  });
  modulesLoading = loadModules();
  presets = prebake();
  drawContext = getDrawContext();
  clearCanvas = () => drawContext?.clearRect(0, 0, drawContext.canvas.height, drawContext.canvas.width);
}

async function getModule(name: string): Promise<Module | undefined> {
  if (!modulesLoading) {
    return;
  }
  const modules = await modulesLoading;
  return modules.find((m) => m.packageName === name);
}

const initialCode = `// LOADING`;

export function useReplContext(): ReplContext {
  const { isSyncEnabled, audioEngineTarget } = useSettings();
  const shouldUseWebaudio = audioEngineTarget !== audioEngineTargets.osc;
  const defaultOutput = shouldUseWebaudio ? webaudioOutput : superdirtOutput;
  const getTime = shouldUseWebaudio ? getAudioContextCurrentTime : getPerformanceTimeSeconds;

  const init = useCallback(() => {
    const drawTime = [-2, 2];
    const drawContext = getDrawContext();
    const editor = new StrudelMirror({
      sync: isSyncEnabled,
      defaultOutput,
      getTime,
      setInterval,
      clearInterval,
      transpiler,
      autodraw: false,
      root: containerRef.current,
      initialCode,
      pattern: silence,
      drawTime,
      drawContext,
      prebake: async () => Promise.all([modulesLoading, presets]),
      onUpdateState: (state: any) => {
        setReplState({ ...state });
      },
      onToggle: (playing: boolean) => {
        if (!playing) {
          clearHydra();
        }
      },
      beforeEval: () => audioReady,
      afterEval: (all: any) => {
        const { code } = all;
        //post to iframe parent (like Udels) if it exists...
        (window.parent as any)?.postMessage(code);

        setLatestCode(code);
        setDocumentTitle(code);
        const viewingPatternData = getViewingPatternData();
        setVersionDefaultsFrom(code);
        const data = { ...viewingPatternData, code };
        let id = data.id;
        const isExamplePattern = viewingPatternData.collection !== userPattern.collection;

        if (isExamplePattern) {
          const codeHasChanged = code !== viewingPatternData.code;
          if (codeHasChanged) {
            // fork example
            const newPattern = userPattern.duplicate(data);
            id = newPattern.id;
            setViewingPatternData(newPattern.data);
          }
        } else {
          id = userPattern.isValidID(id) ? id : createPatternID();
          setViewingPatternData(userPattern.update(id, data).data);
        }
        setActivePattern(id);
      },
      bgFill: false,
    });
    (window as any).strudelMirror = editor;

    // init settings
    initCode().then(async (decoded) => {
      let code: string;
      let msg: string;
      
      // Check if this should be a fresh welcome screen session
      const shouldShowWelcome = (() => {
        if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
        
        const savedTracks = localStorage.getItem('strudel_tracks');
        const userPatternsKey = localStorage.getItem('strudel-settingsuserPatterns');
        
        let hasTracksData = false;
        let hasUserPatternData = false;
        
        if (savedTracks) {
          try {
            const tracks = JSON.parse(savedTracks);
            hasTracksData = Object.keys(tracks).length > 0;
          } catch (e) {
            hasTracksData = false;
          }
        }
        
        if (userPatternsKey) {
          try {
            const patterns = JSON.parse(userPatternsKey);
            hasUserPatternData = patterns && Object.keys(patterns).length > 0;
          } catch (e) {
            hasUserPatternData = false;
          }
        }
        
        return !hasTracksData && !hasUserPatternData;
      })();
      
      // Read latestCode dynamically
      const currentLatestCode = typeof window !== 'undefined' && typeof localStorage !== 'undefined' 
        ? localStorage.getItem('strudel-settingslatestCode') 
        : null;
      
      if (decoded) {
        code = decoded;
        msg = `I have loaded the code from the URL.`;
      } else if (currentLatestCode && !shouldShowWelcome) {
        code = currentLatestCode;
        msg = `Your last session has been loaded!`;
      } else {
        /* const { code: randomTune, name } = await getRandomTune();
        code = randomTune; */
        code = DEFAULT_TRACK_CODE;
        msg = `Default code has been loaded`;
      }
      editor.setCode(code);
      setDocumentTitle(code);
      logger(`Welcome to Strudel! ${msg} Press play or hit ctrl+enter to run it!`, 'highlight');
    });

    editorRef.current = editor;
  }, [isSyncEnabled, defaultOutput, getTime]);

  const [replState, setReplState] = useState<ReplState>({});
  const { started, isDirty, error, activeCode, pending } = replState;
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // this can be simplified once SettingsTab has been refactored to change codemirrorSettings directly!
  // this will be the case when the main repl is being replaced
  const _settings = useStore(settingsMap, { keys: Object.keys(defaultSettings) });
  useEffect(() => {
    let editorSettings: any = {};
    Object.keys(defaultSettings).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(_settings, key)) {
        editorSettings[key] = (_settings as any)[key];
      }
    });
    console.log('[repl] updating editor settings:', editorSettings);
    editorRef.current?.updateSettings(editorSettings);
  }, [_settings]);

  //
  // UI Actions
  //

  const setDocumentTitle = (code: string) => {
    const meta = getMetadata(code);
    document.title = (meta.title ? `${meta.title} - ` : '') + 'Strudel REPL';
  };

  const handleTogglePlay = async (): Promise<void> => {
    editorRef.current?.toggle();
  };

  const resetEditor = async (): Promise<void> => {
    (await getModule('@strudel/tonal'))?.resetVoicings();
    resetDefaults();
    resetGlobalEffects();
    clearCanvas?.();
    clearHydra();
    resetLoadedSounds();
    
    // Only reset CPS if editor is initialized
    if (editorRef.current && editorRef.current.repl && editorRef.current.repl.setCps) {
      editorRef.current.repl.setCps(0.5);
    }
    
    await prebake(); // declare default samples
  };

  const handleUpdate = async (patternData: Partial<PatternData> & { code: string }, reset = false): Promise<void> => {
    const fullPatternData: PatternData = {
      id: patternData.id || '',
      code: patternData.code,
      ...patternData,
    };
    setViewingPatternData(fullPatternData);
    
    // Only set code if editor is initialized
    if (editorRef.current && editorRef.current.setCode) {
      editorRef.current.setCode(patternData.code);
    }
    
    if (reset) {
      // Only reset if editor is fully initialized
      if (editorRef.current && editorRef.current.repl) {
        await resetEditor();
        handleEvaluate();
      }
    }
  };

  const handleEvaluate = (): void => {
    if (editorRef.current && editorRef.current.evaluate) {
      editorRef.current.evaluate();
    }
  };

  const handleShuffle = async (): Promise<void> => {
    const patternData = await getRandomTune();
    if (!patternData || !patternData.id) return;
    
    const code = patternData.code;
    logger(`[repl] ✨ loading random tune "${patternData.id}"`);
    setActivePattern(patternData.id);
    setViewingPatternData(patternData);
    await resetEditor();
    
    // Only set code and evaluate if editor is initialized
    if (editorRef.current && editorRef.current.setCode) {
      editorRef.current.setCode(code);
      
      if (editorRef.current.repl && editorRef.current.repl.evaluate) {
        editorRef.current.repl.evaluate(code);
      }
    }
  };

  const handleShare = async (): Promise<void> => shareCode();

  const context: ReplContext = {
    started,
    pending,
    isDirty,
    activeCode,
    handleTogglePlay,
    handleUpdate,
    handleShuffle,
    handleShare,
    handleEvaluate,
    init,
    error,
    editorRef,
    containerRef,
  };
  return context;
}