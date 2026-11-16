/**
 * The MIDI map for the REPL (spec 031 tech §2.6): one map (packages/mixer/midi/midiMap.mjs) and one
 * crossfader per REPL, created by ReplEditor next to the set player and provided through
 * MidiMapContext to the MIDI panel, the Mixer settings sliders and the performance strip.
 *
 * - The targets (midiTargets.ts) read the REPL through refs, so they always act on the latest
 *   render's handlers; they are registered once and again when the language changes (their names).
 * - The browser is asked for MIDI access only by Learn, or at once when stored bindings exist.
 * - Esc cancels a running Learn.
 * - Soft takeover: any change to an EQ band that didn't come from that band's own control (the panel
 *   slider, a preset, A/B, the other band's pad) makes its control pick up again. The volume and
 *   crossfader sliders call `notifyExternalChange` themselves.
 * - Works signed out and in the admin's read-only view (nothing here writes to a track).
 */
import { useEffect, useRef, useState } from 'react';
import { claimMidiLearn, createMidiMap, type MidiMap, type MidiMapState } from '@strudel/mixer';
import { useStore } from '@nanostores/react';
import type { AudioEqualizer } from '@strudel/equalizer';
import { useTranslation } from '@src/i18n';
import { getTransitionSettings, setTransitionSettings } from '@src/settings';
import { getMainEqualizer } from '../mainEqualizer';
import { subscribeEqSlots } from '../eqStore';
import { togglePerformance } from '../performance/performanceStore';
import { scratchRuntime, type ScratchRuntime } from '../scratch/scratchRuntime';
import type { HeadphonesVolumeEngine } from '../headphonesVolume';
import type { SetPlayerContextValue } from '../sets/useSetPlayer';
import type { ManualMixControls } from '../useReplContext';
import { createCrossfader, type ManualOutcome } from './crossfader';
import { buildMidiTargets, EQ_BAND_COUNT, eqBandTargetId, midiEqBandSource } from './midiTargets';
import type { MidiMapContextValue } from './midiMapContext';

export { MidiMapContext, useMidiMapContext, type MidiMapContextValue } from './midiMapContext';

/** What the hook needs of the REPL context. */
export interface MidiMapReplContext {
  handleTogglePlay: () => unknown;
  handleEvaluate: () => unknown;
  trackIds?: () => { editor: string | null; playing: string | null };
  manualMix?: ManualMixControls;
}

export interface UseMidiMapOptions {
  context: MidiMapReplContext;
  /** The headphone PreviewEngine, or null. */
  mixer: (HeadphonesVolumeEngine & { equalizer?: AudioEqualizer | null }) | null | undefined;
  setPlayer: SetPlayerContextValue | null;
  /** Tests: the map factory (default createMidiMap). */
  createMap?: typeof createMidiMap;
  /** The scratch runtime whose jog and feel Learns Esc cancels too (default: the app's). */
  scratch?: Pick<ScratchRuntime, 'store' | 'cancelFeelLearn'>;
}

/**
 * Cancel whichever MIDI Learn holds the page's one-Learn lock (the jog has no cancel of its own):
 * claim it, which cancels the holder, and release it at once.
 */
export function cancelAnyMidiLearn(): void {
  claimMidiLearn(() => {}, typeof localStorage !== 'undefined' ? localStorage : null)();
}

/** How a set's manual Go ended, as the crossfader's outcome. */
export function setOutcome(result: string): ManualOutcome {
  if (result === 'switched') return 'complete';
  if (result === 'abandoned' || result === 'failed') return result;
  return 'ignored'; // also 'cancelled' (Stop): the mix is over, nothing flips
}

export function useMidiMap({
  context,
  mixer,
  setPlayer,
  createMap = createMidiMap,
  scratch = scratchRuntime,
}: UseMidiMapOptions) {
  const { t, i18n, ready } = useTranslation('settings');
  const latest = useRef({ context, mixer, setPlayer, t });
  latest.current = { context, mixer, setPlayer, t };

  const [crossfader] = useState(() => createCrossfader());
  const [map, setMap] = useState<MidiMap | null>(null);
  const [state, setState] = useState<MidiMapState | null>(null);

  // The crossfader's way to the set player and the main repl (read through the ref).
  useEffect(() => {
    crossfader.setDeps({
      isPlaying: () => Boolean(latest.current.context.manualMix?.isPlaying()),
      setCued: () => {
        const sp = latest.current.setPlayer;
        return Boolean(sp?.enabled && sp.manualGo && sp.player.phase === 'cued');
      },
      editorDiffers: () => {
        const ids = latest.current.context.trackIds?.();
        return Boolean(ids?.editor && ids.editor !== ids.playing);
      },
      beginSet: async () => {
        const go = latest.current.setPlayer?.manualGo;
        return go ? setOutcome(await go()) : 'ignored';
      },
      beginEditor: async () => (await latest.current.context.manualMix?.beginEditor()) ?? 'ignored',
      setProgress: (p) => latest.current.context.manualMix?.setProgress(p) ?? false,
      handOver: () => latest.current.context.manualMix?.handOver() ?? false,
    });
    return () => crossfader.setDeps(null);
  }, [crossfader]);

  const targets = () =>
    buildMidiTargets({
      equalizers: () =>
        [getMainEqualizer(), latest.current.mixer?.equalizer].filter((eq): eq is AudioEqualizer => !!eq),
      previewEngine: () => latest.current.mixer ?? null,
      crossfader,
      // Review #6: Go during a manual mix hands it over even with no set (or no set player).
      cueGo: () => {
        if (latest.current.context.manualMix?.handOver()) return;
        latest.current.setPlayer?.press();
      },
      togglePlay: () => void latest.current.context.handleTogglePlay(),
      update: () => void latest.current.context.handleEvaluate(),
      togglePerformance,
      getTransitionType: () => getTransitionSettings().type,
      setTransitionType: (type) => setTransitionSettings({ type }),
      label: (meta) => String(latest.current.t(meta.labelKey, meta.labelParams ?? {})),
    });

  // The map, once per REPL.
  useEffect(() => {
    const created = createMap({ targets: targets() });
    setMap(created);
    setState(created.getState());
    const unsubscribe = created.subscribe(setState);
    return () => {
      unsubscribe();
      created.destroy();
    };
  }, []);

  // The targets' names follow the language.
  useEffect(() => {
    map?.setTargets(targets());
  }, [map, i18n.language, ready]);

  // Esc cancels a running Learn: the map's, and (review) a jog or feel Learn started from the panel.
  const learning = state?.learning ?? null;
  const { midi: jog, feelMidi } = useStore(scratch.store);
  const scratchLearning = jog?.state === 'learning' || Boolean(feelMidi?.learning);
  useEffect(() => {
    if (!learning && !scratchLearning) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (learning) map?.cancelLearn();
      if (scratchLearning) {
        scratch.cancelFeelLearn();
        cancelAnyMidiLearn();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [map, learning, scratchLearning, scratch]);

  // Soft takeover for the EQ bands: a band changed by anything but its own control picks up again.
  useEffect(() => {
    if (!map) return;
    return subscribeEqSlots((slots, source, previous) => {
      const now = slots[slots.active].bands;
      const before = previous[previous.active].bands;
      for (let index = 0; index < EQ_BAND_COUNT; index++) {
        if (source === midiEqBandSource(index)) continue;
        if (now[index]?.gain !== before[index]?.gain) map.notifyExternalChange(eqBandTargetId(index));
      }
    });
  }, [map]);

  const value: MidiMapContextValue = {
    map,
    state,
    crossfader,
    notifyExternalChange: (targetId) => map?.notifyExternalChange(targetId),
  };
  return value;
}
