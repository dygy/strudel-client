// Type declarations for Strudel packages

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
  export function onTriggerSample(t: number, hapValue: HapValue, onended: () => void, bank: any): void;
  export function getAudioContext(): AudioContext;
  export function getAudioContextCurrentTime(): number;
  export function samples(url: string, baseUrl?: string, options?: any): Promise<void>;
  export function aliasBank(url: string): Promise<void>;
  export function registerSynthSounds(): Promise<void>;
  export function registerZZFXSounds(): Promise<void>;
  export function webaudioOutput(hap: Hap, deadline: any, hapDuration: number, cps: number, t: number): void;
  export function initAudioOnFirstClick(): Promise<void>;
  export function setVersionDefaults(version?: string): void;
  export function resetDefaults(): void;
  export function resetGlobalEffects(): void;
  export function resetLoadedSounds(): void;
  export function connectToDestination(node: AudioNode): void;
  export function soundMap(): any;
  export const DEFAULT_MAX_POLYPHONY: number;
  export function setMaxPolyphony(polyphony: number): void;
  export function setMultiChannelOrbits(enabled: boolean): void;
  export function getAudioDevices(): Promise<MediaDeviceInfo[]>;
  // Add other exports as needed
}

declare module '@strudel/core' {
  export function logger(message: string, type?: string): void;
  export function evalScope(...modules: any[]): any;
  export function hash2code(hash: string): string;
  export function noteToMidi(note: string): number;
  export function register(name: string, fn: Function): void;
  export class Pattern {
    // Add Pattern methods as needed
  }
  // Add other exports as needed
}

declare module '@strudel/osc/superdirtoutput.js' {
  export function superdirtOutput(hap: any, deadline: any, hapDuration: number, cps: number, t: number): void;
}

declare module '@strudel/draw' {
  export function getDrawContext(): any;
  export function colorMap(): any;
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