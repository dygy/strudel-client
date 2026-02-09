/*
useReplContext.tsx - React context for Strudel REPL functionality
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/App.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { getPerformanceTimeSeconds, logger, silence, repl as createRepl } from '@strudel/core';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import {
  getAudioContextCurrentTime,
  webaudioOutput,
  resetGlobalEffects,
  resetLoadedSounds,
  initAudioOnFirstClick,
  resetDefaults,
  getAudioContext,
  superdough,
  SuperdoughAudioController,
} from '@strudel/webaudio';
import { PreviewEngine } from '@strudel/mixer';
import { setVersionDefaultsFrom } from './util';
import { StrudelMirror, defaultSettings } from '@strudel/codemirror';
import { clearHydra } from '@strudel/hydra';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { parseBoolean, settingsMap, useSettings } from '../settings';
import {
  setActivePattern,
  getActivePattern,
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
import './Repl.css';
import { setInterval, clearInterval } from 'worker-timers';
import { getMetadata } from '../metadata_parser';
import { TrackRouter } from '../routing';
import { setEditorInstance, setPendingCode, getPendingCode, clearPendingCode, setActiveCode, getEditorInstance } from '../stores/editorStore';

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
  readOnly?: boolean;
  handleTogglePlay: () => Promise<void>;
  handleUpdate: (patternData: Partial<PatternData> & { code: string }, reset?: boolean) => Promise<void>;
  handleShuffle: () => Promise<void>;
  handleShare: () => Promise<void>;
  handleEvaluate: () => void;
  init: () => void;
  error?: any;
  editorRef: MutableRefObject<any>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  trackRouter?: TrackRouter;
  authInfo?: {
    isAuthenticated: boolean;
    fileManagerHook?: any;
  };
  mixer?: any;
  isPreviewing?: boolean;
  handlePreviewToggle?: () => Promise<void>;
  previewEngine?: PreviewEngine | null;
}

let modulesLoading: Promise<Module[]> | undefined;
let presets: Promise<void> | undefined;
let drawContext: CanvasRenderingContext2D | undefined;
let clearCanvas: (() => void) | undefined;
let audioReady: Promise<void> | undefined;

// Canvas cleanup utility
const cleanupCanvasElements = async () => {
  if (typeof window === 'undefined') return;
  
  try {
    console.log('[canvas-cleanup] Starting comprehensive canvas cleanup');
    
    // 1. Cancel global animation frame (from animate.mjs)
    if ((window as any).frame) {
      cancelAnimationFrame((window as any).frame);
      (window as any).frame = null;
      console.log('[canvas-cleanup] Cancelled global window.frame');
    }
    
    // 2. Use the proper cleanupDraw function from @strudel/draw
    try {
      const drawModule = await import('@strudel/draw');
      // @ts-ignore - TypeScript doesn't recognize cleanupDraw but it exists
      if (drawModule.cleanupDraw) {
        // @ts-ignore
        drawModule.cleanupDraw(true); // clearScreen = true, no specific id = cleanup all
        console.log('[canvas-cleanup] Used cleanupDraw to stop animations and clear canvas');
      }
    } catch (error) {
      console.warn('[canvas-cleanup] Could not use cleanupDraw:', error);
    }
    
    // 3. Clear Hydra properly (this already works well)
    try {
      clearHydra();
      console.log('[canvas-cleanup] Cleared Hydra canvases');
    } catch (error) {
      console.warn('[canvas-cleanup] Error clearing hydra:', error);
    }
    
    // 4. Clear the main draw context if it exists
    if (clearCanvas) {
      clearCanvas();
      console.log('[canvas-cleanup] Cleared main draw context');
    }
    
    // 5. Only remove duplicate or orphaned test-canvas elements, not the main one
    const testCanvases = document.querySelectorAll('canvas[id="test-canvas"]');
    if (testCanvases.length > 1) {
      // Keep the first one, remove duplicates
      for (let i = 1; i < testCanvases.length; i++) {
        console.log(`[canvas-cleanup] Removing duplicate test-canvas #${i}`);
        testCanvases[i].remove();
      }
    }
    
    // 6. Remove any orphaned graphics canvases that don't have proper cleanup
    const orphanedSelectors = [
      'canvas[id*="graphics"]:not(#test-canvas):not(#hydra-canvas)',
      'canvas[id*="visual"]:not(#test-canvas):not(#hydra-canvas)',
      'canvas[style*="position:fixed"]:not(#test-canvas):not(#hydra-canvas)'
    ];
    
    let cleanedCount = 0;
    orphanedSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        console.log(`[canvas-cleanup] Removing orphaned canvas: ${element.id || element.className}`);
        element.remove();
        cleanedCount++;
      });
    });
    
    if (cleanedCount > 0) {
      console.log(`[canvas-cleanup] Removed ${cleanedCount} orphaned canvas elements`);
    }
    
    console.log('[canvas-cleanup] Comprehensive canvas cleanup completed');
    
  } catch (error) {
    console.error('[canvas-cleanup] Error during canvas cleanup:', error);
  }
};

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

const initialCode = ``;

interface UseReplContextOptions {
  readOnly?: boolean;
}

export function useReplContext(options: UseReplContextOptions = {}): ReplContext {
  const { readOnly = false } = options;
  const { isSyncEnabled, audioEngineTarget } = useSettings();
  const shouldUseWebaudio = audioEngineTarget !== audioEngineTargets.osc;
  const defaultOutput = shouldUseWebaudio ? webaudioOutput : superdirtOutput;
  const getTime = shouldUseWebaudio ? getAudioContextCurrentTime : getPerformanceTimeSeconds;

  const init = useCallback(() => {

    if (!containerRef.current) {
      console.error('[repl] init called but containerRef.current is null!');
      return;
    }

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
      readOnly,
      prebake: async () => Promise.all([modulesLoading, presets]),
      onUpdateState: (state: any) => {
        setReplState({ ...state });
      },
      onToggle: (playing: boolean) => {
        console.log('[canvas-cleanup] onToggle called, playing:', playing);
        if (!playing) {
          console.log('[canvas-cleanup] Pattern stopped, cleaning up canvas elements and resetting CPS');
          
          // Reset CPS to default to prevent BPM from carrying over between tracks
          if (editor?.repl?.setCps) {
            editor.repl.setCps(0.5);
            console.log('[canvas-cleanup] Reset CPS to default 0.5');
          }
          
          clearHydra();
          
          // Clean up canvas elements when stopping
          cleanupCanvasElements().catch(error => {
            console.warn('[canvas-cleanup] Error during cleanup:', error);
          });
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
        // NOTE: Don't set activePattern here - it should only be set by navigation actions
        // setActivePattern(id); // REMOVED: This was overwriting URL-based activePattern
      },
      bgFill: false,
    });

    console.log('[repl] StrudelMirror created:', !!editor, 'root element:', !!containerRef.current);
    setEditorInstance(editor);

    // Store editor in editorRef for component access
    editorRef.current = editor;
    console.log('[repl] Editor stored in refs and nano store');

    // DEBUG: Add global function to test CodeMirror
    if (typeof window !== 'undefined') {
      (window as any).testCodeMirror = (testCode = 'console.log("test from nano store")') => {
        console.log('Testing CodeMirror with code:', testCode);
        if (editor && editor.setCode) {
          editor.setCode(testCode);
          setActiveCode(testCode);
          console.log('CodeMirror setCode called successfully');
        } else {
          console.error('CodeMirror editor or setCode method not available');
        }
      };
    }

    // init settings
    initCode().then(async (decoded) => {
      let code: string;
      let msg: string;

      // Check if there's an active pattern and corresponding track
      const currentActivePattern = getActivePattern();

      console.log('[repl] Debug - currentActivePattern:', currentActivePattern);
      console.log('[repl] Debug - Authentication required - no localStorage access');

      // Authentication is required - all track loading is handled by Supabase FileManager
      // No localStorage fallback - users must be authenticated

      if (decoded) {
        code = decoded;
        msg = `I have loaded the code from the URL.`;
      } else {
        // Check for pending code first
        const pendingCode = getPendingCode();
        if (pendingCode) {
          code = pendingCode;
          msg = `I have loaded the code from pending track.`;
          console.log('[repl] Using pending code for initialization:', code.substring(0, 50) + '...');
          clearPendingCode(); // Clear it
        } else {
          // Don't set default code - wait for tracks to load
          console.log('[repl] No code to load yet, waiting for tracks...');
          return; // Exit early, don't set any code
        }
      }
      editor.setCode(code);
      setDocumentTitle(code);
      logger(`Welcome to Strudel! ${msg} Press play or hit ctrl+enter to run it! New shortcuts: Ctrl+U (update), Ctrl+P (play/pause)`, 'highlight');
    });

    editorRef.current = editor;
  }, [isSyncEnabled, defaultOutput, getTime, readOnly]);

  const [replState, setReplState] = useState<ReplState>({});
  const { started, isDirty, error, activeCode, pending } = replState;
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mixerRef = useRef<PreviewEngine | null>(null);
  const [mixer, setMixer] = useState<PreviewEngine | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Initialize PreviewEngine — creates an independent audio chain
  // (its own SuperdoughAudioController + repl) for preview on headphones.
  // The live audio chain (main StrudelMirror repl) is untouched.
  useEffect(() => {
    const initPreview = async () => {
      try {
        const audioContext = getAudioContext();
        if (!audioContext) {
          console.warn('AudioContext not available, preview engine skipped');
          return;
        }

        const engine = new PreviewEngine(audioContext, {
          superdough,
          repl: createRepl,
          getTime: () => audioContext.currentTime,
          SuperdoughAudioController,
          transpiler,
        });

        await engine.initialize();

        // Restore saved preview device from localStorage
        try {
          const stored = localStorage.getItem('strudel-preview-device');
          if (stored) {
            await engine.setDevice(stored);
          }
        } catch (e) { /* non-fatal */ }

        mixerRef.current = engine;
        setMixer(engine);
        console.log('[PreviewEngine] ready — independent audio chain for headphones');
      } catch (err) {
        console.error('Failed to initialize PreviewEngine:', err);
      }
    };

    initPreview();

    return () => {
      if (mixerRef.current) {
        mixerRef.current.destroy();
        mixerRef.current = null;
        setMixer(null);
      }
    };
  }, []);

  // Initialize TrackRouter
  const trackRouterRef = useRef<TrackRouter | null>(null);

  // Initialize TrackRouter on first render
  useEffect(() => {
    if (!trackRouterRef.current) {
      trackRouterRef.current = new TrackRouter({
        onTrackChange: (trackId, previousTrackId) => {
          // Update activePattern to trigger FileManager synchronization
          if (trackId) {
            setActivePattern(trackId);
          }
        },
        onNavigationStart: (trackId) => {
        },
        onNavigationComplete: (trackId) => {
        },
        onNavigationError: (error, trackId) => {
          console.error('TrackRouter - navigation error:', error, trackId);
        },
      });

      // Initialize the router
      trackRouterRef.current.initialize().catch(error => {
        console.error('TrackRouter - initialization failed:', error);
      });
    }

    return () => {
      if (trackRouterRef.current) {
        trackRouterRef.current.destroy();
        trackRouterRef.current = null;
      }
    };
  }, []);

  // this can be simplified once SettingsTab has been refactored to change codemirrorSettings directly!
  // this will be the case when the main repl is being replaced
  const _settings = useStore(settingsMap, { keys: Object.keys(defaultSettings) });
  const allSettings = useSettings(); // Get all settings including Prettier settings

  useEffect(() => {
    let editorSettings: any = {};
    Object.keys(defaultSettings).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(_settings, key)) {
        editorSettings[key] = (_settings as any)[key];
      }
    });
    editorRef.current?.updateSettings(editorSettings);

    // Make all settings available globally for Prettier
    if (typeof window !== 'undefined') {
      (window as any).strudelSettings = allSettings;
    }
  }, [_settings, allSettings]);

  // Canvas cleanup on component unmount and window unload
  useEffect(() => {
    const handleBeforeUnload = async () => {
      console.log('[canvas-cleanup] Cleaning up on page unload');
      await cleanupCanvasElements();
    };

    // Add event listener for page unload
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function for component unmount
    return () => {
      console.log('[canvas-cleanup] Cleaning up on component unmount');
      cleanupCanvasElements(); // Don't await in cleanup function
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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
    
    // Use proper draw cleanup instead of just clearing canvas
    try {
      const drawModule = await import('@strudel/draw');
      // @ts-ignore - TypeScript doesn't recognize cleanupDraw but it exists
      if (drawModule.cleanupDraw) {
        // @ts-ignore
        drawModule.cleanupDraw(true); // Clear screen and stop all animations
        console.log('[resetEditor] Used cleanupDraw to stop animations and clear canvas');
      } else if (clearCanvas) {
        clearCanvas(); // Fallback to basic clear
      }
    } catch (error) {
      console.warn('[resetEditor] Could not cleanup draw properly:', error);
      if (clearCanvas) {
        clearCanvas(); // Fallback
      }
    }
    
    clearHydra();
    
    // Clean up any accumulated canvas elements (now uses proper cleanup)
    await cleanupCanvasElements();
    
    resetLoadedSounds();

    // Only reset CPS if editor is initialized
    if (editorRef.current && editorRef.current.repl && editorRef.current.repl.setCps) {
      editorRef.current.repl.setCps(0.5);
    }

    await prebake(); // declare default samples
  };

  const handleUpdate = useCallback(async (patternData: Partial<PatternData> & { code: string }, reset = false): Promise<void> => {
    const fullPatternData: PatternData = {
      id: patternData.id || '',
      code: patternData.code,
      ...patternData,
    };
    setViewingPatternData(fullPatternData);

    console.log('[repl] handleUpdate called with code:', patternData.code.substring(0, 50) + '...');

    // Store code in nano store as backup
    setPendingCode(patternData.code);
    setActiveCode(patternData.code);

    // CRITICAL: Only update CodeMirror if the code is actually different
    // This prevents unnecessary re-renders and editor destruction
    const currentEditorCode = editorRef.current?.code || '';
    if (currentEditorCode !== patternData.code) {
      console.log('[repl] Setting code in editor via setCode');

      // Method 1: Standard setCode
      if (editorRef.current?.setCode) {
        editorRef.current.setCode(patternData.code);
      }

      // Method 2: Use stored editor instance as backup
      const storedEditor = getEditorInstance();
      if (storedEditor?.setCode) {
        console.log('[repl] Setting code via stored editor instance');
        storedEditor.setCode(patternData.code);
      }
    } else {
      console.log('[repl] Skipping setCode, code is the same');
    }

    if (reset) {
      // Clean up canvas elements before resetting
      await cleanupCanvasElements();
      
      if (editorRef.current?.repl) {
        await resetEditor();
        await handleEvaluate();
      }
    }
  }, []);

  const handleEvaluate = async (): Promise<void> => {
    // Clean up any existing canvas elements before evaluating new pattern
    await cleanupCanvasElements();
    
    // If previewing, "Update" means: stop preview, push code to live speakers
    if (isPreviewing && mixerRef.current) {
      mixerRef.current.stop();
      setIsPreviewing(false);
      console.log('[Preview] Stopped preview, pushing code to live');
    }

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
    
    // Clean up canvas elements before loading new pattern
    await cleanupCanvasElements();
    
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

  // Preview toggle: "Play Preview" evaluates current editor code on an
  // independent audio engine routed to headphones. The live pattern on
  // speakers keeps playing untouched. "Stop Preview" stops the preview engine.
  // "Update" stops preview and evaluates the code on the main (live) repl.
  const handlePreviewToggle = async (): Promise<void> => {
    const engine = mixerRef.current;
    if (!engine || !engine.isInitialized) {
      console.warn('[Preview] PreviewEngine not initialized');
      return;
    }

    try {
      if (!isPreviewing) {
        // Play Preview: evaluate current editor code on the preview engine (headphones)
        // The main repl (speakers) keeps playing whatever it was playing
        const code = editorRef.current?.code;
        if (!code) {
          console.warn('[Preview] No code to preview');
          return;
        }
        await engine.evaluate(code);
        setIsPreviewing(true);
        console.log('[Preview] Started — code playing on headphones, live untouched on speakers');
      } else {
        // Stop Preview: stop the preview engine, live continues
        engine.stop();
        setIsPreviewing(false);
        console.log('[Preview] Stopped — headphones silent, speakers continue');
      }
    } catch (err) {
      console.error('[Preview] Failed to toggle:', err);
    }
  };

  // Global keyboard shortcuts - placed after function declarations
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if we're in an input field or textarea to avoid interfering with typing
      const target = event.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';
      
      // Only handle shortcuts when Ctrl (or Cmd on Mac) is pressed
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      
      if (!isCtrlOrCmd) return;

      switch (event.key.toLowerCase()) {
        case 'u':
          // Ctrl+U for update/evaluate
          event.preventDefault();
          handleEvaluate();
          break;
        case 'p':
          // Ctrl+P for play/pause
          event.preventDefault();
          handleTogglePlay();
          break;
        default:
          // Don't prevent default for other shortcuts
          break;
      }
    };

    // Add the event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleEvaluate, handleTogglePlay]); // Dependencies for the handlers

  const context: ReplContext = {
    started,
    pending,
    isDirty,
    activeCode,
    readOnly,
    handleTogglePlay,
    handleUpdate,
    handleShuffle,
    handleShare,
    handleEvaluate,
    init,
    error,
    editorRef,
    containerRef,
    trackRouter: trackRouterRef.current,
    mixer: mixer, // PreviewEngine instance for Header button visibility
    isPreviewing,
    handlePreviewToggle,
    previewEngine: mixer,
  };
  
  return context;
}
