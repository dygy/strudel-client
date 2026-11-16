/**
 * The MIDI panel (spec 031 §2.2, tech §2.6), in the Settings tab after the Mixer settings: every
 * target of §2.1 in its group with its binding, Learn and Clear; Clear all (confirmed here, never in a
 * browser dialog), Export and Import. The scratch jog and feel knobs are listed with their own Learn
 * (specs 019, 029), unchanged.
 *
 * - The status line: no Web MIDI, not asked yet, denied, failed, or the connected inputs.
 * - A row says why its last Learn ended (timed out, cancelled, which target already holds the
 *   control, MIDI unavailable) and "Move to pick up" while its control hasn't reached the value.
 * - Esc cancels a running Learn (useMidiMap).
 * Logical classes only, so Arabic and Hebrew mirror it.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import type { SettingsTranslations } from '@src/i18n';
import {
  MIDI_MAP_EXPORT_FILENAME,
  type MidiControl,
  type MidiControlHolder,
  type MidiMapImportError,
  type MidiMapState,
} from '@strudel/mixer';
import { usePanelViewport } from './panelViewport';
import { useMidiMapContext } from '../../midi/midiMapContext';
import { MIDI_TARGETS, type MidiTargetGroup, type MidiTargetMeta } from '../../midi/midiTargets';
import { conflictOwner, holderName } from '../../midi/holderName';
import { scratchRuntime, type MidiFeelTarget, type ScratchRuntime } from '../../scratch/scratchRuntime';

type SettingsKey = keyof SettingsTranslations;
type T = (key: string, options?: Record<string, unknown>) => string;

const GROUPS: { id: MidiTargetGroup | 'scratch'; label: SettingsKey }[] = [
  { id: 'eq', label: 'midiGroupEq' },
  { id: 'mixer', label: 'midiGroupMixer' },
  { id: 'set', label: 'midiGroupSet' },
  { id: 'transport', label: 'midiGroupTransport' },
  { id: 'transition', label: 'midiGroupTransition' },
  { id: 'view', label: 'midiGroupView' },
  { id: 'scratch', label: 'midiGroupScratch' },
];

/** Import error → `settings:` key. */
export const IMPORT_ERROR_KEYS: Record<MidiMapImportError | 'unreadable', SettingsKey> = {
  'not-json': 'midiImportErrorNotJson',
  'not-a-map': 'midiImportErrorNotMap',
  'unsupported-version': 'midiImportErrorVersion',
  'invalid-binding': 'midiImportErrorBinding',
  'duplicate-control': 'midiImportErrorDuplicate',
  conflict: 'midiImportErrorConflict',
  unreadable: 'midiImportErrorRead',
};

/** Status (and a Learn that couldn't start) → `settings:` key. */
const STATUS_KEYS: Record<'unsupported' | 'idle' | 'denied' | 'failed', SettingsKey> = {
  unsupported: 'midiStatusUnsupported',
  idle: 'midiStatusIdle',
  denied: 'midiStatusDenied',
  failed: 'midiStatusFailed',
};

/** A file's text: Blob.text(), or FileReader where that is missing. */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const targetName = (t: T, meta: MidiTargetMeta) => t(meta.labelKey, meta.labelParams ?? {});

export { holderName };

/** "Launch Control · ch 1 · CC 20" or "… · note 36". */
export function bindingText(t: T, control: Pick<MidiControl, 'inputName' | 'kind' | 'channel' | 'number'>): string {
  return t(control.kind === 'note' ? 'midiBindingNote' : 'midiBindingCc', {
    device: control.inputName,
    channel: control.channel,
    number: control.number,
  });
}

/** Why the last Learn of `id` ended, or "Move to pick up", or null. */
function rowNote(t: T, state: MidiMapState, id: string): { text: string; kind: string } | null {
  if (state.learning === id) return { text: t('midiLearning'), kind: 'learning' };
  const last = state.lastLearn as {
    targetId: string;
    ok: boolean;
    reason?: keyof typeof STATUS_KEYS | 'timeout' | 'cancelled' | 'conflict';
    holder?: MidiControlHolder;
  } | null;
  if (last && last.targetId === id && !last.ok && last.reason) {
    if (last.reason === 'timeout') return { text: t('midiTimedOut'), kind: 'timeout' };
    if (last.reason === 'cancelled') return { text: t('midiCancelled'), kind: 'cancelled' };
    if (last.reason === 'conflict' && last.holder) {
      return { text: t('midiConflict', { holder: holderName(t, last.holder) }), kind: 'conflict' };
    }
    if (last.reason === 'conflict') return { text: t('midiConflict', { holder: '?' }), kind: 'conflict' };
    return { text: t(STATUS_KEYS[last.reason]), kind: last.reason };
  }
  if (state.awaitingPickup.includes(id)) return { text: t('midiPickup'), kind: 'pickup' };
  return null;
}

function Row({
  id,
  name,
  binding,
  note,
  learning,
  canLearn,
  onLearn,
  onClear,
  touch,
}: {
  id: string;
  name: string;
  binding: string | null;
  note: { text: string; kind: string } | null;
  learning: boolean;
  canLearn: boolean;
  onLearn: () => void;
  onClear: () => void;
  touch: boolean;
}) {
  const { t } = useTranslation('settings');
  const button = cx(
    'px-3 rounded-md text-sm border border-lineHighlight bg-background text-foreground',
    'hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
    touch ? 'min-h-11' : 'h-8',
  );
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1" data-midi-row={id}>
      <span className="text-sm text-foreground min-w-0 basis-36 grow">{name}</span>
      {/* Review #9: the binding takes the free space and truncates, so Learn/Clear stay on the row. */}
      <span
        className="text-xs font-mono text-foreground opacity-80 flex-1 basis-0 min-w-0 truncate"
        data-midi-binding=""
        title={binding ?? undefined}
      >
        {binding ? <bdi>{binding}</bdi> : '—'}
      </span>
      {note && (
        <span
          className="text-xs text-foreground opacity-70"
          data-midi-note={note.kind}
          role={note.kind === 'conflict' ? 'alert' : undefined}
        >
          {note.text}
        </span>
      )}
      <span className="flex items-center gap-2 ms-auto shrink-0">
        <button
          type="button"
          data-midi-learn={id}
          className={cx(button, learning && 'animate-pulse border-foreground')}
          aria-pressed={learning}
          disabled={!canLearn}
          onClick={onLearn}
        >
          {t('midiLearn')}
        </button>
        <button type="button" data-midi-clear={id} className={button} disabled={!binding} onClick={onClear}>
          {t('midiClear')}
        </button>
      </span>
    </li>
  );
}

const FEEL_TARGETS: { target: MidiFeelTarget; label: SettingsKey }[] = [
  { target: 'brake', label: 'midiTargetBrake' },
  { target: 'spinUp', label: 'midiTargetSpinUp' },
];

/** The jog and the feel knobs with their own Learn (specs 019, 029). */
function ScratchRows({ runtime, touch, canLearn }: { runtime: ScratchRuntime; touch: boolean; canLearn: boolean }) {
  const { t } = useTranslation('settings');
  const { midi, feelMidi } = useStore(runtime.store);
  const jogLearning = midi.state === 'learning';
  let jogNote: { text: string; kind: string } | null = jogLearning
    ? { text: t('midiLearning'), kind: 'learning' }
    : null;
  if (!jogLearning && midi.lastLearn?.status === 'timeout') jogNote = { text: t('midiTimedOut'), kind: 'timeout' };
  if (!jogLearning && midi.lastLearn?.status === 'conflict') {
    const conflict = midi.lastLearn;
    const holder = holderName(t, { owner: conflictOwner(conflict) });
    jogNote = { text: t('midiConflict', { holder }), kind: 'conflict' };
  }
  const rows: ReactNode[] = [
    <Row
      key="jog"
      id="scratch.jog"
      name={t('midiTargetJog')}
      binding={
        midi.mapping
          ? bindingText(t, {
              inputName: midi.mapping.inputName,
              kind: 'cc',
              channel: midi.mapping.channel,
              number: midi.mapping.controller,
            })
          : null
      }
      note={jogNote}
      learning={jogLearning}
      canLearn={canLearn && midi.state !== 'unavailable' && !jogLearning}
      onLearn={() => void runtime.midiLearn()}
      onClear={() => runtime.midiForget()}
      touch={touch}
    />,
  ];
  for (const { target, label } of FEEL_TARGETS) {
    const mapping = feelMidi.mappings[target];
    const learning = feelMidi.learning === target;
    const message = feelMidi.message?.target === target ? feelMidi.message : null;
    let note: { text: string; kind: string } | null = learning ? { text: t('midiLearning'), kind: 'learning' } : null;
    if (!learning && message?.kind === 'timeout') note = { text: t('midiTimedOut'), kind: 'timeout' };
    if (!learning && message?.kind === 'conflict') {
      // Review #7: the holder by name (the jog, the other knob, a MIDI map target).
      note = message.holder
        ? { text: t('midiConflict', { holder: holderName(t, { owner: message.holder }) }), kind: 'conflict' }
        : { text: t('scratchFeelLearnConflict', { control: message.control }), kind: 'conflict' };
    }
    rows.push(
      <Row
        key={target}
        id={`scratch.${target}`}
        name={t(label)}
        binding={
          mapping
            ? bindingText(t, {
                inputName: mapping.inputName,
                kind: 'cc',
                channel: mapping.channel,
                number: mapping.controller,
              })
            : null
        }
        note={note}
        learning={learning}
        canLearn={canLearn && feelMidi.state !== 'unavailable'}
        onLearn={() => void runtime.learnFeel(target)}
        onClear={() => runtime.forgetFeel(target)}
        touch={touch}
      />,
    );
  }
  return <>{rows}</>;
}

export function MidiSettings({ runtime = scratchRuntime }: { runtime?: ScratchRuntime }) {
  const { t } = useTranslation('settings');
  const { compact } = usePanelViewport();
  const midi = useMidiMapContext();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!midi) return null;
  const { map } = midi;
  const state: MidiMapState = midi.state ?? {
    status: 'idle',
    inputs: [],
    learning: null,
    bindings: {},
    awaitingPickup: [],
    lastLearn: null,
  };
  const unsupported = state.status === 'unsupported';
  const canLearn = Boolean(map) && !unsupported;
  const anyBinding = Object.keys(state.bindings).some((id) => MIDI_TARGETS.some((meta) => meta.id === id));

  let status: string;
  if (state.status === 'ready') {
    status = state.inputs.length ? t('midiStatusReady', { inputs: state.inputs.join(', ') }) : t('midiStatusNoInputs');
  } else {
    status = t(STATUS_KEYS[state.status]);
  }

  const download = () => {
    if (!map) return;
    const url = URL.createObjectURL(new Blob([map.exportJson()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = MIDI_MAP_EXPORT_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importFile = async (file: File | undefined) => {
    if (!map || !file) return;
    let text: string;
    try {
      text = await readText(file);
    } catch (error: unknown) {
      console.warn('[midi] could not read the file:', error);
      setMessage({ text: t(IMPORT_ERROR_KEYS.unreadable), error: true });
      return;
    }
    const result = map.importJson(text) as {
      ok: boolean;
      error?: MidiMapImportError;
      detail?: string;
      holder?: MidiControlHolder;
    };
    if (result.ok || !result.error) {
      setMessage({ text: t('midiImported'), error: false });
      return;
    }
    const meta = MIDI_TARGETS.find((candidate) => candidate.id === result.detail);
    setMessage({
      text: t(IMPORT_ERROR_KEYS[result.error], {
        target: meta ? targetName(t, meta) : (result.detail ?? ''),
        holder: result.holder ? holderName(t, result.holder) : '',
      }),
      error: true,
    });
  };

  const button = cx(
    'px-3 rounded-md text-sm border border-lineHighlight bg-background text-foreground',
    'hover:border-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-lineHighlight',
    compact ? 'min-h-11' : 'h-8',
  );

  return (
    <section
      data-midi-settings=""
      aria-label={t('midiTitle')}
      className="p-4 bg-background border border-lineHighlight rounded-lg space-y-3"
    >
      <div>
        <h3 className="text-sm font-medium text-foreground">{t('midiTitle')}</h3>
        <p className="text-xs text-foreground opacity-70">{t('midiDescription')}</p>
      </div>
      <p className="text-sm text-foreground" data-midi-status={state.status} aria-live="polite">
        {status}
      </p>

      {GROUPS.map((group) => (
        <div key={group.id} data-midi-group={group.id}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground opacity-60">{t(group.label)}</h4>
          <ul className="divide-y divide-lineHighlight">
            {group.id === 'scratch' ? (
              <ScratchRows runtime={runtime} touch={compact} canLearn={!unsupported} />
            ) : (
              MIDI_TARGETS.filter((meta) => meta.group === group.id).map((meta) => {
                const control = state.bindings[meta.id];
                return (
                  <Row
                    key={meta.id}
                    id={meta.id}
                    name={targetName(t, meta)}
                    binding={control ? bindingText(t, control) : null}
                    note={rowNote(t, state, meta.id)}
                    learning={state.learning === meta.id}
                    canLearn={canLearn}
                    onLearn={() => {
                      setMessage(null);
                      void map?.learn(meta.id);
                    }}
                    onClear={() => map?.clear(meta.id)}
                    touch={compact}
                  />
                );
              })
            )}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-lineHighlight">
        {confirmingClear ? (
          <div className="flex flex-wrap items-center gap-2" role="group" data-midi-clear-all-confirm="">
            <span className="text-sm text-foreground">{t('midiClearAllConfirm')}</span>
            <button
              type="button"
              data-midi-clear-all-yes=""
              className={cx(button, 'border-red-500 text-red-400')}
              onClick={() => {
                map?.clearAll();
                setConfirmingClear(false);
              }}
            >
              {t('midiClearAllYes')}
            </button>
            <button
              type="button"
              data-midi-clear-all-cancel=""
              className={button}
              onClick={() => setConfirmingClear(false)}
            >
              {t('midiCancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-midi-clear-all=""
            className={button}
            disabled={!map || !anyBinding}
            onClick={() => setConfirmingClear(true)}
          >
            {t('midiClearAll')}
          </button>
        )}
        <button type="button" data-midi-export="" className={button} disabled={!map} onClick={download}>
          {t('midiExport')}
        </button>
        <button
          type="button"
          data-midi-import=""
          className={button}
          disabled={!map}
          onClick={() => fileInput.current?.click()}
        >
          {t('midiImport')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-midi-import-file=""
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void importFile(file);
          }}
        />
      </div>
      {message && (
        <p
          className={cx('text-xs', message.error ? 'text-red-400' : 'text-foreground opacity-70')}
          data-midi-message={message.error ? 'error' : 'ok'}
          role={message.error ? 'alert' : undefined}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
