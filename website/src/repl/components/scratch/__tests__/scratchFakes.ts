/**
 * Test helpers for the scratch UI (spec 019): a runtime built on the real ScratchController, with
 * stand-in decks (no Web Audio) and an injectable MIDI jog.
 */
import { vi } from 'vitest';
import { ScratchController, type MidiJog, type MidiJogMapping, type ScratchDeckName } from '@strudel/mixer';
import {
  createScratchRuntime,
  type ScratchDeckLike,
  type ScratchRuntime,
  type ScratchRuntimeDeps,
} from '../../../scratch/scratchRuntime';

export class FakeDeck implements ScratchDeckLike {
  isAttached = false;
  isGrabbed = false;
  private listeners = new Set<() => void>();
  attach() {
    this.isAttached = true;
    this.emit();
    return Promise.resolve(true);
  }
  grab() {
    if (!this.isAttached) return false;
    if (!this.isGrabbed) {
      this.isGrabbed = true;
      this.emit();
    }
    return true;
  }
  moveBy() {}
  setMotor() {}
  release() {
    if (!this.isGrabbed) return;
    this.isGrabbed = false;
    this.emit();
  }
  destroy() {
    this.release();
    this.isAttached = false;
    this.emit();
  }
  on(_event: 'change', fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}

/** A MIDI jog whose Learn is finished by the test. */
export function fakeJog() {
  const listeners = new Set<(jog: MidiJog) => void>();
  let finish: ((m: MidiJogMapping | null) => void) | null = null;
  const jog = {
    mapping: null as MidiJogMapping | null,
    state: 'off' as MidiJog['state'],
    reason: undefined as MidiJog['reason'],
    ready: Promise.resolve(),
    learn: vi.fn(() => {
      jog.state = 'learning';
      emit();
      return new Promise<MidiJogMapping | null>((resolve) => {
        finish = (m) => {
          if (m) jog.mapping = m;
          jog.state = jog.mapping ? 'ready' : 'off';
          emit();
          resolve(m);
        };
      });
    }),
    forget: vi.fn(() => {
      jog.mapping = null;
      jog.state = 'off';
      emit();
    }),
    on: (_event: 'change', fn: (j: MidiJog) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy: vi.fn(),
  };
  function emit() {
    for (const fn of [...listeners]) fn(jog as unknown as MidiJog);
  }
  return {
    jog: jog as unknown as MidiJog,
    finish: (m: MidiJogMapping | null) => finish?.(m),
    /** MIDI start-up failed (no support, denied, …). */
    fail: (reason: NonNullable<MidiJog['reason']>) => {
      jog.state = 'unavailable';
      jog.reason = reason;
      emit();
    },
  };
}

export function fakeRuntime(overrides: Partial<ScratchRuntimeDeps> = {}): {
  runtime: ScratchRuntime;
  written: ScratchDeckName[];
  deps: ScratchRuntimeDeps;
} {
  const written: ScratchDeckName[] = [];
  const deps: ScratchRuntimeDeps = {
    createController: () => new ScratchController(),
    createDeck: () => new FakeDeck() as unknown as ReturnType<ScratchRuntimeDeps['createDeck']>,
    loadMidiJog: vi.fn(async () => fakeJog().jog),
    readSelected: () => 'main',
    writeSelected: (deck) => written.push(deck),
    midiSupported: () => true,
    hasStoredMidiMapping: () => false,
    ...overrides,
  };
  return { runtime: createScratchRuntime(deps), written, deps };
}

/** The main deck attached and playing, and optionally the headphone preview too. */
export async function playing(runtime: ScratchRuntime, { preview = false }: { preview?: boolean } = {}) {
  await runtime.attachMain({} as AudioContext, {});
  runtime.setPlaying('main', true);
  if (preview) {
    const deck = new FakeDeck();
    runtime.attachPreview({
      ensureScratchDeck: async () => {
        await deck.attach();
        return deck;
      },
    });
    runtime.setPlaying('preview', true);
    await runtime.ensurePreviewDeck();
  }
}
