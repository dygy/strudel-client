import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import {
  SCRATCH_FEEL_DEFAULTS,
  SCRATCH_FEEL_RANGES,
  SCRATCH_SNAP_GRIDS,
  type ScratchDeckName,
  type ScratchFeel,
  type ScratchSnapGrid,
} from '@strudel/mixer';
import { Platter } from './Platter';
import { usePanelViewport } from '../panel/panelViewport';
import {
  isScratchActive,
  selectedSpin,
  scratchRuntime,
  type MidiFeelTarget,
  type ScratchFeelMidiStatus,
  type ScratchMidiStatus,
  type ScratchRuntime,
  type ScratchState,
} from '../../scratch/scratchRuntime';

import type { SettingsTranslations } from '@src/i18n';

type SettingsKey = keyof SettingsTranslations;

/** Why MIDI can't be used, as a settings string key. */
export function midiReasonKey(midi: ScratchMidiStatus): SettingsKey {
  const reason = midi.reason ?? '';
  if (/unsupported|not.?supported|no.?midi/i.test(reason)) return 'scratchMidiUnsupported';
  if (/denied|not.?allowed|security|permission/i.test(reason)) return 'scratchMidiDenied';
  return 'scratchMidiError';
}

/** A key combination in translated text, e.g. Alt+Shift+←, Alt+Mayús+→ or Alt+Shift. */
const KEY_COMBO = /((?:[A-Za-z\u00C0-\u017F]+\+)+(?:[←→]|[A-Za-z\u00C0-\u017F]+))/;

/**
 * The text with each key combination in its own left-to-right element, so Arabic and Hebrew
 * don't reorder "Alt+Shift+←" (the arrow and the + signs are direction-neutral characters).
 */
export function withLtrKeys(text: string): ReactNode[] {
  return text.split(KEY_COMBO).map((part, index) =>
    index % 2 === 1 ? (
      <kbd key={index} dir="ltr" className="font-[inherit] whitespace-nowrap">
        {part}
      </kbd>
    ) : (
      part
    ),
  );
}

// The same gate the runtime applies to every grab (keys, MIDI, wheel, pointer).
export { isScratchActive };

/** The line under the platter that says why it is dimmed, or null when it can be used. */
export function platterStatusKey(state: ScratchState): SettingsKey | null {
  if (!state.available[state.selected]) return 'scratchUnavailable';
  if (!state.playing[state.selected]) return 'scratchNotPlaying';
  return null;
}

/** Spec 025: the label key of each snap grid choice. */
export const SNAP_GRID_KEYS: Record<ScratchSnapGrid, SettingsKey> = {
  off: 'scratchSnapOff',
  half: 'scratchSnapHalf',
  beat: 'scratchSnapBeat',
  bar: 'scratchSnapBar',
};

/** Spec 025: the slider steps, in seconds. */
export const FEEL_STEPS: Record<keyof ScratchFeel, number> = { brakeSeconds: 0.01, spinUpSeconds: 0.1 };

/**
 * Spec 025: a feel value as a readout in seconds, in the page's language: one decimal (0.1 s,
 * 0.4 s), two when one would hide the value (0.02 s, 0.15 s).
 */
export function formatFeelSeconds(seconds: number, language?: string): string {
  const digits = Math.abs(seconds * 10 - Math.round(seconds * 10)) < 1e-6 ? 1 : 2;
  try {
    return new Intl.NumberFormat(language || undefined, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'short',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(seconds);
  } catch (error: unknown) {
    return `${seconds.toFixed(digits)} s`;
  }
}

/** Spec 029: each feel slider's MIDI Learn target. */
export const FEEL_MIDI_TARGETS: Record<keyof ScratchFeel, MidiFeelTarget> = {
  brakeSeconds: 'brake',
  spinUpSeconds: 'spinUp',
};

/**
 * Spec 029: a slider's Learn / Forget buttons and its knob status. Hidden without Web MIDI (as the
 * jog's Learn is unusable then); Esc or a second press cancels a Learn.
 */
function FeelMidiControls({
  runtime,
  feelMidi,
  target,
  touch,
}: {
  runtime: ScratchRuntime;
  feelMidi: ScratchFeelMidiStatus | undefined;
  target: MidiFeelTarget;
  touch: boolean;
}) {
  const { t } = useTranslation('settings');
  // Learn was pressed and MIDI is still starting (the browser may be asking for access).
  const [pending, setPending] = useState(false);
  if (!feelMidi || (feelMidi.state === 'unavailable' && feelMidi.reason === 'unsupported')) return null;
  const unavailable = feelMidi.state === 'unavailable';
  const learning = feelMidi.learning === target || (pending && !unavailable && !feelMidi.learning);
  const mapping = feelMidi.mappings[target];
  const message = feelMidi.message?.target === target && !learning ? feelMidi.message : null;

  const learn = async () => {
    setPending(true);
    try {
      await runtime.learnFeel(target);
    } catch (error: unknown) {
      console.warn('[scratch] MIDI feel learn failed:', error);
    } finally {
      setPending(false);
    }
  };

  let status = '';
  if (learning) status = t('scratchFeelLearning');
  else if (message?.kind === 'timeout') status = t('scratchFeelLearnTimeout');
  else if (message?.kind === 'conflict') status = t('scratchFeelLearnConflict', { control: message.control });
  else if (mapping)
    status = t('scratchMidiAssigned', {
      device: mapping.inputName,
      control: mapping.controller,
      channel: mapping.channel,
    });

  const buttonClass = cx(
    'px-2 rounded-md text-xs border border-lineHighlight bg-background text-foreground',
    'hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
    touch ? 'min-h-11 min-w-11' : 'h-6',
  );
  return (
    <div className="flex flex-wrap items-center gap-2" data-scratch-feel-midi={target}>
      <button
        type="button"
        data-scratch-feel-learn={target}
        aria-pressed={learning}
        disabled={unavailable}
        onClick={learn}
        className={cx(buttonClass, learning && 'animate-pulse')}
      >
        {t('scratchFeelLearn')}
      </button>
      {mapping && !learning && (
        <button
          type="button"
          data-scratch-feel-forget={target}
          onClick={() => runtime.forgetFeel(target)}
          className={buttonClass}
        >
          {t('scratchFeelForget')}
        </button>
      )}
      <span
        data-scratch-feel-midi-status={message?.kind ?? (learning ? 'learning' : mapping ? 'assigned' : 'none')}
        className="text-xs text-foreground opacity-70"
        aria-live="polite"
      >
        {status}
      </span>
    </div>
  );
}

/**
 * Spec 025: Snap (Off / ½ beat / Beat / Bar), the Brake and Spin-up sliders with readouts, and
 * Reset. Stored on this device; both decks, from the next grab or release. Spec 029: each slider
 * has a MIDI Learn / Forget when Web MIDI is there.
 */
export function ScratchFeelControls({
  runtime,
  state,
  touch,
}: {
  runtime: ScratchRuntime;
  state: ScratchState;
  touch: boolean;
}) {
  const { t, i18n } = useTranslation('settings');
  const language = i18n?.language;
  // Spec 029: Esc cancels a feel Learn.
  const feelLearning = state.feelMidi?.learning ?? null;
  useEffect(() => {
    if (!feelLearning) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') runtime.cancelFeelLearn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feelLearning, runtime]);
  const slider = (key: keyof ScratchFeel, label: string) => {
    const [min, max] = SCRATCH_FEEL_RANGES[key];
    const value = state.feel[key];
    const id = `scratch-feel-${key}`;
    return (
      <div className="space-y-1" data-scratch-feel={key}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm text-foreground">
            {label}
          </label>
          <output htmlFor={id} data-scratch-feel-value="" className="text-xs text-foreground opacity-70 tabular-nums">
            {formatFeelSeconds(value, language)}
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={FEEL_STEPS[key]}
          value={value}
          aria-valuetext={formatFeelSeconds(value, language)}
          onChange={(event) => runtime.setFeel({ [key]: Number(event.target.value) })}
          className={cx(
            'w-full bg-lineHighlight rounded-lg appearance-none cursor-pointer accent-foreground',
            touch ? 'h-3 my-2' : 'h-2',
          )}
        />
        <FeelMidiControls runtime={runtime} feelMidi={state.feelMidi} target={FEEL_MIDI_TARGETS[key]} touch={touch} />
      </div>
    );
  };
  const isDefault =
    state.feel.brakeSeconds === SCRATCH_FEEL_DEFAULTS.brakeSeconds &&
    state.feel.spinUpSeconds === SCRATCH_FEEL_DEFAULTS.spinUpSeconds;
  return (
    <div className="space-y-3">
      {/* Spec 023 2.4 / 025 2.1: the track's new position after a scratch is rounded to the grid. */}
      <div className="space-y-1" data-scratch-snap="">
        <label htmlFor="scratch-snap-grid" className="block text-sm text-foreground">
          {t('scratchSnap')}
        </label>
        <select
          id="scratch-snap-grid"
          value={state.snapGrid}
          onChange={(event) => runtime.setSnapGrid(event.target.value as ScratchSnapGrid)}
          className={cx(
            'w-full px-3 bg-background border border-lineHighlight rounded-md text-sm text-foreground cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-foreground',
            touch ? 'min-h-11' : 'h-8',
          )}
        >
          {SCRATCH_SNAP_GRIDS.map((grid) => (
            <option key={grid} value={grid} className="bg-background text-foreground">
              {t(SNAP_GRID_KEYS[grid])}
            </option>
          ))}
        </select>
        <span className="block text-xs text-foreground opacity-70">{t('scratchSnapHint')}</span>
      </div>
      {slider('brakeSeconds', t('scratchBrake'))}
      {slider('spinUpSeconds', t('scratchSpinUp'))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-scratch-feel-reset=""
          disabled={isDefault}
          onClick={() => runtime.resetFeel()}
          className={cx(
            'px-3 rounded-md text-sm border border-lineHighlight bg-background text-foreground',
            'hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
            touch ? 'min-h-11' : 'h-8',
          )}
        >
          {t('scratchFeelReset')}
        </button>
      </div>
      <p data-scratch-feel-hint="" className="text-xs text-foreground opacity-70">
        {t('scratchFeelHint')}
      </p>
    </div>
  );
}

export function DeckSwitch({
  runtime,
  state,
  withPreview,
  touch,
}: {
  runtime: ScratchRuntime;
  state: ScratchState;
  withPreview: boolean;
  touch: boolean;
}) {
  const { t } = useTranslation('settings');
  const option = (deck: ScratchDeckName, label: string, disabled: boolean, hint?: string) => {
    const selected = state.selected === deck;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-scratch-deck={deck}
        disabled={disabled}
        title={hint ?? label}
        onClick={() => runtime.select(deck)}
        className={cx(
          'px-3 rounded-md text-sm border transition-colors',
          touch ? 'min-h-11' : 'h-8',
          selected
            ? 'bg-foreground text-background border-foreground'
            : 'bg-background text-foreground border-lineHighlight hover:border-foreground',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label={t('scratchDeck')} className="flex flex-wrap gap-2">
      {option('main', t('scratchDeckMain'), false)}
      {withPreview &&
        option(
          'preview',
          t('scratchDeckPreview'),
          !state.previewAvailable,
          state.previewAvailable ? undefined : t('scratchPreviewOff'),
        )}
    </div>
  );
}

function MidiJogControls({
  runtime,
  midi,
  touch,
}: {
  runtime: ScratchRuntime;
  midi: ScratchMidiStatus;
  touch: boolean;
}) {
  const { t } = useTranslation('settings');
  const [timedOut, setTimedOut] = useState(false);
  // Learn was pressed and hasn't finished: also while the browser asks for MIDI access.
  const [pending, setPending] = useState(false);
  const unavailable = midi.state === 'unavailable';
  const learning = midi.state === 'learning' || (pending && !unavailable);

  const learn = async () => {
    setTimedOut(false);
    setPending(true);
    try {
      const mapping = await runtime.midiLearn();
      // Learn gave up (10 s without a turned control): the old mapping, if any, is kept. A Learn
      // cancelled by another one or refused (spec 029 review) is not a timeout.
      const { state: midiState, lastLearn } = runtime.store.get().midi;
      if (mapping === null && midiState !== 'unavailable' && (!lastLearn || lastLearn.status === 'timeout')) {
        setTimedOut(true);
      }
    } catch (error: unknown) {
      console.warn('[scratch] MIDI learn failed:', error);
    } finally {
      setPending(false);
    }
  };

  let status: string;
  if (unavailable) status = t(midiReasonKey(midi));
  else if (learning) status = t('scratchMidiLearning');
  else if (midi.mapping)
    status = t('scratchMidiAssigned', {
      device: midi.mapping.inputName,
      control: midi.mapping.controller,
      channel: midi.mapping.channel,
    });
  else status = t('scratchMidiNone');

  const buttonClass = cx(
    'px-3 rounded-md text-sm border border-lineHighlight bg-background text-foreground',
    'hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
    touch ? 'min-h-11' : 'h-8',
  );

  return (
    <div className="space-y-2" data-scratch-midi="">
      <div className="text-sm font-medium text-foreground">{t('scratchMidi')}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-scratch-midi-learn=""
          className={cx(buttonClass, learning && 'animate-pulse')}
          disabled={unavailable || learning}
          onClick={learn}
        >
          {t('scratchMidiLearn')}
        </button>
        {midi.mapping && (
          <button
            type="button"
            data-scratch-midi-forget=""
            className={buttonClass}
            disabled={learning}
            onClick={() => {
              setTimedOut(false);
              runtime.midiForget();
            }}
          >
            {t('scratchMidiForget')}
          </button>
        )}
      </div>
      <p data-scratch-midi-status={midi.state} className="text-xs text-foreground opacity-70" aria-live="polite">
        {status}
      </p>
      {timedOut && !learning && (
        <p data-scratch-midi-timeout="" className="text-xs text-foreground opacity-70">
          {t('scratchMidiLearnTimeout')}
        </p>
      )}
      {midi.lastLearn?.status === 'conflict' && !learning && (
        <p data-scratch-midi-conflict="" className="text-xs text-foreground opacity-70" role="alert">
          {t('scratchMidiLearnConflict', { control: midi.lastLearn.controller })}
        </p>
      )}
    </div>
  );
}

/**
 * The Scratch section of Mixer Settings (spec 019 2.1, 2.5): the platter, the deck switch
 * (Speakers / Headphones, the latter only while the headphone preview runs), MIDI Learn / Forget,
 * and the keyboard hint. Without the preview mixer only Speakers is offered.
 */
export function ScratchSection({
  withPreview = true,
  runtime = scratchRuntime,
}: {
  withPreview?: boolean;
  runtime?: ScratchRuntime;
}) {
  const { t } = useTranslation('settings');
  const { compact } = usePanelViewport();
  const state = useStore(runtime.store);
  const statusKey = platterStatusKey(state);

  return (
    <section
      data-scratch-section=""
      aria-label={t('scratch')}
      className="p-4 bg-background border border-lineHighlight rounded-lg space-y-3"
    >
      <div>
        <h3 className="text-sm font-medium text-foreground">{t('scratch')}</h3>
        <p className="text-xs text-foreground opacity-70">{t('scratchDescription')}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <Platter
            actions={runtime}
            active={isScratchActive(state)}
            grabbed={state.grabbed}
            size={compact ? 'compact' : 'settings'}
            label={t('scratchPlatter')}
            spin={selectedSpin(state)}
            feel={state.feel}
          />
          <p
            data-scratch-status=""
            className="text-xs text-foreground opacity-70 text-center max-w-[13rem] min-h-[1rem]"
            aria-live="polite"
          >
            {statusKey ? t(statusKey) : ''}
          </p>
        </div>
        <div className="flex-1 min-w-[12rem] space-y-3">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{t('scratchDeck')}</div>
            <DeckSwitch runtime={runtime} state={state} withPreview={withPreview} touch={compact} />
          </div>
          <ScratchFeelControls runtime={runtime} state={state} touch={compact} />
          <MidiJogControls runtime={runtime} midi={state.midi} touch={compact} />
          <p data-scratch-shortcut-hint="" className="text-xs text-foreground opacity-70">
            {withLtrKeys(t('scratchShortcutHint'))}
          </p>
          {/* Owner decision: keep Alt+Shift, and say that Windows may use it to switch layouts. */}
          <p data-scratch-shortcut-note="" className="text-xs text-foreground opacity-50">
            {withLtrKeys(t('scratchShortcutWindowsNote'))}
          </p>
        </div>
      </div>
    </section>
  );
}
