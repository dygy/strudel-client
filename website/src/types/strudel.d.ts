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
  export function onTriggerSample(
    t: number,
    hapValue: HapValue,
    onended: () => void,
    bank: any,
    resolveUrl?: (url: string) => Promise<string> | string,
  ): void;
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
    /**
     * Fork addition (spec 008): play the main output into `node` instead of the destination.
     * Spec 020: click-free swap; returns seconds until the previous target is silent.
     */
    setOutputInsert(node: AudioNode | null, options?: { onChannelCount?: (channelCount: number) => void }): number;
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
    applyFormatted?: (code: string) => void;
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
  export function cleanupDraw(clearScreen?: boolean, id?: string): void;
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
    applyFormatted?(code: string): void;
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
    constructor(
      audioContext: AudioContext,
      deps: {
        superdough: Function;
        repl: Function;
        getTime: () => number;
        SuperdoughAudioController: new (ctx: AudioContext) => any;
        transpiler?: Function;
      },
    );

    audioContext: AudioContext;
    controller: any | null;
    replInstance: any | null;
    audioElement: HTMLAudioElement | null;
    mediaStreamDest: MediaStreamAudioDestinationNode | null;
    isInitialized: boolean;
    isPlaying: boolean;
    deviceId: string | null;
    /** The headphone deck's scratch node (spec 019): null until ensureScratchDeck() creates it. */
    scratchDeck: ScratchDeck | null;
    /** Spec 023: the headphone track's scratch offset (its repl's editPattern); reset on stop. */
    scratchOffset: PatternOffset;
    scratchHandOver: ScratchHandOver | null;
    /**
     * Creates and attaches the headphone scratch deck (spec 019) once the preview plays.
     * Idempotent; a failed attach is retried; null when not initialized, failed, or destroyed.
     */
    ensureScratchDeck(): Promise<ScratchDeck | null>;

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

  /** Settings for one track switch (spec 017); see packages/mixer/TrackTransitionController.mjs. */
  export interface TrackTransitionSettings {
    type?: string;
    length?: number;
    snap?: number;
    glide?: boolean;
    matchLoudness?: boolean;
  }

  export class TrackTransitionController {
    constructor(options: {
      repl: any;
      audioContext?: AudioContext;
      destinationGain?: GainNode;
      getSettings?: () => TrackTransitionSettings;
      cleanupCanvases?: () => void;
      eventTarget?: EventTarget;
      targetVolume?: number;
    });
    repl: any;
    readonly busy: boolean;
    editPattern(pattern: any): any;
    switchTo(
      code: string,
      settings?: TrackTransitionSettings,
      options?: { prepare?: () => Promise<void> },
    ): Promise<Record<string, unknown>>;
    setOutput(output: { audioContext?: AudioContext; destinationGain?: GainNode }): boolean;
    stopped(): void;
    getState(): { phase: string; type?: string; T?: number; end?: number; origin: number; queued: boolean };
    destroy(): void;
  }

  export const TRANSITION_TYPES: readonly string[];
  export const TRANSITION_LENGTHS: readonly number[];
  export const TRANSITION_SNAPS: readonly number[];

  // Vinyl scratch control (spec 019); see packages/mixer/scratch/*.
  /** Which deck a scratch acts on: the speakers (main) or the headphone preview. */
  export type ScratchDeckName = 'main' | 'preview';
  /** Who holds the record: the deck lets go only when no source holds it. No argument = 'default'. */
  export type ScratchSource = 'pointer' | 'key' | 'wheel' | 'midi' | 'default';

  /** One deck's scratch node, inserted before the deck's destinationGain (pre-gain slot). */
  export class ScratchDeck {
    constructor(audioContext: BaseAudioContext, superdoughController: unknown);
    readonly isAttached: boolean;
    readonly isGrabbed: boolean;
    /**
     * Loads the worklet and inserts the node. Never rejects: false when the controller has no
     * pre-gain slot, the worklet failed, or the deck was destroyed meanwhile.
     */
    attach(): Promise<boolean>;
    /** Returns whether the deck is now held (false when not attached). */
    grab(): boolean;
    /** Moves the held record by `seconds` of audio (negative: backwards). */
    moveBy(seconds: number): void;
    /** Keeps the held record turning at `rate` (±1 keyboard, 0 still; clamped to ±8). */
    setMotor(rate: number): void;
    /** Lets go: the motor spins up and the lag lands on the beat (snap) or stays. Idempotent. */
    release(): void;
    destroy(): void;
    /** Spec 023: snap the lag to the nearest beat on release (default true). */
    snap: boolean;
    /** Spec 023: 'live' | 'held' | 'releasing' (spinning up) | 'settled' (lag reported). */
    readonly phase: 'live' | 'held' | 'releasing' | 'settled';
    readonly releaseId: number;
    /** Spec 023: where the deck reads its tempo (cps) at a release, for snap to beat. */
    setTempoSource(fn: (() => number | undefined) | null): void;
    /** Spec 023: the released record settled `lagSeconds` behind live. */
    onLagSettled(listener: (event: { id: number; lagSeconds: number }) => void): () => void;
    /** Spec 023: the pattern is shifted; crossfade to live at `atSeconds` (context time); the shifted input starts at `shiftSeconds`. */
    handOver(id: number, atSeconds: number, shiftSeconds?: number): void;
    /** Spec 023: back to live now, dropping a release in progress (a held deck stays held). */
    abort(): void;
    /** Spec 023: cancel a release whose lag hasn't been reported yet; true when one was cancelled. */
    cancelPending(): boolean;
    /** Spec 023 review 4: apply a spinning-up release's planned lag now (Update); true when kept. */
    commitPending(): boolean;
    /** Spec 023 review: whether release `id`'s hand-over may still be sent. */
    canHandOver(id: number): boolean;
    /** Spec 023 review 2: the release's plan, once per release. */
    onPlan(
      listener: (plan: {
        id: number;
        targetSeconds: number;
        upSeconds: number;
        fromRate: number;
        bumpSeconds: number;
        bumpDepth: number;
      }) => void,
    ): () => void;
    readonly plan: Record<string, number> | null;
    /** Test hook: the worklet's mix (0 live … 1 scratch), grab state, position and lag (s), phase, rate. */
    getDebugState(): Promise<{
      mix: number;
      grabbed: boolean;
      pos: number;
      phase?: string;
      lag?: number;
      rate?: number;
    } | null>;
    on(event: 'change', listener: (deck: ScratchDeck) => void): () => void;
  }

  /** Spec 023: a deck's persistent scratch offset in cycles, applied in its repl's editPattern. */
  export class PatternOffset {
    constructor(options?: { getRepl?: () => any; isBusy?: () => boolean });
    cycles: number;
    raw: any;
    /** The repl's hook: runs `inner` (the spec 017 transition hook) and shifts the result late. */
    editPattern(pattern: any, inner?: (pattern: any) => any): any;
    /** Adds `cycles` and re-sets the pattern; false while busy, stopped or without a pattern. */
    shift(cycles: number, options?: { onFirstQuery?: (cycle: number) => void }): boolean;
    reset(): void;
  }

  /** Spec 023: shifts a deck's pattern, releases its stale voices and hands the record over to live. */
  export class ScratchHandOver {
    constructor(
      deck: ScratchDeck,
      options: {
        getRepl: () => any;
        offset: PatternOffset;
        voices?: { getActiveSoundIds: () => unknown[]; releaseSounds: (...args: any[]) => unknown };
        isBlocked?: () => boolean;
        getAudioContext?: () => BaseAudioContext | undefined;
      },
    );
    onLagSettled(event: { id: number; lagSeconds: number }): boolean;
    destroy(): void;
  }
  export function scratchShiftTime(scheduler: any, now: number): number;

  export const SCRATCH_BRAKE_SECONDS: number;
  export const SCRATCH_SPINUP_SECONDS: number;
  export const SCRATCH_HANDOVER_SECONDS: number;
  export const SCRATCH_SNAP_BEAT_CYCLES: number;
  export const SCRATCH_MIN_SHIFT_SECONDS: number;
  export function scratchSmoothStep(x: number): number;
  export function scratchBrakeRate(t: number, fromRate: number, seconds?: number): number;
  export function scratchSpinUpRate(t: number, fromRate: number, seconds?: number): number;
  export function scratchBeatSeconds(cps: number): number;
  export function planScratchSpinUp(args: {
    lagSeconds: number;
    fromRate: number;
    beatSeconds?: number;
    maxLagSeconds?: number;
  }): { targetSeconds: number; upSeconds: number; fromRate: number; nominalSeconds: number };
  /** Spec 023 review: the whole release the worklet runs (spin-up + correction bump). */
  export interface ScratchReleasePlan {
    targetSeconds: number;
    upSeconds: number;
    fromRate: number;
    nominalSeconds: number;
    bumpSeconds: number;
    bumpDepth: number;
    settleSeconds: number;
  }
  export function planScratchRelease(args: {
    lagSeconds: number;
    fromRate: number;
    beatSeconds?: number;
    maxLagSeconds?: number;
    minLagSeconds?: number;
  }): ScratchReleasePlan;
  export function scratchReleaseRate(
    t: number,
    plan: { upSeconds: number; bumpSeconds: number; bumpDepth: number; fromRate?: number },
    fromRate?: number,
  ): number;
  export function scratchBumpSeconds(errorSeconds: number, toZero?: boolean): number;
  export function scratchBumpDepth(errorSeconds: number, seconds: number): number;
  export function scratchShiftArrival(scheduler: any): { cycle: number; time: number } | null;
  export function scratchQueryTime(scheduler: any, cycle: number, now: number): number;
  export function scratchMidNoteValue(
    value: Record<string, unknown>,
    elapsed: number,
    deps?: Record<string, unknown>,
  ): Record<string, unknown> | null;
  export function scratchSoundingNotes(
    pattern: any,
    cycle: number,
    cps: number,
  ): Array<{ hap: any; value: Record<string, unknown>; elapsed: number; remaining: number }>;

  export interface ScratchControllerState {
    /** Any deck is held. */
    grabbed: boolean;
    selected: ScratchDeckName;
    /** Which decks are attached. */
    available: { main: boolean; preview: boolean };
  }

  /** Every scratch input (platter, wheel, keys, MIDI) goes through this, aimed at the selected deck. */
  export class ScratchController {
    constructor();
    setDeck(name: ScratchDeckName, deck: ScratchDeck | null): void;
    getDeck(name: ScratchDeckName): ScratchDeck | null;
    selected: ScratchDeckName;
    readonly state: ScratchControllerState;
    readonly isGrabbed: boolean;
    /** The sources holding the selected deck. */
    readonly holders: ScratchSource[];
    grab(source?: ScratchSource): boolean;
    /** Re-arms only `source`'s pending auto-release. */
    moveBy(seconds: number, source?: ScratchSource): void;
    setMotor(rate: number, source?: ScratchSource): void;
    /** `source` lets go; the deck is released only when no other source holds it. */
    release(source?: ScratchSource): void;
    /** Every source, every deck, every timer. */
    /** `commitPending` (an Update is coming): a release already spinning up keeps its lag (spec 023). */
    releaseAll(options?: { commitPending?: boolean }): void;
    /** `source` lets go `ms` after its last move (wheel and MIDI jog: 250 ms). */
    autoRelease(ms: number, source?: ScratchSource): void;
    on(event: 'change', listener: (state: ScratchControllerState) => void): () => void;
  }

  export const SCRATCH_DECKS: readonly ScratchDeckName[];
  export const SCRATCH_SOURCES: readonly ScratchSource[];
  /** One platter turn in seconds of audio (33⅓ rpm). */
  export const SCRATCH_SECONDS_PER_TURN: number;
  /** One mouse-wheel notch (100 px of deltaY) in seconds of audio. */
  export const SCRATCH_WHEEL_SECONDS_PER_NOTCH: number;
  /** How far back the record reaches from the moment of the grab. */
  export const SCRATCH_BUFFER_SECONDS: number;
  export const SCRATCH_MAX_MOTOR_RATE: number;

  export type MidiJogEncoding = 'twos-complement' | 'binary-offset';

  export interface MidiJogMapping {
    inputName: string;
    channel: number;
    controller: number;
    encoding: MidiJogEncoding;
  }

  export type MidiJogState = 'off' | 'ready' | 'learning' | 'unavailable';

  export interface MidiJog {
    /** Assigns the next turned control. Resolves null on timeout (the old mapping is kept) or without MIDI. */
    learn(): Promise<MidiJogMapping | null>;
    forget(): void;
    readonly mapping: MidiJogMapping | null;
    readonly state: MidiJogState;
    /** Set only while unavailable. */
    readonly reason?: 'unsupported' | 'denied' | 'failed';
    readonly detail?: string;
    readonly ready: Promise<void>;
    on(event: 'change', listener: (jog: MidiJog) => void): () => void;
    destroy(): void;
  }

  export function createMidiJog(
    controller: ScratchController,
    options?: { loadMidi?: () => Promise<unknown>; storage?: Storage },
  ): MidiJog;
  export function decodeRelativeCC(value: number, encoding?: MidiJogEncoding): number;
  export function detectRelativeEncoding(values: number[]): MidiJogEncoding;
  export const MIDI_JOG_STORAGE_KEY: string;
  export const MIDI_JOG_SECONDS_PER_TICK: number;
  export const MIDI_JOG_RELEASE_MS: number;
  export const MIDI_JOG_LEARN_TIMEOUT_MS: number;
  export const MIDI_JOG_ENCODINGS: readonly MidiJogEncoding[];
  /** Adds the scratch processor to the context, once per context. */
  export function loadScratchWorklet(audioContext: BaseAudioContext): Promise<void>;
}
