// Type declarations for Strudel packages

// Global Window interface extensions
declare global {
  interface Window {
    __TAURI__?: any;
  }
}

// Common types used across Strudel
interface HapValue {
  [key: string]: any;
}

interface Hap {
  value: HapValue;
  whole?: { begin: { valueOf(): number } };
  duration: { valueOf(): number };
}

type TriggerFunction = (t: number, hapValue: HapValue, onended: () => void, ...args: any[]) => void;

declare module '@strudel/webaudio' {
  export function registerSound(key: string, onTrigger: TriggerFunction, data?: any): void;
  export function onTriggerSample(t: number, hapValue: HapValue, onended: () => void, bank: any, resolveUrl?: (url: string) => Promise<string> | string): void;
  export function getAudioContext(): AudioContext;
  export function getAudioContextCurrentTime(): number;
  export function samples(sampleMap: string | Record<string, string[]>, baseUrl?: string, options?: any): Promise<void>;
  export function aliasBank(url: string): Promise<void>;
  export function registerSynthSounds(): Promise<void>;
  export function registerZZFXSounds(): Promise<void>;
  export function webaudioOutput(hap: Hap, deadline: any, hapDuration: number, cps: number, t: number): void;
  export function initAudioOnFirstClick(options?: any): Promise<void>;
  export function setVersionDefaults(version?: string): void;
  export function resetDefaults(): void;
  export function resetGlobalEffects(): void;
  export function resetLoadedSounds(): void;
  export function connectToDestination(node: AudioNode): void;
  export const soundMap: {
    get(): Record<string, any>;
    set(value: Record<string, any>): void;
    subscribe(callback: (value: Record<string, any>) => void): () => void;
  };
  export const DEFAULT_MAX_POLYPHONY: number;
  export function setMaxPolyphony(polyphony: number): void;
  export function setMultiChannelOrbits(enabled: boolean): void;
  export function getAudioDevices(): Promise<Map<string, string>>;
  export function registerSamplesPrefix(prefix: string, resolve: (path: string) => Promise<void> | void): void;
  export function processSampleMap(sampleMap: any, fn: (key: string, bank: any) => void, baseUrl?: string): void;
  export function loadBuffer(url: string, audioContext: AudioContext, s?: string, n?: number): Promise<AudioBuffer>;
  
  // Sample Cache Functions
  export function configureSampleCache(config: any): void;
  export function getCacheConfig(): any;
  export function getCacheStats(): any;
  export function addCacheListener(callback: (event: any) => void): void;
  export function removeCacheListener(callback: (event: any) => void): void;
  export function clearCache(): void;
  export function preloadTrackSamples(code: string, trackName?: string): Promise<void>;

  // Superdough audio engine
  export function superdough(
    value: any,
    t: number,
    hapDuration: number,
    cps?: number,
    cycle?: number,
    _controller?: any,
  ): Promise<any>;

  export class SuperdoughAudioController {
    constructor(audioContext: AudioContext);
    output: {
      destinationGain: GainNode;
      [key: string]: any;
    };
    [key: string]: any;
  }

  export function getSuperdoughAudioController(): SuperdoughAudioController;
  
  // Add other exports as needed
}

declare module '@strudel/core' {
  export function logger(message: string, type?: string, data?: any): void;
  export namespace logger {
    export const key: string;
  }
  export function evalScope(...modules: any[]): any;
  export function hash2code(hash: string): string;
  export function code2hash(code: string): string;
  export function noteToMidi(note: string): number;
  export function valueToMidi(value: any, fallbackValue?: number): number;
  export function midi2note(n: number): string;
  export function _mod(n: number, m: number): number;
  export function register(name: string, fn: Function): void;
  export function getPerformanceTimeSeconds(): number;
  export const silence: Pattern;
  export class Pattern {
    set: any;
    // Add Pattern methods as needed
  }
  export function repl(options: {
    defaultOutput?: Function;
    onEvalError?: Function;
    beforeEval?: Function;
    beforeStart?: Function;
    afterEval?: Function;
    getTime?: () => number;
    transpiler?: Function;
    onToggle?: (started: boolean) => void;
    editPattern?: Function;
    onUpdateState?: Function;
    sync?: boolean;
    setInterval?: Function;
    clearInterval?: Function;
    id?: string;
    mondo?: boolean;
  }): {
    scheduler: any;
    evaluate: (code: string, autostart?: boolean, shouldHush?: boolean) => Promise<any>;
    start: () => void;
    stop: () => void;
    pause: () => void;
    setCps: (cps: number) => any;
    setPattern: (pattern: any, autostart?: boolean) => Promise<any>;
    setCode: (code: string) => void;
    toggle: () => void;
    state: any;
  };
  // Add other exports as needed
}

declare module '@strudel/osc/superdirtoutput.js' {
  export function superdirtOutput(hap: any, deadline: any, hapDuration: number, cps: number, t: number): void;
}

declare module '@strudel/draw' {
  export function getDrawContext(): any;
  export function colorMap(): any;
  export function getPunchcardPainter(options?: any): (ctx: any, time: number, haps: any[], drawTime: any) => void;
  // Add other exports as needed
}

declare module '@strudel/transpiler' {
  export function transpiler(code: string): any;
  // Add other exports as needed
}

declare module '@strudel/codemirror' {
  export class StrudelMirror {
    constructor(options: any);
    setCode(code: string): void;
    evaluate(): void;
    toggle(): void;
    updateSettings(settings: any): void;
    code: string;
    repl: any;
  }
  export const defaultSettings: any;
  export const themes: any;
  export function formatCode(code: string): Promise<string>;
  
  // Prettier extension exports
  export interface FormatResult {
    success: boolean;
    formattedCode?: string;
    error?: string;
  }
  
  export interface PrettierSettings {
    isPrettierEnabled?: boolean;
    prettierAutoFormatOnSave?: boolean;
    prettierTabWidth?: number;
    prettierUseTabs?: boolean;
    prettierSemi?: boolean;
    prettierSingleQuote?: boolean;
    prettierQuoteProps?: 'as-needed' | 'consistent' | 'preserve';
    prettierTrailingComma?: 'none' | 'es5' | 'all';
    prettierBracketSpacing?: boolean;
    prettierArrowParens?: 'avoid' | 'always';
    prettierPrintWidth?: number;
  }
  
  export function autoFormatOnSave(code: string, settings: PrettierSettings): Promise<FormatResult>;
  export function prettierExtension(): any;
  
  // Add other exports as needed
}

// Add declarations for other Strudel packages as needed
declare module '@strudel/tonal' {
  // Add exports as needed
}

declare module '@strudel/mini' {
  // Add exports as needed
}

declare module '@strudel/hydra' {
  export function clearHydra(): void;
  // Add other exports as needed
}

declare module '@strudel/soundfonts' {
  export function registerSoundfonts(): Promise<void>;
  // Add other exports as needed
}

declare module '@strudel/mixer' {
  export class PreviewEngine {
    constructor(audioContext: AudioContext, deps: {
      superdough: Function;
      repl: Function;
      getTime: () => number;
      SuperdoughAudioController: new (ctx: AudioContext) => any;
      transpiler?: Function;
    });

    audioContext: AudioContext;
    controller: any | null;
    replInstance: any | null;
    audioElement: HTMLAudioElement | null;
    mediaStreamDest: MediaStreamAudioDestinationNode | null;
    isInitialized: boolean;
    isPlaying: boolean;
    deviceId: string | null;

    initialize(): Promise<void>;
    ensurePlaying(): Promise<void>;
    setDevice(deviceId: string | null): Promise<void>;
    evaluate(code: string): Promise<any>;
    stop(): void;
    destroy(): void;
  }

  export class AudioMixer {
    constructor(audioContext: AudioContext, options?: any);
    [key: string]: any;
  }
  export class AudioStream {
    constructor(name: string, audioContext: AudioContext);
    [key: string]: any;
  }
  export class TransitionMixer {
    constructor(audioContext: AudioContext, liveStream: any, previewStream: any);
    [key: string]: any;
  }
  export class ErrorNotifier {
    constructor();
    [key: string]: any;
  }
  export class KeyboardShortcutManager {
    constructor();
    [key: string]: any;
  }
}