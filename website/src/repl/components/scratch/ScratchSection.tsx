import { useState, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import type { ScratchDeckName } from '@strudel/mixer';
import { Platter } from './Platter';
import { usePanelViewport } from '../panel/panelViewport';
import {
  isScratchActive,
  scratchRuntime,
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
      // Learn gave up (10 s without a turned control): the old mapping, if any, is kept.
      if (mapping === null && runtime.store.get().midi.state !== 'unavailable') setTimedOut(true);
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
