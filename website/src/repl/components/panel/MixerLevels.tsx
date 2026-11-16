/**
 * Spec 031 §2.4, §2.5: the speakers and headphones volume sliders and the crossfader, for the Mixer
 * settings (MixerSettings) and, compact, the performance strip.
 *
 * Every on-screen change goes through the same setter MIDI uses and then tells the MIDI map
 * (`notifyExternalChange`), so a bound knob or fader picks the value up again before it drives it.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { getSpeakersVolume, setSpeakersVolume, subscribeSpeakersVolume } from '../../speakersVolume';
import {
  getHeadphonesVolume,
  setHeadphonesVolume,
  subscribeHeadphonesVolume,
  type HeadphonesVolumeEngine,
} from '../../headphonesVolume';
import { useMidiMapContext } from '../../midi/midiMapContext';
import { MIDI_TARGET_IDS } from '../../midi/midiTargets';
import { INITIAL_CROSSFADER_STATE, type Crossfader } from '../../midi/crossfader';
import { useSetPlayerContext } from '../../sets/useSetPlayer';

const percent = (v01: number) => Math.round(v01 * 100);

function LevelSlider({
  id,
  label,
  value,
  onChange,
  compact,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v01: number) => void;
  compact: boolean;
}) {
  return (
    <div className="space-y-1" data-mixer-level={id}>
      <div className="flex items-center justify-between gap-2 text-sm text-foreground">
        <label htmlFor={`mixer-level-${id}`}>{label}</label>
        <span className="font-mono text-xs opacity-70 tabular-nums" data-mixer-level-value="">
          {percent(value)}%
        </span>
      </div>
      <input
        id={`mixer-level-${id}`}
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent(value)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className={cx('w-full accent-foreground', compact && 'min-h-11')}
      />
    </div>
  );
}

/** The speakers volume, always shown. */
export function SpeakersVolumeSlider({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('settings');
  const midi = useMidiMapContext();
  const [level, setLevel] = useState(getSpeakersVolume);
  useEffect(() => {
    setLevel(getSpeakersVolume());
    return subscribeSpeakersVolume(setLevel);
  }, []);
  return (
    <LevelSlider
      id="speakers"
      label={t('midiTargetSpeakers')}
      value={level}
      compact={compact}
      onChange={(v) => {
        setSpeakersVolume(v);
        setLevel(getSpeakersVolume());
        midi?.notifyExternalChange(MIDI_TARGET_IDS.speakers);
      }}
    />
  );
}

/** The headphones volume, on the preview engine. */
export function HeadphonesVolumeSlider({
  engine,
  compact = false,
}: {
  engine: HeadphonesVolumeEngine;
  compact?: boolean;
}) {
  const { t } = useTranslation('settings');
  const midi = useMidiMapContext();
  const [level, setLevel] = useState(() => getHeadphonesVolume(engine));
  useEffect(() => {
    setLevel(getHeadphonesVolume(engine));
    return subscribeHeadphonesVolume(() => setLevel(getHeadphonesVolume(engine)));
  }, [engine]);
  return (
    <LevelSlider
      id="headphones"
      label={t('midiTargetHeadphones')}
      value={level}
      compact={compact}
      onChange={(v) => {
        setHeadphonesVolume(engine, v);
        setLevel(getHeadphonesVolume(engine));
        midi?.notifyExternalChange(MIDI_TARGET_IDS.headphones);
      }}
    />
  );
}

const noSubscribe = () => () => {};
const initialState = () => INITIAL_CROSSFADER_STATE;

function useCrossfaderState(crossfader: Crossfader | null) {
  return useSyncExternalStore(
    crossfader ? crossfader.subscribe : noSubscribe,
    crossfader ? crossfader.getState : initialState,
    crossfader ? crossfader.getState : initialState,
  );
}

/**
 * The crossfader: A (left) … B (right), the playing end marked. Its row is always left-to-right,
 * like the hardware fader and its MIDI range (0 = left), also in Arabic and Hebrew. Nothing outside
 * the REPL (no MIDI map context).
 */
export function CrossfaderControl({ compact = false, strip = false }: { compact?: boolean; strip?: boolean }) {
  const { t } = useTranslation('settings');
  const midi = useMidiMapContext();
  // Re-render when the set's cue changes: it decides whether there is a next track.
  useSetPlayerContext();
  const crossfader = midi?.crossfader ?? null;
  const state = useCrossfaderState(crossfader);
  if (!crossfader) return null;

  const next = crossfader.nextSource();
  const playingSide = state.playingEnd === 'left' ? t('mixerCrossfaderSideA') : t('mixerCrossfaderSideB');
  let status: string;
  let statusKind: string;
  if (state.mixing) {
    status = t('mixerCrossfaderMixing', { percent: percent(crossfader.progress()) });
    statusKind = 'mixing';
  } else if (!next) {
    status = t('mixerCrossfaderNothingCued');
    statusKind = 'nothing-cued';
  } else if (!state.armed) {
    status = t('mixerCrossfaderReturn');
    statusKind = 'return';
  } else {
    status = t('mixerCrossfaderPlaying', { side: playingSide });
    statusKind = 'ready';
  }

  const end = (side: 'left' | 'right') => {
    const playing = state.playingEnd === side;
    return (
      <span
        data-crossfader-end={side}
        data-playing={playing ? 'true' : undefined}
        title={side === 'left' ? t('mixerCrossfaderSideA') : t('mixerCrossfaderSideB')}
        className={cx(
          'shrink-0 inline-flex items-center justify-center rounded font-mono text-xs w-6 h-6 border',
          playing ? 'border-green-500 text-green-400 font-bold' : 'border-lineHighlight text-foreground opacity-70',
        )}
      >
        {side === 'left' ? 'A' : 'B'}
      </span>
    );
  };

  const slider = (
    <div dir="ltr" className="flex items-center gap-2 min-w-0" data-crossfader-row="">
      {end('left')}
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(state.position * 1000)}
        aria-label={t('midiTargetCrossfader')}
        aria-valuetext={status}
        data-crossfader-slider=""
        onChange={(event) => {
          crossfader.setPosition(Number(event.target.value) / 1000);
          midi?.notifyExternalChange(MIDI_TARGET_IDS.crossfader);
        }}
        className={cx('flex-1 min-w-0 accent-foreground', compact && !strip && 'min-h-11')}
      />
      {end('right')}
    </div>
  );

  if (strip) {
    return (
      <div className="flex flex-col min-w-0 basis-40 shrink" data-crossfader="" data-crossfader-strip="">
        {slider}
        <span
          className="text-[10px] leading-tight text-foreground opacity-70 truncate"
          data-crossfader-status={statusKind}
        >
          {status}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-crossfader="">
      <div className="text-sm text-foreground">{t('midiTargetCrossfader')}</div>
      {slider}
      <p className="text-xs text-foreground opacity-70" data-crossfader-status={statusKind} aria-live="polite">
        {status}
      </p>
      <p className="text-xs text-foreground opacity-50">{t('mixerCrossfaderHint')}</p>
    </div>
  );
}

/** The Mixer settings' levels: speakers, headphones (while the preview engine is active), crossfader. */
export function MixerLevels({ mixer, compact = false }: { mixer?: HeadphonesVolumeEngine | null; compact?: boolean }) {
  const { t } = useTranslation('settings');
  const previewActive = Boolean(mixer && (mixer as { isInitialized?: boolean }).isInitialized);
  return (
    <section
      data-mixer-levels=""
      aria-label={t('mixerLevels')}
      className="p-4 bg-background border border-lineHighlight rounded-lg space-y-3"
    >
      <h3 className="text-sm font-medium text-foreground">{t('mixerLevels')}</h3>
      <SpeakersVolumeSlider compact={compact} />
      {previewActive && mixer && <HeadphonesVolumeSlider engine={mixer} compact={compact} />}
      <CrossfaderControl compact={compact} />
    </section>
  );
}
