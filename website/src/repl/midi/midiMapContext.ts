/**
 * The REPL's MIDI map and crossfader as a React context (spec 031), apart from useMidiMap so the
 * panel and the sliders read it without importing the REPL's wiring.
 */
import { createContext, useContext } from 'react';
import type { MidiMap, MidiMapState } from '@strudel/mixer';
import type { Crossfader } from './crossfader';

export interface MidiMapContextValue {
  /** Null until created (just after the first render). */
  map: MidiMap | null;
  state: MidiMapState | null;
  crossfader: Crossfader;
  /** An on-screen change to a continuous target: its control must pick it up again. */
  notifyExternalChange: (targetId: string) => void;
}

export const MidiMapContext = createContext<MidiMapContextValue | null>(null);

/** The REPL's MIDI map, or null outside the REPL (tests, other pages). */
export const useMidiMapContext = (): MidiMapContextValue | null => useContext(MidiMapContext);
